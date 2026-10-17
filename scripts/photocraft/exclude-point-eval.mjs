// 剔除点评测（蒙版代数交互的量化，第八轮）：用户在画框限定候选上点选
// 「这块不要」（花蕊/猫脸）→ X-Acs-Exclude-Points 负点重圈，能否把
// 「候选 − 误选区域」变成正确的部件级选区。
//
// GT 用已有蒙版的布尔代数派生（这正是「蒙版代数」承诺的形态，评测侧同款）：
//   花瓣 = 花朵 ∧ ¬花蕊（hibiscus）  耳朵 = 猫头 ∧ ¬猫脸（fluffy-cat）
// 模拟交互全部从 GT 推导，零新标注：画框 = 整体目标的标注框（用户圈「花」
// 而非「花瓣」的真实形态），剔除点 = 误选子区域 GT 蒙版的质心（用户点
// 花蕊正中间的真实形态）。
//
// 口径同 box-constrained-eval：三臂对比（box-only / box+exclude /
// box+exclude+ensemble），top1/best IoU + 漏选/越界；质量差是评测发现，
// fixture/服务错才非零退出；派生 GT 的非独立性（SAM 家族起草 + 人工终审，
// 见 masks/manifest.json）如实随报告输出。
// 用法：node scripts/photocraft/exclude-point-eval.mjs [--json]
// 依赖：:4104 parts-candidates（venv-sam2）、masks/{花朵,花蕊,猫头,猫脸}.png。

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

import { fetchCandidates, parseImageSize } from "./grounding-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "apps/api/package.json"));
const sharpApi = require("sharp");

const FIXTURE_DIR = join(root, "qa/fixtures/photocraft-grounding");
const MASKS_DIR = join(FIXTURE_DIR, "masks");
const CANDIDATES_BASE =
  process.env.PHOTOCRAFT_CANDIDATES_BASE ?? "http://127.0.0.1:4104";
const REPORT = join(
  root,
  ".tools/photocraft-serve-qa/exclude-point-report.json",
);

const CONTENT_TYPES = { ".jpg": "image/jpeg", ".png": "image/png" };
const MASK_THRESHOLD = 128;
const TOP_N = 3;
const asJson = process.argv.includes("--json");

// ---- 派生 GT：整体 − 子区域 = 部件（蒙版代数）---------------------------

const DERIVED_CASES = [
  {
    image: "hibiscus-brilliant.jpg",
    wholePhrase: "花朵",
    subtractPhrases: ["花蕊"],
    partPhrase: "花瓣",
  },
  {
    image: "photocraft-fluffy-cat-cc0.jpg",
    wholePhrase: "猫头",
    subtractPhrases: ["猫脸"],
    partPhrase: "耳朵",
  },
];

const annotations = JSON.parse(
  await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(MASKS_DIR, "manifest.json"), "utf8"),
);

const manifestIndex = new Set(
  (manifest.targets ?? []).map((t) => `${basename(t.image)}|${t.phrase}`),
);
const fixtureErrors = [];

async function loadBinaryMask(image, phrase) {
  const path = join(MASKS_DIR, basename(image), `${phrase}.png`);
  const bytes = await readFile(path);
  const raw = await sharpApi(bytes).grayscale().raw().toBuffer({
    resolveWithObject: true,
  });
  return { data: raw.data, width: raw.info.width, height: raw.info.height };
}

const cases = [];
for (const spec of DERIVED_CASES) {
  // 派生组件必须都在 manifest（已复核的 GT）里——不拿未复核蒙版当真值。
  for (const phrase of [spec.wholePhrase, ...spec.subtractPhrases]) {
    if (!manifestIndex.has(`${basename(spec.image)}|${phrase}`))
      fixtureErrors.push(`${spec.image} | ${phrase}：不在 GT manifest 内`);
  }
  const entry = annotations.images.find(
    (i) => basename(i.image) === basename(spec.image),
  );
  const whole = entry?.targets.find((t) => t.phrase === spec.wholePhrase);
  if (!whole || whole.boxes.length !== 1) {
    fixtureErrors.push(
      `${spec.image} | ${spec.wholePhrase}：需要恰好 1 个标注框作模拟画框`,
    );
    continue;
  }
  const wholeMask = await loadBinaryMask(spec.image, spec.wholePhrase);
  const subMasks = [];
  for (const phrase of spec.subtractPhrases) {
    const sub = await loadBinaryMask(spec.image, phrase);
    if (sub.width !== wholeMask.width || sub.height !== wholeMask.height) {
      fixtureErrors.push(
        `${spec.image}：${spec.wholePhrase} 与 ${phrase} GT 尺寸不一致`,
      );
      continue;
    }
    subMasks.push(sub);
  }
  // 布尔代数：part = whole ∧ ¬sub；同时算 sub 的质心（= 模拟用户点击处）。
  const derived = new Uint8Array(wholeMask.data.length);
  let partCount = 0;
  let subCount = 0;
  const centroids = subMasks.map(() => ({ sx: 0, sy: 0, n: 0 }));
  for (let i = 0; i < wholeMask.data.length; i += 1) {
    const wholeOn = wholeMask.data[i] >= MASK_THRESHOLD;
    let subtracted = false;
    for (let s = 0; s < subMasks.length; s += 1) {
      const subOn = subMasks[s].data[i] >= MASK_THRESHOLD;
      if (subOn) {
        subtracted = true;
        subCount += 1;
        const y = Math.floor(i / wholeMask.width);
        const x = i % wholeMask.width;
        centroids[s].sx += x;
        centroids[s].sy += y;
        centroids[s].n += 1;
      }
    }
    if (wholeOn && !subtracted) {
      derived[i] = 1;
      partCount += 1;
    }
  }
  if (partCount === 0 || subCount === 0) {
    fixtureErrors.push(
      `${spec.image}：派生 ${spec.partPhrase} 为空（whole=${spec.wholePhrase} sub=${spec.subtractPhrases.join("+")}）`,
    );
    continue;
  }
  const excludePoints = centroids.map((c) => [
    Number((c.sx / c.n / wholeMask.width).toFixed(4)),
    Number((c.sy / c.n / wholeMask.height).toFixed(4)),
  ]);
  const [bx, by, bw, bh] = whole.boxes[0];
  cases.push({
    image: spec.image,
    // annotations 对上两级 fixture（猫/帽图在 qa/fixtures/ 根）用 ../ 引用，
    // 文件加载走原始路径，报告/键名用 basename。
    sourceImage: entry.image,
    phrase: spec.partPhrase,
    wholePhrase: spec.wholePhrase,
    subtractPhrases: spec.subtractPhrases,
    promptBox: [
      Number(bx.toFixed(4)),
      Number(by.toFixed(4)),
      Number((bx + bw).toFixed(4)),
      Number((by + bh).toFixed(4)),
    ],
    excludePoints,
    gt: derived,
    gtWidth: wholeMask.width,
    gtHeight: wholeMask.height,
    partPixels: partCount,
    subtractPixels: subCount,
  });
}
if (!cases.length && !fixtureErrors.length)
  fixtureErrors.push("DERIVED_CASES 为空");
if (fixtureErrors.length) {
  console.error("派生 GT 完整性校验失败：");
  for (const e of fixtureErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ---- :4104 就绪检查 -------------------------------------------------------

const ready = await fetch(`${CANDIDATES_BASE}/health`, {
  headers: { Origin: "http://localhost:3000" },
});
if (!ready.ok) {
  console.error(`parts-candidates 服务未就绪：GET /health → ${ready.status}`);
  process.exit(1);
}
const serviceVersion = (await ready.text()).trim();

// ---- 指标（box-constrained-eval 同款实现）--------------------------------

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

const records = [];
const errors = [];
for (const spec of cases) {
  const ext = spec.image.slice(spec.image.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  const imageBytes = await readFile(join(FIXTURE_DIR, spec.sourceImage));
  const arms = [
    { label: "box", excludePoints: null, rank: null },
    { label: "box+exclude", excludePoints: spec.excludePoints, rank: null },
    {
      label: "box+exclude+ensemble",
      excludePoints: spec.excludePoints,
      rank: "ensemble",
    },
  ];
  const record = {
    image: spec.image,
    phrase: spec.phrase,
    derivedFrom: `${spec.wholePhrase} − ${spec.subtractPhrases.join(" − ")}`,
    promptBox: spec.promptBox,
    excludePoints: spec.excludePoints,
    partPixels: spec.partPixels,
    subtractPixels: spec.subtractPixels,
    arms: {},
  };
  for (const arm of arms) {
    const result = await fetchCandidates({
      base: CANDIDATES_BASE,
      imageBytes,
      contentType,
      phrase: spec.phrase,
      promptBox: spec.promptBox,
      excludePoints: arm.excludePoints,
      rank: arm.rank,
    });
    if (result.error) {
      errors.push(
        `${spec.image} | ${spec.phrase} | ${arm.label}：${result.error}`,
      );
      continue;
    }
    const rows = [];
    const sorted = [...result.response.candidates].sort(
      (a, b) => b.score - a.score,
    );
    for (let rank = 0; rank < Math.min(TOP_N, sorted.length); rank += 1) {
      const raw = sorted[rank];
      const decoded = await decodeCandidateMask(
        raw.mask_png_b64,
        spec.gtWidth,
        spec.gtHeight,
      );
      const metrics = maskMetrics(spec.gt, decoded.binary, decoded.white);
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
    record.arms[arm.label] = {
      tookMs: result.response.took_ms,
      candidates: rows,
      best,
    };
  }
  records.push(record);
  if (!asJson) {
    const line = (label) => {
      const arm = record.arms[label];
      return arm
        ? `top1=${arm.candidates[0]?.maskIou?.toFixed(3) ?? "—"} best=${arm.best?.maskIou?.toFixed(3) ?? "—"}`
        : "✗";
    };
    console.log(
      `${spec.phrase}（${record.derivedFrom}）  box ${line("box")}  +exclude ${line("box+exclude")}  +exclude+ens ${line("box+exclude+ensemble")}`,
    );
  }
}

const summary = {
  cases: records.length,
  note: "派生 GT = 已复核整体蒙版 − 子区域蒙版（布尔代数；组件均为 SAM 家族起草+两轮 VLM 复核+人工终审，非独立标注）。模拟交互：画框=整体目标标注框、剔除点=子区域 GT 质心。报告 only：不据此改默认入口。",
  derivedMethod: manifest.method,
  records: records.map((r) => ({
    phrase: r.phrase,
    boxTop1: r.arms.box?.candidates[0]?.maskIou ?? null,
    boxBest: r.arms.box?.best?.maskIou ?? null,
    excludeTop1: r.arms["box+exclude"]?.candidates[0]?.maskIou ?? null,
    excludeBest: r.arms["box+exclude"]?.best?.maskIou ?? null,
    excludeEnsembleTop1:
      r.arms["box+exclude+ensemble"]?.candidates[0]?.maskIou ?? null,
  })),
};

const report = {
  candidatesService: CANDIDATES_BASE,
  serviceVersion,
  executedAt: new Date().toISOString(),
  summary,
  records,
  errors,
};
await writeFile(REPORT, JSON.stringify(report, null, 2));

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`剔除点评测（蒙版代数）@ ${CANDIDATES_BASE}`);
  console.log(`服务版本：${serviceVersion}`);
  console.log(`报告：${REPORT}`);
  if (errors.length) {
    console.log("执行错误：");
    for (const error of errors) console.log(`  ✗ ${error}`);
  }
}
if (errors.length > 0) process.exitCode = 1;
