// 补充A（未完成项 3）live runner：跨题材真图 grounding 质量评测 + τ_auto
// 校准证据（与 P1-3 的解析评测共用 annotations.json 标注集，不另建平行体系）。
// 数据流：qa/fixtures/photocraft-grounding/annotations.json（11 图 5 题材 36 目标）
//   → fixture 完整性校验（标注框/图数/目标数/来源记录/实际图片尺寸，契约见
//     grounding-contract.mjs——评测集被误删或改坏时直接失败，不静默 PASS）
//   → 逐 (图, 短语) POST http://127.0.0.1:4104/v1/candidates（SAM vit_b +
//     Chinese-CLIP 开放词汇候选，即产品 open-vocab 环同一服务）；响应按同一
//     契约逐项严格校验，坏响应记执行错误并非零退出，「无候选」只认
//     reason=no-regions 且 candidates=[]
//   → grounding-metrics.mjs 纯函数汇总（分题材 top-1/top-3 命中率、无正确
//     候选比例、τ 扫描误自动选中率/确认次数、预先写明的启用门槛）
//   → .tools/photocraft-serve-qa/grounding-report.json（记录 /health 版本串，
//     便于以后复算）；--case 子集运行写入 grounding-report.subset.json 并在
//     报告中标记 subset，不覆盖全量报告冒充全量
// 失败口径：服务不可达 / 非 2xx / 图片缺失 / 响应不合规 / fixture 不完整 →
// 非零退出（基础设施失败）；命中率低是评测发现，不是失败——门槛决策如实写入
// 报告，预期结论是「各题材样本/auto 事件远低于 30 → 维持 TAU_AUTO_ENABLED=false」。
// 用法：node scripts/photocraft/grounding-eval.mjs [--json] [--case <子串>]

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  fetchCandidates,
  parseImageSize,
  validateAnnotations,
} from "./grounding-contract.mjs";
import {
  evaluateGrounding,
  normalizeCandidates,
} from "./grounding-metrics.mjs";

const root = resolve(import.meta.dirname, "../..");
const FIXTURE_DIR = join(root, "qa/fixtures/photocraft-grounding");
const BASE = process.env.PHOTOCRAFT_CANDIDATES_BASE ?? "http://127.0.0.1:4104";
const REPORT = join(root, ".tools/photocraft-serve-qa/grounding-report.json");

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const caseFilter =
  argv.indexOf("--case") >= 0 ? argv[argv.indexOf("--case") + 1] : null;

// ---- fixture 完整性校验（先于任何服务调用；失败即非零退出）---------------
const annotations = JSON.parse(
  await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
);
const provenance = JSON.parse(
  await readFile(join(FIXTURE_DIR, "provenance.json"), "utf8"),
);
const fixture = validateAnnotations(annotations, provenance);
const fixtureErrors = [...fixture.errors];
const imageBytes = new Map();
if (fixture.ok) {
  for (const entry of annotations.images) {
    const path = join(FIXTURE_DIR, entry.image);
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!CONTENT_TYPES[ext]) {
      fixtureErrors.push(`${entry.image}: 不支持的图片扩展名 ${ext}`);
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      fixtureErrors.push(`${entry.image}: 图片文件缺失`);
      continue;
    }
    imageBytes.set(entry.image, { bytes, contentType: CONTENT_TYPES[ext] });
    const size = parseImageSize(bytes);
    if (!size) {
      fixtureErrors.push(`${entry.image}: 无法解析图片像素尺寸`);
    } else if (size.width !== entry.width || size.height !== entry.height) {
      const swapped =
        size.width === entry.height && size.height === entry.width
          ? "（宽高互换：疑似 EXIF 方向，标注须按转置后尺寸记录）"
          : "";
      fixtureErrors.push(
        `${entry.image}: 标注尺寸 ${entry.width}×${entry.height} 与实际图片 ${size.width}×${size.height} 不一致${swapped}`,
      );
    }
  }
}
if (fixtureErrors.length) {
  console.error("fixture 完整性校验失败：");
  for (const e of fixtureErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ---- 服务就绪检查：GET /health 返回 ready 行 + 模型版本串（parts-candidates.py
// 契约，CORS 白名单只放行 dev 前端来源），版本串进报告便于复算。-----------
const ready = await fetch(`${BASE}/health`, {
  headers: { Origin: "http://localhost:3000" },
});
if (!ready.ok) {
  console.error(`parts-candidates 服务未就绪：GET /health → ${ready.status}`);
  process.exit(1);
}
const serviceVersion = (await ready.text()).trim();
if (!serviceVersion.startsWith("ready")) {
  console.error(
    `parts-candidates /health 响应异常：${serviceVersion.slice(0, 120)}`,
  );
  process.exit(1);
}

const records = [];
const errors = [];
let fullTargets = 0;
for (const entry of annotations.images) {
  const { bytes, contentType } = imageBytes.get(entry.image);
  for (const target of entry.targets) {
    fullTargets += 1;
    if (caseFilter && !target.phrase.includes(caseFilter)) continue;
    const result = await fetchCandidates({
      base: BASE,
      imageBytes: bytes,
      contentType,
      phrase: target.phrase,
    });
    if (result.error) {
      errors.push({
        image: entry.image,
        phrase: target.phrase,
        error: result.error,
      });
      continue;
    }
    records.push({
      image: entry.image,
      domain: entry.domain,
      phrase: target.phrase,
      gtBoxes: target.boxes,
      candidates: normalizeCandidates(result.response),
      noRegionsReason: result.response.reason ?? null,
      tookMs: result.response.took_ms ?? null,
    });
  }
}

const report = evaluateGrounding(records, {
  hitIoUThreshold: annotations.hitIoUThreshold ?? 0.5,
});
const subset = caseFilter
  ? {
      filter: caseFilter,
      includedTargets: records.length + errors.length,
      fullTargets,
      note: "子集运行（--case 过滤），不覆盖全量报告 grounding-report.json",
    }
  : null;
const full = {
  service: BASE,
  serviceVersion,
  annotationMethod: annotations.method,
  fixture: {
    images: fixture.images,
    targets: fixture.targets,
    boxes: fixture.boxes,
    provenanceEntries: Object.keys(provenance).length,
  },
  subset,
  ...report,
  errors,
  executedAt: new Date().toISOString(),
};
const reportPath = caseFilter
  ? REPORT.replace(/\.json$/, ".subset.json")
  : REPORT;
await writeFile(reportPath, JSON.stringify(full, null, 2));

if (asJson) {
  console.log(JSON.stringify(full, null, 2));
} else {
  const pct = (rate) => (rate === null ? "—" : `${(rate * 100).toFixed(0)}%`);
  console.log(
    `跨题材真图 grounding 评测 @ ${BASE}（${report.total} 目标 / ${Object.keys(report.byDomain).length} 题材）`,
  );
  console.log(`服务版本：${serviceVersion}`);
  if (subset)
    console.log(
      `子集运行：--case ${subset.filter}，${subset.includedTargets}/${subset.fullTargets} 目标，报告写入 ${reportPath}`,
    );
  console.log("题材      目标  top-1  top-3  无候选  无正确");
  for (const [domain, v] of Object.entries(report.byDomain))
    console.log(
      `${domain.padEnd(8)} ${String(v.targets).padStart(4)}  ${pct(v.top1Rate).padStart(5)}  ${pct(v.top3Rate).padStart(5)}  ${pct(v.noCandidateRate).padStart(5)}  ${pct(v.noCorrectRate).padStart(5)}`,
    );
  console.log(
    `合计      ${String(report.total).padStart(4)}  ${pct(report.overall.top1Rate).padStart(5)}  ${pct(report.overall.top3Rate).padStart(5)}  ${pct(report.overall.noCandidateRate).padStart(5)}  ${pct(report.overall.noCorrectRate).padStart(5)}`,
  );
  console.log("");
  console.log("τ 扫描（top-1 score ≥ τ 即自动选中；选中但不命中 GT 为误选）");
  console.log("τ     自动选中  误选  误选率  需确认");
  for (const step of report.tauSweep)
    console.log(
      `${String(step.tau).padEnd(5)} ${String(step.autoSelected).padStart(6)}  ${String(step.falseAuto).padStart(4)}  ${(step.falseAutoRate === null ? "—" : step.falseAutoRate.toFixed(2)).padStart(6)}  ${String(step.confirmNeeded).padStart(5)}`,
    );
  console.log("");
  console.log(
    `门槛决策：${report.gate.decision === "enable" ? "可启用" : "维持关闭"} —— ${report.gate.rationale}`,
  );
  if (errors.length) {
    console.log("执行错误:");
    for (const e of errors)
      console.log(
        `  ✗ ${e.image}${e.phrase ? `｜${e.phrase}` : ""} — ${e.error}`,
      );
  }
}
if (errors.length > 0) process.exitCode = 1;
