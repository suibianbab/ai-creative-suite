// §7 承诺 vs 实测装配（第八轮，项 2）：把《通用语言指令方案》§0/§6/§7 的
// 每条承诺映射到已有评测报告的数字，口径（分子/分母）显式写死在下面——
// 数字不过线就如实记「未达标」，这一步的目的就是把承诺改成有证据的承诺。
//
// 数据源（全部为既有评测的报告产物，本脚本零服务调用、零新测量）：
//   live-eval          IMG-049  解析断言 + 引擎执行（212 条）
//   cloud-roundtrip    运行时云解析 round-trip 蕴含（23 例）
//   subject-auto       主体级自动率探针（11 图，IMG-059）
//   box-constrained    grid/box/重排序臂蒙版 IoU（12 GT 目标，IMG-055）
//   mask-quality       grid 环 best 蒙版质量（12 GT 目标，IMG-054）
//   grounding          框 IoU 命中率（36 目标，IMG-053）
//   exclude-point      蒙版代数（负点重圈，2 派生 GT，IMG-060）
//
// 口径要点（与各报告 note 一致，不在此重测）：
//   一次确认 = 确认环 top-3 内存在 mask IoU≥0.5 的候选（用户点一次即解决）；
//   越界拦截 = 越界指令被拒绝且从不 entail 成编辑（绝不半吊子执行）；
//   主体级自动 = ①桥 200 ②selectionBounds 非空 ③预览有变化 ④变化 bbox⊆选区
//               （±8px），全链路无人工介入（subject-auto-probe 操作定义）。
// 缺任一报告 = 上游评测未跑 → 基础设施错，非零退出（不静默降级成「未测量」）。
// 用法：node scripts/photocraft/section7-metrics.mjs [--json]

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { fraction, meetsAtLeast, percentText } from "./section7-rates.mjs";

const root = resolve(import.meta.dirname, "../..");
const QA_DIR = join(root, ".tools/photocraft-serve-qa");
const REPORT = join(QA_DIR, "section7-report.json");
const asJson = process.argv.includes("--json");

// ---- 承诺阈值（方案 §0/§6 原文数字）---------------------------------------

const PROMISE_SUBJECT_AUTO = 1.0; // §0「主体级 100% 自动」
const PROMISE_ONE_CONFIRM = 0.9; // §0「部件级 ≥90% 经一次确认解决」
const GOLDEN_SET_MIN = 200; // §7「金标准集 ≥200 条」
const ONE_CONFIRM_IOU = 0.5; // 与 grounding 命中阈值 / geHalf 同口径

// ---- 读报告（缺文件 = 基础设施错）-----------------------------------------

const SOURCES = [
  "live-eval-report.json",
  "cloud-roundtrip-report.json",
  "subject-auto-report.json",
  "box-constrained-report.json",
  "mask-quality-report.json",
  "grounding-report.json",
  "exclude-point-report.json",
  "preview-consistency-report.json",
];

const reports = {};
const missing = [];
for (const name of SOURCES) {
  try {
    reports[name] = JSON.parse(await readFile(join(QA_DIR, name), "utf8"));
  } catch {
    missing.push(name);
  }
}
if (missing.length) {
  console.error("上游评测报告缺失（先跑对应 registry case 再装配 §7）：");
  for (const name of missing) console.error(`  ✗ ${name}`);
  process.exit(1);
}

const live = reports["live-eval-report.json"];
const cloud = reports["cloud-roundtrip-report.json"];
const subject = reports["subject-auto-report.json"];
const boxConstrained = reports["box-constrained-report.json"];
const maskQuality = reports["mask-quality-report.json"];
const grounding = reports["grounding-report.json"];
const excludePoint = reports["exclude-point-report.json"];
const preview = reports["preview-consistency-report.json"];

// ---- 逐条承诺装配 -----------------------------------------------------------

const engineTotals = Object.fromEntries(
  Object.entries(live.lanes ?? {}).filter(([k]) => k.startsWith("engine:")),
);
const parserTotals = Object.fromEntries(
  Object.entries(live.lanes ?? {}).filter(([k]) => k.startsWith("parser:")),
);
const rejectTotals = Object.fromEntries(
  Object.entries(parserTotals).filter(([k]) => k.includes("reject")),
);
const engine = Object.values(engineTotals).reduce(
  (acc, l) => ({ total: acc.total + l.total, pass: acc.pass + l.pass }),
  { total: 0, pass: 0 },
);
const parser = Object.values(parserTotals).reduce(
  (acc, l) => ({ total: acc.total + l.total, pass: acc.pass + l.pass }),
  { total: 0, pass: 0 },
);
const rejects = Object.values(rejectTotals).reduce(
  (acc, l) => ({ total: acc.total + l.total, pass: acc.pass + l.pass }),
  { total: 0, pass: 0 },
);
const golden = {
  total: engine.total + parser.total,
  pass: engine.pass + parser.pass,
};

const subjectRate = fraction(
  subject.summary.passed,
  subject.summary.denominator,
);
const gridRing = fraction(
  boxConstrained.summary.grid.bestGeHalf,
  boxConstrained.summary.evaluated,
);
const boxRing = fraction(
  boxConstrained.summary.box.bestGeHalf,
  boxConstrained.summary.evaluated,
);
// cloud-roundtrip 报告的字段在顶层（provider/acceptance/…无 summary 包装）。
const cloudRejectedOk = cloud.acceptance?.modelRejectNeverEntailed === true;
const cloudReject = cloudRejectedOk
  ? fraction(cloud.cloudRejected, cloud.cloudRejected)
  : fraction(0, cloud.cloudRejected);

const metrics = [
  {
    id: "parse-accuracy",
    metric: "解析准确率（IR 字段级 + 引擎执行）",
    promise: `金标准集 ≥${GOLDEN_SET_MIN} 条（覆盖 paraphrase/口语/英文/模糊/越界/多步/保护）`,
    operational:
      "分母 = live-eval 全部 lane 条数（解析断言在本脚本内实际运行 + 预置计划经 dev bridge 打真实 PhotoCraft 引擎）；分子 = 断言/执行全过。运行时云解析另由 cloud-roundtrip 单独覆盖（见下）。",
    measured: {
      goldenSet: fraction(golden.pass, golden.total),
      parserPinned: fraction(parser.pass, parser.total),
      engineExecuted: fraction(engine.pass, engine.total),
      cloudRoundTrip: {
        cases: cloud.cases,
        cloudExercised: cloud.cloudExercised,
        cloudEntailed: cloud.cloudEntailed,
        cloudExplainConfirm: cloud.cloudExplainConfirm,
        cloudRejected: cloud.cloudRejected,
        acceptance: cloud.acceptance,
      },
    },
    verdict:
      golden.total >= GOLDEN_SET_MIN && golden.pass === golden.total
        ? "达标"
        : "未达标",
    caveats:
      "engine 通道以评测集预置计划直送引擎（不重复计费）；云 round-trip 里 entailment 未过的计划走解释确认/拒绝路径，这是设计路由不是解析失败。",
    evidence: ["live-eval-report.json", "cloud-roundtrip-report.json"],
  },
  {
    id: "subject-auto",
    metric: "主体级自动率",
    promise: `主体级 100% 自动（rembg 已达标）→ 阈值 ${(PROMISE_SUBJECT_AUTO * 100).toFixed(0)}%`,
    operational: subject.summary.note,
    measured: subjectRate,
    verdict:
      meetsAtLeast(subjectRate.rate, PROMISE_SUBJECT_AUTO) === true
        ? "达标"
        : "未达标",
    caveats: `失败 ${subjectRate.total - subjectRate.passed}/${subjectRate.total}：无显著主体的室内全景（provider 蒙版前景 0.01%）——主体级编辑对「无主体图」本身是目标缺口，应走部件级/画框路径而非冒充自动。主体级无独立像素 GT（未与 GT 蒙版逐像素比对）。`,
    evidence: ["subject-auto-report.json"],
  },
  {
    id: "part-one-confirm",
    metric: "部件级一次确认率",
    promise: `部件级 ≥90% 经一次确认解决 → 阈值 ${(PROMISE_ONE_CONFIRM * 100).toFixed(0)}%`,
    operational: `分母 = 12 个单实例 GT 目标（IMG-054 人工复核像素蒙版集）；分子 = 确认环 top-3 内存在 mask IoU≥${ONE_CONFIRM_IOU} 候选的目标数（环上点一次即解决；需要画框/剔除/重圈才算多次交互的，不计入分子）。承诺判默认入口（网格——§0 部件级路径是「候选提议 + 一次点击确认」，不含画框）；画框限定入口单独报告：它本身多一次画框交互，即使过 90% 也不算承诺达标。`,
    measured: {
      gridDefault: gridRing,
      boxConstrained: boxRing,
    },
    verdict:
      meetsAtLeast(gridRing.rate ?? 0, PROMISE_ONE_CONFIRM) === true
        ? "达标"
        : "未达标",
    caveats: `默认网格入口 ${percentText(gridRing.rate)}；画框限定入口 ${percentText(boxRing.rate)}（top1 mean Δ=${boxConstrained.summary.top1Delta?.mean ?? "—"}）——即使后者过线，也多一次画框交互，不冒充承诺达标。环内 best 候选存在而排序不中的目标（如「花朵」grid top1 0.000/best 0.986）是重排序/负点精修（项 3）要啃的部分。模拟画框 = 标注框（±5% 误差，非真实用户轨迹）。`,
    evidence: ["box-constrained-report.json", "mask-quality-report.json"],
  },
  {
    id: "out-of-scope-reject",
    metric: "越界能力拦截（体面拒绝，绝不半吊子执行）",
    promise: "越界指令（去背景/生成/审美）全部拒绝并说明边界",
    operational:
      "分母 = live-eval 拒绝 lane（model-reject + sequence-reject）条数；分子 = 正确拒绝。云通道口径：cloudRejected 例中 modelRejectNeverEntailed（被拒指令从不 entail 成编辑）。两管线指令集可能重叠，分别报告不合并。",
    measured: {
      parseLayer: fraction(rejects.pass, rejects.total),
      cloudRuntime: cloudReject,
    },
    verdict:
      rejects.pass === rejects.total && cloudReject.rate === 1
        ? "达标"
        : "未达标",
    caveats:
      "拒绝文案与边界说明的措辞质量未逐条评分（断言只验证拒绝+理由在场）。",
    evidence: ["live-eval-report.json", "cloud-roundtrip-report.json"],
  },
  {
    id: "grounding-iou",
    metric: "grounding IoU@确认环",
    promise: "§7 列为指标，无数值承诺",
    operational:
      "两层口径并列：框 IoU（36 标注目标，IoU≥0.5 命中，IMG-053）；像素 mask IoU（12 单实例 GT 目标，确认环 top-3，IMG-055 四臂）。boxHitMaskFail = 框好但 mask 差的目标数——「框好≠可精修」的直接证据。",
    measured: {
      boxIoU: {
        targets: grounding.total,
        top1Rate: grounding.overall.top1Rate,
        top3Rate: grounding.overall.top3Rate,
        noCorrectRate: grounding.overall.noCorrectRate,
      },
      maskIoU: {
        gridTop1Mean: boxConstrained.summary.grid.top1MaskIouMean,
        gridBestMean: boxConstrained.summary.grid.bestMaskIouMean,
        boxTop1Mean: boxConstrained.summary.box.top1MaskIouMean,
        boxBestMean: boxConstrained.summary.box.bestMaskIouMean,
        gridEnsembleTop1Mean:
          boxConstrained.summary.gridEnsemble?.top1MaskIouMean ?? null,
        gridEnsembleTop1Delta:
          boxConstrained.summary.gridEnsembleTop1Delta ?? null,
        boxHitMaskFail: maskQuality.summary.boxHitMaskFail,
      },
    },
    verdict: "实测分布（无数值承诺，不判达标）",
    caveats:
      "框标注非多人独立标注（±5%）；GT 蒙版为 SAM 起草+VLM 两轮复核+人工终审（非独立标注，manifest 如实声明）。",
    evidence: [
      "grounding-report.json",
      "box-constrained-report.json",
      "mask-quality-report.json",
    ],
  },
  {
    id: "e2e-success",
    metric: "端到端成功率",
    promise: "§7 列为指标，无数值承诺",
    operational:
      "分母 = live-eval 引擎 lane 条数（指令→解析→选区→引擎→预览全链，预置计划直送）；分子 = 全链成功。预览/保存/导出逐像素一致性由 IMG-050 单独钉（failures=0 则记入）。",
    measured: {
      engineChain: fraction(engine.pass, engine.total),
      previewConsistencyFailures: (preview.failures ?? []).length,
      previewConsistencyCases: (preview.cases ?? []).length,
    },
    verdict:
      "实测（预置计划通道 100%；云通道见 parse-accuracy.cloudRoundTrip）",
    caveats:
      "预置计划通道不含运行时云解析失败重试路径；真实浏览器点击链路由验收 rig 覆盖、未在本表分母内。",
    evidence: ["live-eval-report.json", "preview-consistency-report.json"],
  },
  {
    id: "mask-algebra",
    metric: "蒙版代数（部件 = 整体 − 误选，负点重圈）",
    promise: "§8 细粒度降级的交互补偿（项 3 新增能力，无数值承诺）",
    operational:
      "派生 GT = 整体 GT ∧ ¬子区域 GT（花瓣=花朵−花蕊、耳朵=猫头−猫脸）；模拟交互：画框=整体标注框、剔除点=子区域 GT 质心；分子条件同一次确认口径（top-3 内 IoU≥0.5）。",
    measured: {
      cases: excludePoint.summary.records.map((r) => ({
        phrase: r.phrase,
        boxTop1: r.boxTop1,
        excludeTop1: r.excludeTop1,
        excludeBest: r.excludeBest,
      })),
    },
    verdict: "实测（mixed：机制可用、重圈后排序仍噪）",
    caveats:
      "花瓣：box-only 已 0.974，加负点把 top1 打到 0.394（best 仍 0.970 在环内）；耳朵：0.529→0.627 改善。负点重圈后的 CLIP 排序会惩罚「扣掉一块」的候选——这正是环内人工确认兜底的场景，也是 ensemble 重排序的动机。",
    evidence: ["exclude-point-report.json"],
  },
  {
    id: "confirm-ui-intercept",
    metric: "解释确认 UI 拦截率（§6「拦截剩余 95% 误解析」）",
    promise: "95%",
    operational: null,
    measured: { status: "未测量" },
    verdict: "未测量",
    caveats:
      "需要真实用户在确认环上点「纠正」的分流数据（误解析被 UI 拦下的比率）。结构性保障已实现：每次部件级编辑必经候选确认环、参数默认值必经滑杆交接；但「95%」是设计预估，无用户数据前不改口。",
    evidence: [],
  },
  {
    id: "avg-confirmations",
    metric: "平均确认次数",
    promise: "§7 列为指标，无数值承诺",
    operational: null,
    measured: { status: "未测量" },
    verdict: "未测量",
    caveats:
      "模拟评测不建模用户点击序列（单次环交互可由环内 best 候选存在率近似，见 part-one-confirm）；真实值需线上会话遥测。",
    evidence: [],
  },
  {
    id: "edit-abandon-rate",
    metric: "编辑放弃率",
    promise: "§7 列为指标，无数值承诺",
    operational: null,
    measured: { status: "未测量" },
    verdict: "未测量",
    caveats: "需真实用户会话（开始编辑后未应用/未保存的比率）。",
    evidence: [],
  },
  {
    id: "online-telemetry",
    metric: "线上回流（确认环点击率/滑杆修改幅度/撤销率按解析器分桶）",
    promise: "§7「现有账本/遥测基础设施可承载」",
    operational: null,
    measured: { status: "未测量" },
    verdict: "未测量",
    caveats:
      "遥测管道未建设（本地单机 rig 无真实流量）；建管道前 §7 三项用户指标（拦截率/确认次数/放弃率）均无法闭环。",
    evidence: [],
  },
];

// ---- 输出 -------------------------------------------------------------------

const summary = {
  promisesTotal: metrics.length,
  met: metrics.filter((m) => m.verdict === "达标").length,
  notMet: metrics.filter((m) => m.verdict === "未达标").length,
  unmeasured: metrics.filter((m) => m.verdict === "未测量").length,
  distributions: metrics.filter((m) => m.verdict.startsWith("实测")).length,
};

const report = {
  executedAt: new Date().toISOString(),
  sources: Object.fromEntries(
    SOURCES.map((name) => [name, reports[name].executedAt ?? null]),
  ),
  thresholds: {
    PROMISE_SUBJECT_AUTO,
    PROMISE_ONE_CONFIRM,
    GOLDEN_SET_MIN,
    ONE_CONFIRM_IOU,
  },
  summary,
  metrics,
};
await writeFile(REPORT, JSON.stringify(report, null, 2));

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("§7 承诺 vs 实测（数据源 8 份报告，口径见各项 operational）");
  for (const m of metrics) {
    const tag =
      m.verdict === "达标"
        ? "[达标]  "
        : m.verdict === "未达标"
          ? "[未达标]"
          : m.verdict === "未测量"
            ? "[未测量]"
            : "[实测]  ";
    const measuredText =
      typeof m.measured === "object" && "rate" in m.measured
        ? `${m.measured.passed}/${m.measured.total} (${percentText(m.measured.rate)})`
        : "";
    console.log(`${tag} ${m.metric.padEnd(24)} ${m.promise}`);
    if (measuredText) console.log(`         实测 ${measuredText}`);
  }
  console.log(
    `\n汇总：承诺 ${summary.promisesTotal} 条 —— 达标 ${summary.met}、未达标 ${summary.notMet}、实测分布 ${summary.distributions}、未测量 ${summary.unmeasured}`,
  );
  console.log(`报告：${REPORT}`);
}
