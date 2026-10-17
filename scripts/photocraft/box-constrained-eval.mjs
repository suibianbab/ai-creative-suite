// D 项（第七轮整改）画框限定评测：同一批 GT 目标上，SAM 8×8 网格模式 vs
// x-acs-prompt-box 框提示模式的像素蒙版质量对比；第八轮加重排序 A/B 臂
// （box+X-Acs-Rank:ensemble，CLIP-only 序 vs 0.7·z(clip)+0.3·z(sam) 集成序）。
//
// 动机（codex §D + GT drafting 证据）：同模型换提示方式（框+点组合替代网格）
// 可把「框好≠mask 好」的低分目标拉起来（草稿工作流实测猫头 0.143 → GT 可用
// 草稿）。本脚本把该证据钉进可复算的对比报告：12 个 IMG-054 GT 目标 × 三
// 种臂（grid / box+clip / box+ensemble），标注框当作「用户画框」的模拟
// （框误差 ±5%，非真实用户轨迹，报告如此声明）。
//
// 口径：GT fixture 完整性先于服务调用（同 mask-quality-eval）；指标 =
// best/top1 mask IoU、漏选、越界（GT 分辨率，linear 缩放 + ≥128 二值）；
// 质量差是评测发现不失败，fixture/服务错才非零退出。报告 only——不据此切
// 默认服务、不开自动选中（TAU_AUTO_ENABLED 维持 false）。
// 用法：node scripts/photocraft/box-constrained-eval.mjs [--json] [--case <子串>]
// 依赖：:4104 parts-candidates（venv-sam2）、qa/fixtures/photocraft-grounding/
//   masks/（IMG-054 GT 蒙版 + manifest.json）。

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

import { fetchCandidates, parseImageSize } from "./grounding-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "apps/api/package.json"));
// sharp 从 apps/api 解析（preview-consistency / mask-quality-eval 同款）。
const sharpApi = require("sharp");

const FIXTURE_DIR = join(root, "qa/fixtures/photocraft-grounding");
const MASKS_DIR = join(FIXTURE_DIR, "masks");
const CANDIDATES_BASE =
  process.env.PHOTOCRAFT_CANDIDATES_BASE ?? "http://127.0.0.1:4104";
const REPORT = join(
  root,
  ".tools/photocraft-serve-qa/box-constrained-report.json",
);

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
const MASK_THRESHOLD = 128; // 与浏览器解码（红通道 ≥128）同口径
const TOP_N = 3;

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const caseFilter =
  argv.indexOf("--case") >= 0 ? argv[argv.indexOf("--case") + 1] : null;

// ---- GT fixture 完整性校验（同 mask-quality-eval 口径，先于服务调用）-------

const annotations = JSON.parse(
  await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(MASKS_DIR, "manifest.json"), "utf8"),
);

const annotationIndex = new Map();
for (const entry of annotations.images)
  for (const target of entry.targets)
    annotationIndex.set(`${entry.image}|${target.phrase}`, { entry, target });

const fixtureErrors = [];
const gtTargets = [];
for (const target of manifest.targets ?? []) {
  const key = `${target.image}|${target.phrase}`;
  const found = annotationIndex.get(key);
  if (!found) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：不在 annotations 内`,
    );
    continue;
  }
  if (found.target.boxes.length !== 1) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：标注框 ${found.target.boxes.length} 个（GT 仅收单实例目标）`,
    );
    continue;
  }
  let maskBytes;
  const maskPath = join(
    MASKS_DIR,
    basename(target.image),
    `${target.phrase}.png`,
  );
  try {
    maskBytes = await readFile(maskPath);
  } catch {
    fixtureErrors.push(`${target.image} | ${target.phrase}：GT 蒙版文件缺失`);
    continue;
  }
  const size = parseImageSize(maskBytes);
  if (
    !size ||
    size.width !== found.entry.width ||
    size.height !== found.entry.height
  ) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版尺寸与标注不一致`,
    );
    continue;
  }
  const gtRaw = await sharpApi(maskBytes).grayscale().raw().toBuffer({
    resolveWithObject: true,
  });
  let white = 0;
  let nonBinary = 0;
  for (const byte of gtRaw.data) {
    if (byte === 255) white += 1;
    else if (byte !== 0) nonBinary += 1;
  }
  if (nonBinary > 0 || white === 0 || white === gtRaw.data.length) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版必须非空严格二值（0/255）`,
    );
    continue;
  }
  gtTargets.push({
    image: target.image,
    phrase: target.phrase,
    entry: found.entry,
    annotationBox: found.target.boxes[0], // [x, y, w, h] 归一化（模拟用户画框）
    maskBytes,
  });
}
if (!gtTargets.length)
  fixtureErrors.push("manifest.targets 为空：无 GT 目标可评测");
if (fixtureErrors.length) {
  console.error("GT fixture 完整性校验失败：");
  for (const e of fixtureErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ---- :4104 就绪检查 ---------------------------------------------------------

const ready = await fetch(`${CANDIDATES_BASE}/health`, {
  headers: { Origin: "http://localhost:3000" },
});
if (!ready.ok) {
  console.error(`parts-candidates 服务未就绪：GET /health → ${ready.status}`);
  process.exit(1);
}
const serviceVersion = (await ready.text()).trim();

// ---- 指标（与 mask-quality-eval 同源实现，独立脚本不跨文件 import）-----------

async function decodeCandidateMask(maskB64, gtWidth, gtHeight) {
  const resized = await sharpApi(Buffer.from(maskB64, "base64"))
    .grayscale()
    .resize(gtWidth, gtHeight, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const binary = new Uint8Array(resized.data.length);
  let white = 0;
  for (let i = 0; i < resized.data.length; i += 1) {
    const on = resized.data[i] >= MASK_THRESHOLD;
    binary[i] = on ? 1 : 0;
    if (on) white += 1;
  }
  return { binary, white };
}

function maskMetrics(gtBinary, candidateBinary, candidateWhite) {
  let gtCount = 0;
  let intersection = 0;
  for (let i = 0; i < gtBinary.length; i += 1) {
    if (gtBinary[i]) gtCount += 1;
    if (gtBinary[i] && candidateBinary[i]) intersection += 1;
  }
  const union = gtCount + candidateWhite - intersection;
  return {
    iou: union > 0 ? intersection / union : 0,
    missRate: gtCount > 0 ? (gtCount - intersection) / gtCount : 1,
    spillRate:
      candidateWhite > 0 ? (candidateWhite - intersection) / candidateWhite : 0,
  };
}

const imageBytesCache = new Map();
async function loadFixtureImage(image) {
  if (imageBytesCache.has(image)) return imageBytesCache.get(image);
  const path = join(FIXTURE_DIR, image);
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`${image}: 不支持的图片扩展名 ${ext}`);
  const bytes = await readFile(path);
  const loaded = { bytes, contentType };
  imageBytesCache.set(image, loaded);
  return loaded;
}

async function evalMode(gt, promptBox, gtBinary, rank = null) {
  // grid 模式 promptBox=null；box 模式传归一化 [x1,y1,x2,y2]；
  // rank="ensemble" 时服务端按 0.7·z(clip)+0.3·z(sam) 重排序（重排序 A/B 臂）。
  const { bytes, contentType } = await loadFixtureImage(gt.image);
  const result = await fetchCandidates({
    base: CANDIDATES_BASE,
    imageBytes: bytes,
    contentType,
    phrase: gt.phrase,
    promptBox,
    rank,
  });
  if (result.error) return { error: result.error };
  const response = result.response;
  const rawCandidates = [...response.candidates].sort(
    (a, b) => b.score - a.score,
  );
  const rows = [];
  for (let rank = 0; rank < Math.min(TOP_N, rawCandidates.length); rank += 1) {
    const raw = rawCandidates[rank];
    const decoded = await decodeCandidateMask(
      raw.mask_png_b64,
      gt.entry.width,
      gt.entry.height,
    );
    const metrics = maskMetrics(gtBinary, decoded.binary, decoded.white);
    rows.push({
      rank: rank + 1,
      score: Number(raw.score.toFixed(4)),
      maskIou: Number(metrics.iou.toFixed(4)),
      missRate: Number(metrics.missRate.toFixed(4)),
      spillRate: Number(metrics.spillRate.toFixed(4)),
    });
  }
  const best = rows.reduce(
    (acc, row) => (acc === null || row.maskIou > acc.maskIou ? row : acc),
    null,
  );
  return { tookMs: response.took_ms, candidates: rows, best };
}

const records = [];
const errors = [];
for (const gt of gtTargets) {
  if (caseFilter && !gt.phrase.includes(caseFilter)) continue;
  const gtRaw = await sharpApi(gt.maskBytes).grayscale().raw().toBuffer({
    resolveWithObject: true,
  });
  const gtBinary = new Uint8Array(gtRaw.data.length);
  for (let i = 0; i < gtRaw.data.length; i += 1)
    gtBinary[i] = gtRaw.data[i] >= MASK_THRESHOLD ? 1 : 0;
  const [x, y, w, h] = gt.annotationBox;
  const promptBox = [
    Number(x.toFixed(4)),
    Number(y.toFixed(4)),
    Number((x + w).toFixed(4)),
    Number((y + h).toFixed(4)),
  ];
  const grid = await evalMode(gt, null, gtBinary);
  if (grid.error) {
    errors.push(`${gt.image} | ${gt.phrase} | grid：${grid.error}`);
    continue;
  }
  const box = await evalMode(gt, promptBox, gtBinary);
  if (box.error) {
    errors.push(
      `${gt.image} | ${gt.phrase} | box${JSON.stringify(promptBox)}：${box.error}`,
    );
    continue;
  }
  // 重排序 A/B：同框同模型，仅 X-Acs-Rank=ensemble（0.7·z(clip)+0.3·z(sam)）。
  // clip 臂即上面 box 的默认序；两臂候选池相同，只有顺序（与 top-k 截断）不同。
  const boxEnsemble = await evalMode(gt, promptBox, gtBinary, "ensemble");
  // grid+ensemble：网格模式 24 候选池上的重排序——z 分数在 2-4 个 box 变体上
  // 退化（实测 12/12 与 clip 同序），集成序的真正战场是整池排序。
  const gridEnsemble = await evalMode(gt, null, gtBinary, "ensemble");
  if (boxEnsemble.error) {
    errors.push(
      `${gt.image} | ${gt.phrase} | box+ensemble：${boxEnsemble.error}`,
    );
    continue;
  }
  if (gridEnsemble.error) {
    errors.push(
      `${gt.image} | ${gt.phrase} | grid+ensemble：${gridEnsemble.error}`,
    );
    continue;
  }
  const top1 = (mode) =>
    mode.candidates.length ? mode.candidates[0].maskIou : null;
  records.push({
    image: gt.image,
    phrase: gt.phrase,
    promptBox,
    grid,
    box,
    boxEnsemble,
    gridEnsemble,
    top1Delta:
      top1(grid) !== null && top1(box) !== null
        ? Number((top1(box) - top1(grid)).toFixed(4))
        : null,
  });
  if (!asJson)
    console.log(
      `${gt.phrase.padEnd(6)} grid top1=${top1(grid)?.toFixed(3) ?? "—"} best=${grid.best?.maskIou.toFixed(3) ?? "—"}（${grid.candidates.length} 个）  ` +
        `box top1=${top1(box)?.toFixed(3) ?? "—"} best=${box.best?.maskIou.toFixed(3) ?? "—"}（${box.candidates.length} 个）  ` +
        `boxEns top1=${top1(boxEnsemble)?.toFixed(3) ?? "—"}  gridEns top1=${top1(gridEnsemble)?.toFixed(3) ?? "—"}  ` +
        `Δtop1=${top1(grid) !== null && top1(box) !== null ? (top1(box) - top1(grid)).toFixed(3) : "—"}`,
    );
}

// ---- 汇总 -------------------------------------------------------------------

const mean = (xs) =>
  xs.length === 0
    ? null
    : Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(4));

function modeSummary(mode) {
  const top1Ious = records
    .map((r) => r[mode].candidates[0]?.maskIou ?? null)
    .filter((v) => v !== null);
  const bestIous = records
    .map((r) => r[mode].best?.maskIou ?? null)
    .filter((v) => v !== null);
  return {
    noCandidates: records.filter((r) => r[mode].candidates.length === 0).length,
    top1MaskIouMean: mean(top1Ious),
    top1GeHalf: top1Ious.filter((v) => v >= 0.5).length,
    bestMaskIouMean: mean(bestIous),
    bestGeHalf: bestIous.filter((v) => v >= 0.5).length,
    bestMissRateMean: mean(
      records
        .map((r) => r[mode].best?.missRate ?? null)
        .filter((v) => v !== null),
    ),
    bestSpillRateMean: mean(
      records
        .map((r) => r[mode].best?.spillRate ?? null)
        .filter((v) => v !== null),
    ),
    tookMsMean: mean(records.map((r) => r[mode].tookMs ?? 0)),
  };
}

const deltas = records.map((r) => r.top1Delta).filter((v) => v !== null);
const gridEnsembleDeltas = records
  .map((r) => {
    const clip = r.grid.candidates[0]?.maskIou ?? null;
    const ens = r.gridEnsemble.candidates[0]?.maskIou ?? null;
    return clip !== null && ens !== null
      ? Number((ens - clip).toFixed(4))
      : null;
  })
  .filter((v) => v !== null);
const ensembleDeltas = records
  .map((r) => {
    const clip = r.box.candidates[0]?.maskIou ?? null;
    const ens = r.boxEnsemble.candidates[0]?.maskIou ?? null;
    return clip !== null && ens !== null
      ? Number((ens - clip).toFixed(4))
      : null;
  })
  .filter((v) => v !== null);
const summary = {
  gtTargetsTotal: caseFilter ? records.length : gtTargets.length,
  evaluated: records.length,
  grid: modeSummary("grid"),
  box: modeSummary("box"),
  boxEnsemble: modeSummary("boxEnsemble"),
  gridEnsemble: modeSummary("gridEnsemble"),
  top1Delta: {
    improved: deltas.filter((v) => v > 0.05).length,
    unchanged: deltas.filter((v) => Math.abs(v) <= 0.05).length,
    regressed: deltas.filter((v) => v < -0.05).length,
    mean: mean(deltas),
  },
  gridEnsembleTop1Delta: {
    improved: gridEnsembleDeltas.filter((v) => v > 0.05).length,
    unchanged: gridEnsembleDeltas.filter((v) => Math.abs(v) <= 0.05).length,
    regressed: gridEnsembleDeltas.filter((v) => v < -0.05).length,
    mean: mean(gridEnsembleDeltas),
  },
  ensembleTop1Delta: {
    improved: ensembleDeltas.filter((v) => v > 0.05).length,
    unchanged: ensembleDeltas.filter((v) => Math.abs(v) <= 0.05).length,
    regressed: ensembleDeltas.filter((v) => v < -0.05).length,
    mean: mean(ensembleDeltas),
  },
  note: "模拟用户画框 = 人工标注框（±5% 标注误差，非真实用户轨迹）；box 模式 = 服务端 x-acs-prompt-box 框+点组合提示，boxEnsemble = 同框同模型仅 X-Acs-Rank=ensemble（0.7·z(clip)+0.3·z(sam)），同一 SAM vit_b.quant 模型。报告 only：不据此切换默认服务或开启自动选中。",
};

const report = {
  candidatesService: CANDIDATES_BASE,
  serviceVersion,
  manifestMethod: manifest.method,
  subset: caseFilter !== null,
  executedAt: new Date().toISOString(),
  summary,
  records,
  errors,
};
const reportPath =
  caseFilter === null ? REPORT : REPORT.replace(/\.json$/, ".subset.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`D 项画框限定评测 @ ${CANDIDATES_BASE}（grid vs box 同模型）`);
  console.log(`服务版本：${serviceVersion}`);
  console.log(
    `grid：top1 mean=${summary.grid.top1MaskIouMean}（≥0.5 ${summary.grid.top1GeHalf}/${summary.evaluated}），best mean=${summary.grid.bestMaskIouMean}，无候选 ${summary.grid.noCandidates}，平均 ${summary.grid.tookMsMean}ms`,
  );
  console.log(
    `box ：top1 mean=${summary.box.top1MaskIouMean}（≥0.5 ${summary.box.top1GeHalf}/${summary.evaluated}），best mean=${summary.box.bestMaskIouMean}，无候选 ${summary.box.noCandidates}，平均 ${summary.box.tookMsMean}ms`,
  );
  console.log(
    `boxEns：top1 mean=${summary.boxEnsemble.top1MaskIouMean}（≥0.5 ${summary.boxEnsemble.top1GeHalf}/${summary.evaluated}），best mean=${summary.boxEnsemble.bestMaskIouMean}，无候选 ${summary.boxEnsemble.noCandidates}`,
  );
  console.log(
    `Δtop1(box ens-clip)：改善 ${summary.ensembleTop1Delta.improved}、持平 ${summary.ensembleTop1Delta.unchanged}、回退 ${summary.ensembleTop1Delta.regressed}，mean ${summary.ensembleTop1Delta.mean}`,
  );
  console.log(
    `gridEns：top1 mean=${summary.gridEnsemble.top1MaskIouMean}（≥0.5 ${summary.gridEnsemble.top1GeHalf}/${summary.evaluated}），best mean=${summary.gridEnsemble.bestMaskIouMean}`,
  );
  console.log(
    `Δtop1(grid ens-clip)：改善 ${summary.gridEnsembleTop1Delta.improved}、持平 ${summary.gridEnsembleTop1Delta.unchanged}、回退 ${summary.gridEnsembleTop1Delta.regressed}，mean ${summary.gridEnsembleTop1Delta.mean}`,
  );
  console.log(
    `Δtop1：改善(>+0.05) ${summary.top1Delta.improved}、持平 ${summary.top1Delta.unchanged}、回退(<-0.05) ${summary.top1Delta.regressed}，mean ${summary.top1Delta.mean}`,
  );
  if (errors.length) {
    console.log("执行错误：");
    for (const error of errors) console.log(`  ✗ ${error}`);
  }
  console.log(`报告：${reportPath}`);
}
// 口径：fixture/服务失败 → 非零退出；box 模式质量（含回退）是评测发现只进
// 报告。是否推广画框限定入口/调默认，另行决策。
if (errors.length > 0) process.exitCode = 1;
