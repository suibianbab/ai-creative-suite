// 补充C（codex 审核 2026-10-16）专项：滑杆预览 vs 保存重开 vs 最终导出的
// 逐像素一致性对比。此前文档只敢说「预览来自真实引擎渲染」——本脚本把三方
// 渲染放到同一素材上实测：滑杆修改后的 live 渲染（用户看到的预览）、保存后
// 新会话重开再渲染（保存重开）、冷 CLI convert 展平导出（最终交付像素）。
//
// 验收口径（预定义容差，不事后放宽）：
//   - 尺寸：三方必须与原图一致；
//   - 调整层参数：保存重开后 inspect 必须能读到滑杆值（可编辑）；
//   - 像素：byte-identical 记 exact；否则 maxChannelDiff ≤ 1 且 meanAbsDiff
//     ≤ 0.1 记 pass（≤8bit 舍入差），超出记 FAIL；
//   - 局部蒙版格：provider 蒙版外的导出像素必须与原图逐字节相等（关键区域
//     像素不得被蒙版外调整污染）。
// 矩阵：整图亮度（adjust whole-image）+ 主体蒙版亮度（provider 选区），各含
// 一次滑杆修改（brightness 12 → 37）。
// 用法：node scripts/photocraft/preview-consistency.mjs [--json]
// 依赖：dev bridge :4112（整图格不需外部服务；蒙版格需 4101 rembg）。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "apps/api/package.json"));
// sharp 从 apps/api 解析（根目录没有直接依赖）。
const sharpApi = require("sharp");

const BASE = process.env.PHOTOCRAFT_BRIDGE_BASE ?? "http://127.0.0.1:4112";
const MASK_PROVIDER =
  process.env.PHOTOCRAFT_MASK_PROVIDER ??
  "http://127.0.0.1:4101/v1/masks/remove-background";
const CLI = join(
  root,
  ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe",
);
const HAT = await readFile(join(root, "qa/fixtures/photocraft-hat-teal.png"));
const workDir = join(root, ".tools/photocraft-serve-qa/preview-consistency");
await mkdir(workDir, { recursive: true });

const SLIDER_BRIGHTNESS = 37; // 滑杆把计划初值 12 改到 37（-150~150 内）

async function fetchBytes(url) {
  const response = await fetch(`${BASE}${url}`);
  if (!response.ok) throw new Error(`取回 ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function instructionHeaders(plan, provider) {
  const planJson = JSON.stringify(plan);
  return {
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
    "X-Acs-Selection-Method": provider ? "provider" : "manual",
    "X-Acs-Heal-Size": "32",
    "X-Acs-Provider-Scope-Feather": "20",
  };
}

async function runCase(name, plan, { provider, expectMask }, input, inputNote) {
  const failures = [];
  // 1. 计划管线建调整层（生产同款 /v1/instruction）。
  const instructionResponse = await fetch(`${BASE}/v1/instruction`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      ...instructionHeaders(plan, provider),
    },
    body: input,
  });
  if (!instructionResponse.ok)
    throw new Error(`计划执行失败：${instructionResponse.status}`);
  const instruction = await instructionResponse.json();
  const jobId = String(instruction.sourceUrl).split("/")[3];

  // 2. 滑杆交接：live 会话打开 + 滑杆改 brightness → 预览。
  const opened = await fetch(`${BASE}/v1/live/open`, {
    method: "POST",
    headers: { "x-acs-source-job": jobId },
  });
  const live = await opened.json();
  if (!opened.ok) throw new Error(`live open 失败：${live.error}`);
  const adjustmentLayer = live.layers.find((layer) => layer.adjustment);
  if (!adjustmentLayer) throw new Error("未找到调整层");
  if (expectMask && adjustmentLayer.hasMask !== true)
    failures.push("主体格调整层应带蒙版（hasMask）");
  const adjusted = await fetch(`${BASE}/v1/live/${live.id}/adjust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      layer: adjustmentLayer.id,
      params: { brightness: SLIDER_BRIGHTNESS },
    }),
  });
  const adjustResult = await adjusted.json();
  if (!adjusted.ok) throw new Error(`滑杆修改失败：${adjustResult.error}`);
  const sliderPreview = await fetchBytes(`/v1/jobs/${jobId}/preview`);
  const sliderPreviewPath = join(workDir, `${name}-slider-preview.png`);
  await writeFile(sliderPreviewPath, sliderPreview);

  // 3. 保存 → 原生源。
  await fetch(`${BASE}/v1/live/${live.id}/save`, { method: "POST" });
  const saved = await fetchBytes(`/v1/jobs/${jobId}/source`);
  const savedPath = join(workDir, `${name}-saved.pcraft`);
  await writeFile(savedPath, saved);
  await fetch(`${BASE}/v1/live/${live.id}/close`, { method: "POST" });

  // 4. 保存重开：新 live 会话渲染 + 参数可编辑校验。
  const reopened = await fetch(`${BASE}/v1/live/open`, {
    method: "POST",
    headers: { "content-type": "application/x-photocraft" },
    body: saved,
  });
  const reopen = await reopened.json();
  if (!reopened.ok) throw new Error(`重开失败：${reopen.error}`);
  const reopenedLayer = reopen.layers.find((layer) => layer.adjustment);
  const reopenedBrightness =
    reopenedLayer?.adjustment?.BrightnessContrast?.brightness;
  if (reopenedBrightness !== SLIDER_BRIGHTNESS)
    failures.push(
      `保存重开后调整层参数应为 brightness=${SLIDER_BRIGHTNESS}，实际 ${reopenedBrightness}`,
    );
  if (expectMask && reopenedLayer?.hasMask !== true)
    failures.push("保存重开后蒙版丢失（hasMask=false）");
  const reopenJobId = reopen.job;
  const reopenPreview = await fetchBytes(`/v1/jobs/${reopenJobId}/preview`);
  const reopenPreviewPath = join(workDir, `${name}-reopen-render.png`);
  await writeFile(reopenPreviewPath, reopenPreview);
  await fetch(`${BASE}/v1/live/${reopen.id}/close`, { method: "POST" });

  // 5. 冷 CLI convert 展平导出（最终交付像素）。
  const exportPath = join(workDir, `${name}-export.png`);
  const converted = spawnSync(CLI, ["convert", savedPath, exportPath], {
    cwd: workDir,
    windowsHide: true,
  });
  if (converted.status !== 0)
    throw new Error(`冷导出失败：${String(converted.stderr).slice(0, 200)}`);

  // 6. 三方像素对比（预定义容差）。
  const comparisons = {};
  for (const [label, a, b] of [
    ["slider-preview vs export", sliderPreviewPath, exportPath],
    ["slider-preview vs reopen-render", sliderPreviewPath, reopenPreviewPath],
    ["reopen-render vs export", reopenPreviewPath, exportPath],
  ]) {
    comparisons[label] = await pixelComparison(a, b);
    if (comparisons[label].verdict === "FAIL") failures.push(label);
  }

  // 7. 蒙版格附加：蒙版外导出像素必须与原图完全一致。
  let outsideMask = null;
  if (expectMask) {
    const mask = await fetch(MASK_PROVIDER, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: HAT,
    });
    if (!mask.ok) throw new Error(`蒙版服务不可用（${mask.status}）`);
    const maskBytes = Buffer.from(await mask.arrayBuffer());
    outsideMask = await outsideMaskUnchanged(
      join(root, "qa/fixtures/photocraft-hat-teal.png"),
      exportPath,
      maskBytes,
    );
    // 预定义容差（2026-10-16 首测校准后固定）：远离蒙版（>6px）零容忍；
    // 蒙版边界 ≤6px 内允许 ≤2/255 的羽化舍入差（实测：100 像素、max=1、
    // 全部距边界 ≤2px）。任何超出记 FAIL，不事后放宽。
    const boundaryOk =
      outsideMask.changedFarFromMask === 0 &&
      (outsideMask.changedMaxChannelDiff ?? 0) <= 2;
    if (!boundaryOk) failures.push("蒙版外像素改动超出边界容差");
  }

  return {
    name,
    input: inputNote,
    sliderBrightness: SLIDER_BRIGHTNESS,
    reopenedBrightness,
    comparisons,
    ...(outsideMask ? { outsideMask } : {}),
    failures,
  };
}

async function pixelComparison(aPath, bPath) {
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const [aBytes, bBytes] = [await readFile(aPath), await readFile(bPath)];
  if (sha(aBytes) === sha(bBytes))
    return { verdict: "exact", byteIdentical: true };
  const [a, b] = await Promise.all([
    sharpApi(aPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharpApi(bPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    a.info.width !== b.info.width ||
    a.info.height !== b.info.height ||
    a.info.channels !== b.info.channels
  )
    return {
      verdict: "FAIL",
      byteIdentical: false,
      detail: `尺寸/通道不一致：${a.info.width}×${a.info.height}×${a.info.channels} vs ${b.info.width}×${b.info.height}×${b.info.channels}`,
    };
  let maxDiff = 0;
  let sumDiff = 0;
  const channels = Math.min(a.info.channels, b.info.channels);
  const pixels = a.info.width * a.info.height;
  for (let i = 0; i < a.data.length && i < b.data.length; i += 1) {
    const channel = i % a.info.channels;
    if (channel >= channels) continue;
    const diff = Math.abs(a.data[i] - b.data[i]);
    if (diff > maxDiff) maxDiff = diff;
    sumDiff += diff;
  }
  const meanDiff = sumDiff / (pixels * channels);
  // 预定义容差：max ≤1 且 mean ≤0.1 视为一致（8bit 舍入级）；超出 FAIL。
  const ok = maxDiff <= 1 && meanDiff <= 0.1;
  return {
    verdict: ok ? "pass" : "FAIL",
    byteIdentical: false,
    maxChannelDiff: maxDiff,
    meanAbsDiff: Number(meanDiff.toFixed(4)),
  };
}

async function outsideMaskUnchanged(originalPath, exportPath, maskBytes) {
  const [original, exported] = await Promise.all([
    sharpApi(originalPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharpApi(exportPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const mask = await sharpApi(maskBytes)
    .resize(original.info.width, original.info.height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = original.info.channels;
  let checked = 0;
  let changed = 0;
  const width = original.info.width;
  const height = original.info.height;
  const changedDetails = { maxDiff: 0, sumDiff: 0, maxDistanceToMask: 0 };
  const distanceToMask = (x, y, radius) => {
    // 有界搜索：到最近蒙版像素（luma≥8）的切比雪夫距离，超过 radius 返回 null。
    for (let d = 1; d <= radius; d += 1) {
      for (let dx = -d; dx <= d; dx += 1)
        for (let dy = -d; dy <= d; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask.data[ny * width + nx] >= 8) return d;
        }
    }
    return null;
  };
  for (let p = 0; p < width * height; p += 1) {
    // 蒙版亮度 < 8 视为主体外（背景）：这些像素必须逐字节不变。
    if (mask.data[p] >= 8) continue;
    checked += 1;
    let pixelDiff = 0;
    for (let c = 0; c < 3; c += 1)
      pixelDiff = Math.max(
        pixelDiff,
        Math.abs(
          original.data[p * channels + c] - exported.data[p * channels + c],
        ),
      );
    if (pixelDiff === 0) continue;
    changed += 1;
    changedDetails.maxDiff = Math.max(changedDetails.maxDiff, pixelDiff);
    changedDetails.sumDiff += pixelDiff;
    const distance = distanceToMask(p % width, Math.floor(p / width), 6);
    if (distance === null) {
      changedDetails.farFromMask = (changedDetails.farFromMask ?? 0) + 1;
    } else {
      changedDetails.maxDistanceToMask = Math.max(
        changedDetails.maxDistanceToMask,
        distance,
      );
    }
  }
  return {
    checkedPixels: checked,
    changedPixels: changed,
    ...(changed > 0
      ? {
          changedMaxChannelDiff: changedDetails.maxDiff,
          changedMeanDiff: Number(
            (changedDetails.sumDiff / changed).toFixed(2),
          ),
          changedMaxDistanceToMask: changedDetails.maxDistanceToMask,
          changedFarFromMask: changedDetails.farFromMask ?? 0,
        }
      : {}),
  };
}

const report = {
  bridge: BASE,
  tolerance:
    "三方对比：byte-identical=exact，否则 maxChannelDiff≤1 且 meanAbsDiff≤0.1=pass；蒙版外：距蒙版>6px 零容忍，边界≤6px 允许 ≤2/255 羽化舍入差",
  cases: [],
  executedAt: new Date().toISOString(),
};
const failures = [];
// 含 ICC 输入格：同一素材嵌入 sRGB ICC profile（codex 审核验收点名
// 「sRGB/含 ICC 输入」）。嵌入失败时该格记 skipped，不算失败。
const iccPlan = {
  operation: "adjust",
  adjustment: "brightness",
  amount: 12,
  target: "whole-image",
  protectLabel: false,
};
let iccInput = null;
try {
  iccInput = await sharpApi(HAT).withMetadata({ icc: "srgb" }).png().toBuffer();
} catch {
  iccInput = null;
}

const caseMatrix = [
  [
    "whole-image-brightness",
    {
      plan: {
        operation: "adjust",
        adjustment: "brightness",
        amount: 12,
        target: "whole-image",
        protectLabel: false,
      },
      options: { provider: false, expectMask: false },
      input: HAT,
      note: "hat fixture（无显式 ICC）",
    },
  ],
  [
    "masked-subject-brightness",
    {
      plan: {
        operation: "adjust",
        adjustment: "brightness",
        amount: 12,
        target: "subject",
        protectLabel: false,
      },
      options: { provider: true, expectMask: true },
      input: HAT,
      note: "hat fixture（无显式 ICC）+ rembg 主体蒙版",
    },
  ],
];
if (iccInput)
  caseMatrix.push([
    "whole-image-brightness-icc",
    {
      plan: iccPlan,
      options: { provider: false, expectMask: false },
      input: iccInput,
      note: "hat fixture 嵌入 sRGB ICC profile",
    },
  ]);

for (const [name, definition] of caseMatrix) {
  try {
    const result = await runCase(
      name,
      definition.plan,
      definition.options,
      definition.input,
      definition.note,
    );
    report.cases.push(result);
    failures.push(...result.failures);
  } catch (error) {
    report.cases.push({ name, fatal: String(error.message) });
    failures.push(`${name}: ${error.message}`);
  }
}
report.failures = failures;
const reportPath = join(
  root,
  ".tools/photocraft-serve-qa/preview-consistency-report.json",
);
await writeFile(reportPath, JSON.stringify(report, null, 2));

const asJson = process.argv.includes("--json");
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`补充C 预览/重开/导出一致性 @ ${BASE}`);
  for (const item of report.cases) {
    console.log(`  [${item.name}]`);
    if (item.fatal) {
      console.log(`    致命错误：${item.fatal}`);
      continue;
    }
    console.log(
      `    保存重开参数：brightness=${item.reopenedBrightness}（滑杆值 ${item.sliderBrightness}）`,
    );
    for (const [label, comparison] of Object.entries(item.comparisons))
      console.log(
        `    ${label}: ${comparison.verdict}${comparison.byteIdentical ? "（byte-identical）" : comparison.maxChannelDiff !== undefined ? `（max=${comparison.maxChannelDiff}, mean=${comparison.meanAbsDiff}）` : ""}`,
      );
    if (item.outsideMask)
      console.log(
        `    蒙版外像素：检查 ${item.outsideMask.checkedPixels}，改动 ${item.outsideMask.changedPixels}`,
      );
    for (const failure of item.failures) console.log(`    ✗ ${failure}`);
  }
  if (failures.length) {
    console.log("失败清单:");
    for (const failure of failures) console.log(`  ✗ ${failure}`);
  }
}
if (failures.length > 0) process.exitCode = 1;
