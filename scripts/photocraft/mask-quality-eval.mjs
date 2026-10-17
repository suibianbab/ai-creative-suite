// C 项（第六轮整改）像素级 mask 质量评测：候选 mask_png_b64 对人工复核
// GT 蒙版的漏选/越界指标 + 端到端 mask 选区经真桥的原生编辑验证。
//
// 与 IMG-053（grounding-eval.mjs，框 IoU 粗定位）互补：本脚本把「框找对」
// 推进到「实际选区涂到哪些像素」。框 IoU≥0.5 不再被读作精修就绪——同一
// 候选的 mask IoU 并列给出，boxHitMaskFail 计数（框 IoU≥0.5 但最佳 mask
// IoU<0.5）把「框好≠可精修」钉进数据。
//
// Part 1（:4104 候选服务）：GT fixture 完整性先于任何服务调用（manifest
//   目标 ⊆ annotations 且单框；mask 尺寸==标注 width×height；严格二值
//   0/255）→ 逐目标 fetchCandidates（grounding-contract 同一契约，mask
//   字段在场即校验）→ top-3 逐候选：mask 缩放到 GT 分辨率（sharp linear，
//   近似浏览器画布平滑缩放）→ ≥128 二值 →
//   IoU / 漏选 |G∧¬C|/|G| / 越界 |C∧¬G|/|C|；best-by-IoU 汇总；
//   area_ratio ≈ mask 白像素占比（服务空间）≤0.01 交叉校验，违规=基础设施错。
// Part 2（:4112 桥，hat-teal 帽沿 GT；不经过浏览器）：GT mask → POST /v1/selection-mask →
//   /v1/instruction（selection-method=mask，selected-area 提亮）→ 断言
//   selectionBounds 非空 → GET source（.pcraft）→ POST /v1/inspect 重开
//   hasSelection==true（.pcraft 持久化选区；PSD 不持久化为已记录引擎边界）
//   → GET preview：mask 外（切比雪夫距离 >6px）逐字节一致，边界 ≤6px 允许
//   ≤2/255 羽化舍入差（IMG-050 同口径），mask 内必须有实际改动（选区真的
//   限定了编辑范围）。
//
// 失败口径（与 IMG-053 诚实语义一致）：fixture/服务/断言失败 → 非零退出；
// mask 质量低是评测发现不是失败，如实进报告。TAU_AUTO_ENABLED 不在本脚本
// 职责内，维持 false。
// 用法：node scripts/photocraft/mask-quality-eval.mjs [--json] [--case <子串>]
// 依赖：:4104 parts-candidates（venv-sam2）、:4112 dev-bridge、
//   qa/fixtures/photocraft-grounding/masks/（GT 蒙版 + manifest.json）。

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

import { fetchCandidates, parseImageSize } from "./grounding-contract.mjs";
import { bestIou, normalizeCandidates } from "./grounding-metrics.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "apps/api/package.json"));
// sharp 从 apps/api 解析（根目录没有直接依赖）——preview-consistency 同款。
const sharpApi = require("sharp");

const FIXTURE_DIR = join(root, "qa/fixtures/photocraft-grounding");
const MASKS_DIR = join(FIXTURE_DIR, "masks");
const CANDIDATES_BASE =
  process.env.PHOTOCRAFT_CANDIDATES_BASE ?? "http://127.0.0.1:4104";
const BRIDGE_BASE =
  process.env.PHOTOCRAFT_BRIDGE_BASE ?? "http://127.0.0.1:4112";
const REPORT = join(
  root,
  ".tools/photocraft-serve-qa/mask-quality-report.json",
);

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
// Part 2 端到端样本：codex 点名类别「帽沿」，GT 在 manifest 内。
const E2E_IMAGE = "../photocraft-hat-teal.png";
const E2E_PHRASE = "帽沿";
const MASK_THRESHOLD = 128; // 与浏览器解码（红通道 ≥128）同口径
const BOUNDARY_RADIUS = 6; // mask 边界容差半径（切比雪夫距离，IMG-050 同口径）
const BOUNDARY_MAX_DIFF = 2; // 边界内允许的羽化舍入差（≤2/255）
const AREA_RATIO_TOLERANCE = 0.01; // area_ratio 交叉校验容差
const TOP_N = 3;

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const caseFilter =
  argv.indexOf("--case") >= 0 ? argv[argv.indexOf("--case") + 1] : null;

// ---- GT fixture 完整性校验（先于任何服务调用；失败即非零退出）--------------

const annotations = JSON.parse(
  await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(MASKS_DIR, "manifest.json"), "utf8"),
);

const annotationIndex = new Map(); // "image|phrase" -> {entry, target}
for (const entry of annotations.images)
  for (const target of entry.targets)
    annotationIndex.set(`${entry.image}|${target.phrase}`, { entry, target });

const fixtureErrors = [];
if (!Array.isArray(manifest.targets) || manifest.targets.length === 0)
  fixtureErrors.push("manifest.targets 为空：GT 蒙版清单缺失");
const gtTargets = []; // {image, phrase, entry, maskPath, maskBytes}
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
  if (!size) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版无法解析尺寸`,
    );
    continue;
  }
  if (size.width !== found.entry.width || size.height !== found.entry.height) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版 ${size.width}×${size.height} 与标注 ${found.entry.width}×${found.entry.height} 不一致`,
    );
    continue;
  }
  // 严格二值校验（解码级，parseImageSize 只读头）：GT 必须是 0/255 灰度。
  const gtMetadata = await sharpApi(maskBytes).metadata();
  if (
    gtMetadata.format !== "png" ||
    gtMetadata.channels !== 1 ||
    gtMetadata.depth !== "uchar"
  ) {
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版必须是 8bit 单通道灰度 PNG`,
    );
    continue;
  }
  const gtRaw = await sharpApi(maskBytes).raw().toBuffer({
    resolveWithObject: true,
  });
  let white = 0;
  let nonBinary = 0;
  for (const byte of gtRaw.data) {
    if (byte === 255) white += 1;
    else if (byte !== 0) nonBinary += 1;
  }
  if (nonBinary > 0)
    fixtureErrors.push(
      `${target.image} | ${target.phrase}：GT 蒙版含 ${nonBinary} 个非 0/255 像素（必须严格二值）`,
    );
  if (white === 0 || white === gtRaw.data.length)
    fixtureErrors.push(`${target.image} | ${target.phrase}：GT 蒙版全黑/全白`);
  if (fixtureErrors.length === 0)
    gtTargets.push({
      image: target.image,
      phrase: target.phrase,
      entry: found.entry,
      maskPath,
      maskBytes,
    });
}
if (fixtureErrors.length) {
  console.error("GT fixture 完整性校验失败：");
  for (const e of fixtureErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ---- :4104 就绪检查（版本串进报告便于复算）--------------------------------

const ready = await fetch(`${CANDIDATES_BASE}/health`, {
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

// ---- Part 1：逐目标 mask 指标 ----------------------------------------------

async function decodeCandidateMask(maskB64, gtWidth, gtHeight) {
  // 服务空间 mask → GT 分辨率：linear（双线性）近似浏览器画布平滑缩放，
  // 再按 ≥128 二值化（与 openTargetReview / candidate-mask.ts 同阈值）。
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
  // IoU = |G∧C|/|G∨C|；漏选 missRate = |G∧¬C|/|G|（GT 没被盖住的比例）；
  // 越界 spillRate = |C∧¬G|/|C|（候选涂到 GT 外的比例）。GT 空已在前置
  // 校验排除；候选空时 IoU=0、漏选=1、越界=0（无涂即无越界）。
  let gtCount = 0;
  let intersection = 0;
  for (let i = 0; i < gtBinary.length; i += 1) {
    if (gtBinary[i]) gtCount += 1;
    if (gtBinary[i] && candidateBinary[i]) intersection += 1;
  }
  const union = gtCount + candidateWhite - intersection;
  const candidateCount = candidateWhite;
  return {
    iou: union > 0 ? intersection / union : 0,
    missRate: gtCount > 0 ? (gtCount - intersection) / gtCount : 1,
    spillRate:
      candidateCount > 0 ? (candidateCount - intersection) / candidateCount : 0,
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

const records = [];
const errors = [];
let boxHitMaskFailTotal = 0;
for (const gt of gtTargets) {
  if (caseFilter && !gt.phrase.includes(caseFilter)) continue;
  const { bytes, contentType } = await loadFixtureImage(gt.image);
  const result = await fetchCandidates({
    base: CANDIDATES_BASE,
    imageBytes: bytes,
    contentType,
    phrase: gt.phrase,
  });
  if (result.error) {
    errors.push(`${gt.image} | ${gt.phrase}：${result.error}`);
    continue;
  }
  const response = result.response;
  const gtRaw = await sharpApi(gt.maskBytes).grayscale().raw().toBuffer({
    resolveWithObject: true,
  });
  const gtBinary = new Uint8Array(gtRaw.data.length);
  for (let i = 0; i < gtRaw.data.length; i += 1)
    gtBinary[i] = gtRaw.data[i] >= MASK_THRESHOLD ? 1 : 0;

  const ranked = normalizeCandidates(response); // 框归一 + score 降序（metrics 同源）
  const rawCandidates = [...response.candidates].sort(
    (a, b) => b.score - a.score,
  );
  const candidateRows = [];
  for (let rank = 0; rank < Math.min(TOP_N, rawCandidates.length); rank += 1) {
    const raw = rawCandidates[rank];
    const normalized = ranked[rank];
    // area_ratio 交叉校验（服务空间白像素占比 vs 服务自报 area_ratio）。
    const serviceMask = await sharpApi(Buffer.from(raw.mask_png_b64, "base64"))
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let serviceWhite = 0;
    for (const byte of serviceMask.data)
      if (byte >= MASK_THRESHOLD) serviceWhite += 1;
    const measuredRatio =
      serviceWhite / (serviceMask.info.width * serviceMask.info.height);
    const areaRatioGap = Math.abs((raw.area_ratio ?? 0) - measuredRatio);
    if (areaRatioGap > AREA_RATIO_TOLERANCE)
      errors.push(
        `${gt.image} | ${gt.phrase} #${rank + 1}：area_ratio=${raw.area_ratio} 与 mask 白像素占比 ${measuredRatio.toFixed(4)} 偏差 ${areaRatioGap.toFixed(4)} > ${AREA_RATIO_TOLERANCE}（基础设施错）`,
      );
    const decoded = await decodeCandidateMask(
      raw.mask_png_b64,
      gt.entry.width,
      gt.entry.height,
    );
    const metrics = maskMetrics(gtBinary, decoded.binary, decoded.white);
    const boxIou = bestIou(normalized.box, [
      gt.entry.targets.find((t) => t.phrase === gt.phrase).boxes[0],
    ]);
    candidateRows.push({
      rank: rank + 1,
      score: raw.score,
      clipScore: raw.clip_score,
      maskBytesB64: raw.mask_png_b64.length,
      boxIou: Number(boxIou.toFixed(4)),
      maskIou: Number(metrics.iou.toFixed(4)),
      missRate: Number(metrics.missRate.toFixed(4)),
      spillRate: Number(metrics.spillRate.toFixed(4)),
      areaRatioGap: Number(areaRatioGap.toFixed(4)),
    });
  }
  const best = candidateRows.reduce(
    (acc, row) => (acc === null || row.maskIou > acc.maskIou ? row : acc),
    null,
  );
  // boxHitMaskFail：存在候选框 IoU≥0.5（旧口径会判「命中」）但该目标最佳
  // mask IoU<0.5（实际像素选区不可用）——框好 ≠ 可精修的直接证据。
  const boxHitMaskFail =
    candidateRows.some((row) => row.boxIou >= 0.5) &&
    (best === null || best.maskIou < 0.5);
  if (boxHitMaskFail) boxHitMaskFailTotal += 1;
  records.push({
    image: gt.image,
    phrase: gt.phrase,
    noCandidates: candidateRows.length === 0,
    candidates: candidateRows,
    best,
    boxHitMaskFail,
    tookMs: response.took_ms,
  });
}

// ---- Part 1 汇总 ------------------------------------------------------------

const evaluated = records.filter((r) => !r.noCandidates);
const bestIous = evaluated.map((r) => r.best.maskIou).sort((a, b) => a - b);
const mean = (xs) =>
  xs.length === 0
    ? null
    : Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(4));
const median = (xs) => (xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null);
const summary = {
  gtTargetsTotal: gtTargets.length,
  evaluated: evaluated.length,
  noCandidates: records.length - evaluated.length,
  bestMaskIou: {
    mean: mean(bestIous),
    median:
      median(bestIous) === null ? null : Number(median(bestIous).toFixed(4)),
    min: bestIous[0] ?? null,
    max: bestIous[bestIous.length - 1] ?? null,
    geHalf: bestIous.filter((v) => v >= 0.5).length,
  },
  atBest: {
    meanMissRate: mean(evaluated.map((r) => r.best.missRate)),
    meanSpillRate: mean(evaluated.map((r) => r.best.spillRate)),
    meanBoxIou: mean(evaluated.map((r) => r.best.boxIou)),
  },
  boxHitMaskFail: boxHitMaskFailTotal,
  boxHitMaskFailTargets: records
    .filter((r) => r.boxHitMaskFail)
    .map((r) => `${basename(r.image)} | ${r.phrase}`),
};

// ---- Part 2：端到端 mask 选区（真桥 + 保存重开 + mask 外像素不变）-----------

async function runEndToEnd() {
  const failures = [];
  const gt = gtTargets.find(
    (t) => t.image === E2E_IMAGE && t.phrase === E2E_PHRASE,
  );
  if (!gt)
    return {
      ok: false,
      failures: [
        `端到端样本缺失：${basename(E2E_IMAGE)} | ${E2E_PHRASE} 不在 manifest.targets`,
      ],
    };
  const original = await readFile(join(FIXTURE_DIR, E2E_IMAGE));
  // 1. GT mask 上传（浏览器同款通道：raw PNG body → {id,width,height}）。
  const upload = await fetch(`${BRIDGE_BASE}/v1/selection-mask`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: gt.maskBytes,
  });
  if (!upload.ok)
    return { ok: false, failures: [`蒙版上传失败：${upload.status}`] };
  const uploaded = await upload.json();
  if (uploaded.width !== gt.entry.width || uploaded.height !== gt.entry.height)
    failures.push(
      `上传回执尺寸 ${uploaded.width}×${uploaded.height} 与标注 ${gt.entry.width}×${gt.entry.height} 不一致`,
    );
  // 2. mask 法局部编辑（brim=帽沿 提亮，生产同款 /v1/instruction）。
  // target 用 brim 而非 subject：subject/background 是主体级目标，桥强制
  // 走 provider 选区来源（dev-bridge 400「主体或背景编辑需要 AI 主体蒙版
  // 选区来源」）；mask 法的语义是「候选蒙版即精确范围」。
  const plan = {
    operation: "adjust",
    adjustment: "brightness",
    amount: 12,
    target: "brim",
    protectLabel: false,
  };
  const planJson = JSON.stringify(plan);
  const instructionResponse = await fetch(`${BRIDGE_BASE}/v1/instruction`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      ...(/[^\u0000-ÿ]/.test(planJson)
        ? { "X-Acs-Plan-B64": Buffer.from(planJson, "utf8").toString("base64") }
        : { "X-Acs-Plan": planJson }),
      "X-Acs-Points": "[]",
      "X-Acs-Rect": "null",
      "X-Acs-Outline": "[]",
      "X-Acs-Patches": "[]",
      "X-Acs-Edge-Shift": "0",
      "X-Acs-Edge-Feather": "0",
      "X-Acs-Protect-Rect": "null",
      "X-Acs-Selection-Method": "mask",
      "x-acs-selection-mask-id": String(uploaded.id),
      "X-Acs-Heal-Size": "32",
      "X-Acs-Provider-Scope-Feather": "20",
    },
    body: original,
  });
  if (!instructionResponse.ok) {
    const detail = await instructionResponse.text();
    return {
      ok: false,
      failures: [
        `mask 法 instruction 失败：${instructionResponse.status} ${detail.slice(0, 200)}`,
      ],
    };
  }
  const instruction = await instructionResponse.json();
  if (!instruction.selectionBounds)
    failures.push("instruction 后 selectionBounds 为空（mask 选区未生效）");
  const jobId = String(instruction.sourceUrl).split("/")[3];
  // 3. 保存重开检查：.pcraft 持久化活跃选区（PSD 不持久化为已知引擎边界）。
  const sourceResponse = await fetch(`${BRIDGE_BASE}/v1/jobs/${jobId}/source`);
  if (!sourceResponse.ok)
    return {
      ok: false,
      failures: [`取回 source 失败：${sourceResponse.status}`],
    };
  const saved = Buffer.from(await sourceResponse.arrayBuffer());
  const inspectResponse = await fetch(`${BRIDGE_BASE}/v1/inspect`, {
    method: "POST",
    headers: { "content-type": "application/x-photocraft" },
    body: saved,
  });
  if (!inspectResponse.ok) {
    const detail = await inspectResponse.text();
    return {
      ok: false,
      failures: [
        `保存重开 inspect 失败：${inspectResponse.status} ${detail.slice(0, 200)}`,
      ],
    };
  }
  const inspect = await inspectResponse.json();
  if (inspect.hasSelection !== true)
    failures.push("保存重开后 hasSelection=false（.pcraft 应持久化选区）");
  // 4. 像素口径：preview vs 原图，GT mask 外（>6px）逐字节一致，边界 ≤2/255，
  //    mask 内必须有改动（选区真的把编辑限定在 mask 内）。
  const previewResponse = await fetch(
    `${BRIDGE_BASE}/v1/jobs/${jobId}/preview`,
  );
  if (!previewResponse.ok)
    return {
      ok: false,
      failures: [`取回 preview 失败：${previewResponse.status}`],
    };
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  const pixel = await pixelScope(
    join(FIXTURE_DIR, E2E_IMAGE),
    preview,
    gt.maskBytes,
  );
  if (pixel.sizeMismatch)
    failures.push(`preview 与原图 ${pixel.sizeMismatch}，无法做像素对比`);
  if (pixel.outside.changedFarFromBoundary > 0)
    failures.push(
      `mask 外（>${BOUNDARY_RADIUS}px）有 ${pixel.outside.changedFarFromBoundary} 个像素被改动（零容忍）`,
    );
  if ((pixel.outside.changedMaxChannelDiff ?? 0) > BOUNDARY_MAX_DIFF)
    failures.push(
      `mask 边界（≤${BOUNDARY_RADIUS}px）改动 maxChannelDiff=${pixel.outside.changedMaxChannelDiff} > ${BOUNDARY_MAX_DIFF}`,
    );
  if (pixel.insideMask.changedPixels === 0)
    failures.push("mask 内没有任何像素改动（提亮未作用于选区）");
  return {
    ok: failures.length === 0,
    jobId,
    upload: { width: uploaded.width, height: uploaded.height },
    instructionSelectionBounds: instruction.selectionBounds,
    inspect: {
      hasSelection: inspect.hasSelection,
      selectionBounds: inspect.selectionBounds,
    },
    pixel,
    failures,
  };
}

async function pixelScope(originalPath, previewBytes, maskBytes) {
  // IMG-050 preview-consistency 同款：ensureAlpha → raw 逐像素对比；GT 是
  // 0/255 二值，≥128 即 mask 内。边界距离用有界切比雪夫搜索（≤6px）。
  const [original, rendered] = await Promise.all([
    sharpApi(originalPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharpApi(previewBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  if (
    original.info.width !== rendered.info.width ||
    original.info.height !== rendered.info.height
  )
    return {
      sizeMismatch: `尺寸不一致：${original.info.width}×${original.info.height} vs ${rendered.info.width}×${rendered.info.height}`,
      outside: { changedFarFromBoundary: -1, changedMaxChannelDiff: -1 },
      insideMask: { changedPixels: -1 },
    };
  const mask = await sharpApi(maskBytes)
    .resize(original.info.width, original.info.height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = original.info.width;
  const height = original.info.height;
  const channels = original.info.channels;
  const distanceToMask = (x, y, radius) => {
    for (let d = 1; d <= radius; d += 1)
      for (let dx = -d; dx <= d; dx += 1)
        for (let dy = -d; dy <= d; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask.data[ny * width + nx] >= MASK_THRESHOLD) return d;
        }
    return null;
  };
  const outside = {
    checkedPixels: 0,
    changedPixels: 0,
    changedFarFromBoundary: 0,
    changedMaxChannelDiff: 0,
  };
  const insideMask = { checkedPixels: 0, changedPixels: 0 };
  for (let p = 0; p < width * height; p += 1) {
    let pixelDiff = 0;
    for (let c = 0; c < 3; c += 1)
      pixelDiff = Math.max(
        pixelDiff,
        Math.abs(
          original.data[p * channels + c] - rendered.data[p * channels + c],
        ),
      );
    if (mask.data[p] >= MASK_THRESHOLD) {
      insideMask.checkedPixels += 1;
      if (pixelDiff > 0) insideMask.changedPixels += 1;
      continue;
    }
    outside.checkedPixels += 1;
    if (pixelDiff === 0) continue;
    outside.changedPixels += 1;
    outside.changedMaxChannelDiff = Math.max(
      outside.changedMaxChannelDiff,
      pixelDiff,
    );
    const distance = distanceToMask(
      p % width,
      Math.floor(p / width),
      BOUNDARY_RADIUS,
    );
    if (distance === null) outside.changedFarFromBoundary += 1;
  }
  return { outside, insideMask };
}

const endToEnd = await runEndToEnd();

// ---- 报告与控制台 ------------------------------------------------------------

const report = {
  candidatesService: CANDIDATES_BASE,
  bridge: BRIDGE_BASE,
  serviceVersion,
  manifestMethod: manifest.method,
  tolerance: `mask 外（>${BOUNDARY_RADIUS}px）逐字节一致；边界 ≤${BOUNDARY_RADIUS}px 允许 ≤${BOUNDARY_MAX_DIFF}/255；area_ratio 偏差 ≤${AREA_RATIO_TOLERANCE}；mask 指标阈值 ${MASK_THRESHOLD}`,
  subset: caseFilter !== null,
  executedAt: new Date().toISOString(),
  summary,
  records,
  endToEnd,
  errors,
};
const reportPath =
  caseFilter === null ? REPORT : REPORT.replace(/\.json$/, ".subset.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));

const failures = [...errors, ...endToEnd.failures];
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`C 项 mask 质量评测 @ ${CANDIDATES_BASE} + ${BRIDGE_BASE}`);
  console.log(`服务版本：${serviceVersion}`);
  console.log(
    `GT：${gtTargets.length} 目标（manifest.method 见报告）；评测 ${summary.evaluated}，无候选 ${summary.noCandidates}`,
  );
  console.log(
    "目标                     候选  best maskIoU  漏选    越界    best boxIoU  框过mask挂",
  );
  for (const record of records) {
    if (record.noCandidates) {
      console.log(
        `${record.phrase.padEnd(24)} 0     —             —       —       —            —`,
      );
      continue;
    }
    console.log(
      `${record.phrase.padEnd(24)} ${record.candidates.length}     ` +
        `${String(record.best.maskIou.toFixed(3)).padEnd(13)} ` +
        `${String(record.best.missRate.toFixed(3)).padEnd(7)} ` +
        `${String(record.best.spillRate.toFixed(3)).padEnd(7)} ` +
        `${String(record.best.boxIou.toFixed(3)).padEnd(12)} ` +
        `${record.boxHitMaskFail ? "✗ 是" : "否"}`,
    );
  }
  console.log(
    `汇总：best maskIoU mean=${summary.bestMaskIou.mean} median=${summary.bestMaskIou.median} ≥0.5 ${summary.bestMaskIou.geHalf}/${summary.evaluated}；` +
      `best 口径平均漏选 ${summary.atBest.meanMissRate}、越界 ${summary.atBest.meanSpillRate}、框IoU ${summary.atBest.meanBoxIou}；` +
      `boxHitMaskFail ${summary.boxHitMaskFail}（${summary.boxHitMaskFailTargets.join("、") || "无"}）`,
  );
  console.log(
    `端到端（${basename(E2E_IMAGE)} | ${E2E_PHRASE}）：${endToEnd.ok ? "通过" : "失败"}` +
      (endToEnd.inspect
        ? `，保存重开 hasSelection=${endToEnd.inspect.hasSelection}`
        : "") +
      (endToEnd.pixel
        ? `，mask 外改动 ${endToEnd.pixel.outside.changedPixels}/${endToEnd.pixel.outside.checkedPixels}（远界 ${endToEnd.pixel.outside.changedFarFromBoundary}），mask 内改动 ${endToEnd.pixel.insideMask.changedPixels}/${endToEnd.pixel.insideMask.checkedPixels}`
        : ""),
  );
  for (const failure of endToEnd.failures) console.log(`  ✗ ${failure}`);
  if (errors.length) {
    console.log("执行错误：");
    for (const error of errors) console.log(`  ✗ ${error}`);
  }
  console.log(`报告：${reportPath}`);
}
// 口径：fixture/服务/断言失败 → 非零退出；mask 质量低（IoU/漏选/越界数字
// 难看、boxHitMaskFail 多）是评测发现，只进报告不失败——是否允许自动选中
// 另行决策，TAU_AUTO_ENABLED 维持 false。
if (failures.length > 0) process.exitCode = 1;
