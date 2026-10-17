// §7 主体级自动率探针（第八轮）：方案 §0 承诺「主体级 100% 自动」。本脚本
// 把该承诺运营化为可复算的口径——分母 = grounding 标注集全部 11 张图
// （5 题材），分子 = 满足全部下列条件的图：
//   ① 桥接 /v1/instruction HTTP 200（provider 选区 + 换色调整层预览）；
//   ② selectionBounds 非空（provider 蒙版真的落成了原生选区）；
//   ③ 预览与源图有像素差异（调整层真的渲染）；
//   ④ 变化像素包围盒 ⊆ selectionBounds（±8px 容差）——蒙版若空/整图，此项
//      拦下（自动完成 ≠ 返回了 200，还得是「只动了主体」）。
// 无候选环、无缺口追问、无人工接力：链路上没有任何一步需要用户修蒙版。
//
// 蒙版像素质量边界（如实）：本探针不与主体 GT 蒙版逐像素比对（标注集的 GT
// 是部件级，主体级无独立 GT）；「选区外零改动」的逐字节口径由 IMG-050
// preview-consistency 钉过，此处以 ④ 做同方向的廉价校验。
// 报告 only：失败计入分子外并逐条列出；fixture/桥接错误才非零退出。
// 用法：node scripts/photocraft/subject-auto-probe.mjs [--json]
// 依赖：:4112 origin shim → :4113 dev bridge（PhotoCraft 0.6.0 serve）、
//   :4101 local_mask_provider（provider 蒙版）。

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "apps/api/package.json"));
const sharpApi = require("sharp");

const FIXTURE_DIR = join(root, "qa/fixtures/photocraft-grounding");
const BASE = process.env.PHOTOCRAFT_BRIDGE_BASE ?? "http://127.0.0.1:4112";
const PROVIDER_BASE =
  process.env.PHOTOCRAFT_MASK_PROVIDER_BASE ?? "http://127.0.0.1:4101";
const REPORT = join(
  root,
  ".tools/photocraft-serve-qa/subject-auto-report.json",
);
const CONTENT_TYPES = { ".jpg": "image/jpeg", ".png": "image/png" };
const BBOX_TOLERANCE_PX = 8;
const asJson = process.argv.includes("--json");

const annotations = JSON.parse(
  await readFile(join(FIXTURE_DIR, "annotations.json"), "utf8"),
);
const images = annotations.images.map((entry) => ({
  image: entry.image, // 可能带 ../（上两级 fixture），与标注集同口径解析
  width: entry.width,
  height: entry.height,
  domains: entry.domains ?? [],
}));

const health = await fetch(`${BASE}/health`);
if (!health.ok) {
  console.error(`dev bridge 未就绪：GET /health → ${health.status}`);
  process.exit(1);
}
const bridgeVersion = (await health.json()).version;

// 主体级编辑计划：与 live-eval 引擎矩阵同款（target=subject 走 provider
// 蒙版，无需作用框）。用亮度调整而非换色——hue 旋转式换色在白色/低饱和
// 主体（白墙、石立面）上无可见变化，会把「蒙版正确」误判成「链路失败」；
// 亮度 ±30 对任何主体都可测。
function subjectPlan() {
  return {
    operation: "adjust",
    adjustment: "brightness",
    amount: 30,
    target: "subject",
    protectLabel: false,
  };
}

async function postInstruction(image, bytes, contentType) {
  const plan = subjectPlan();
  const planJson = JSON.stringify(plan);
  const headers = {
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
    "X-Acs-Selection-Method": "provider",
    "X-Acs-Heal-Size": "32",
    "X-Acs-Provider-Scope-Feather": "20",
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${BASE}/v1/instruction`, {
      method: "POST",
      headers: { "Content-Type": contentType, ...headers },
      body: bytes,
    });
    if (response.status === 429) {
      await new Promise((sleep) =>
        setTimeout(
          sleep,
          Number(response.headers.get("retry-after") ?? "2") * 1000,
        ),
      );
      continue;
    }
    if (!response.ok)
      return {
        error: `${response.status} ${(await response.text()).slice(0, 300)}`,
      };
    return { result: await response.json() };
  }
  return { error: "服务持续繁忙（429）" };
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) return { error: `HTTP ${response.status}` };
  return { bytes: Buffer.from(await response.arrayBuffer()) };
}

/** provider 蒙版前景占比（:4101 直接测）：链路成功≠蒙版合理，覆盖率把
 * 「空蒙版/整图蒙版」从 200 响应里暴露出来（cabin 室内全景实测 0.01%）。 */
async function maskCoverage(bytes, contentType) {
  try {
    const response = await fetch(
      `${PROVIDER_BASE}/v1/masks/remove-background`,
      {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Origin: "http://localhost:3000",
        },
        body: bytes,
      },
    );
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const png = Buffer.from(await response.arrayBuffer());
    const raw = await sharpApi(png).grayscale().raw().toBuffer({
      resolveWithObject: true,
    });
    let white = 0;
    for (const byte of raw.data) if (byte >= 128) white += 1;
    return {
      ratio: Number((white / (raw.info.width * raw.info.height)).toFixed(6)),
    };
  } catch (cause) {
    return { error: String(cause?.message ?? cause) };
  }
}

/** 预览 vs 源：变化像素包围盒与变化占比（源图与预览同尺寸：桥按文档渲染）。
 * 阈值 48（3 通道和，≈16/通道）：实测 JPEG→引擎渲染有全局色管噪声（95%
 * 像素差 0-7、噪声尾巴到 ~23），真编辑信号从 ≥120 起——48 在两者之间的
 * 安全带上，把「引擎重编码噪声」与「真编辑」分开。 */
async function diffStats(sourceBytes, previewBytes) {
  const a = sharpApi(sourceBytes).removeAlpha();
  const b = sharpApi(previewBytes).removeAlpha();
  const ra = await a.raw().toBuffer({ resolveWithObject: true });
  const rb = await b.raw().toBuffer({ resolveWithObject: true });
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height)
    return {
      error: `尺寸不一致 ${ra.info.width}×${ra.info.height} vs ${rb.info.width}×${rb.info.height}`,
    };
  const channels = ra.info.channels;
  const CHANGE_THRESHOLD = 48;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  const total = ra.info.width * ra.info.height;
  for (let i = 0; i < total; i += 1) {
    const o = i * channels;
    let diff = 0;
    for (let c = 0; c < Math.min(channels, 3); c += 1)
      diff += Math.abs(ra.data[o + c] - rb.data[o + c]);
    if (diff > CHANGE_THRESHOLD) {
      changed += 1;
      const x = i % ra.info.width;
      const y = Math.floor(i / ra.info.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    width: ra.info.width,
    height: ra.info.height,
    channels,
    changeThreshold: CHANGE_THRESHOLD,
    changedRatio: changed / total,
    bbox: changed ? [minX, minY, maxX, maxY] : null,
  };
}

function bboxWithinSelection(bbox, selectionBounds, tolerance) {
  if (!bbox) return { ok: false, detail: "预览无变化" };
  if (!selectionBounds)
    return { ok: false, detail: "selectionBounds 为空（选区未落成）" };
  const [sx, sy, sw, sh] = selectionBounds;
  const grown = [
    sx - tolerance,
    sy - tolerance,
    sx + sw + tolerance,
    sy + sh + tolerance,
  ];
  const inside =
    bbox[0] >= grown[0] &&
    bbox[1] >= grown[1] &&
    bbox[2] <= grown[2] &&
    bbox[3] <= grown[3];
  return {
    ok: inside,
    detail: `bbox=[${bbox}] selection=[${selectionBounds}] tolerance=${tolerance}`,
  };
}

const records = [];
const errors = [];
for (const spec of images) {
  const ext = spec.image.slice(spec.image.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    errors.push(`${spec.image}: 不支持的扩展名 ${ext}`);
    continue;
  }
  const bytes = await readFile(join(FIXTURE_DIR, spec.image));
  const posted = await postInstruction(spec.image, bytes, contentType);
  if (posted.error) {
    errors.push(`${spec.image}: 指令失败 ${posted.error}`);
    records.push({
      image: spec.image,
      ok: false,
      stage: "instruction",
      detail: posted.error,
    });
    continue;
  }
  const result = posted.result;
  const stage = [];
  if (!result.previewUrl) stage.push("no-preview-url");
  if (!result.selectionBounds) stage.push("no-selection-bounds");
  let diff = null;
  let bboxCheck = { ok: false, detail: "未执行" };
  if (result.previewUrl) {
    // sourceUrl 返回的是 .pcraft 原生文档（ZIP 头），不是栅格源图——比对
    // 用本地上传字节（与文档同尺寸；桥按全尺寸渲染预览）。
    const preview = await fetchBinary(`${BASE}${result.previewUrl}`);
    if (preview.error) {
      stage.push("preview-fetch-failed");
    } else {
      diff = await diffStats(bytes, preview.bytes);
      if (diff.error) stage.push(`diff: ${diff.error}`);
      else {
        bboxCheck = bboxWithinSelection(
          diff.bbox,
          result.selectionBounds,
          BBOX_TOLERANCE_PX,
        );
        if (diff.changedRatio <= 0.0005) stage.push("preview-unchanged");
        if (!bboxCheck.ok)
          stage.push(`bbox-not-in-selection: ${bboxCheck.detail}`);
      }
    }
  }
  const ok = stage.length === 0;
  const coverage = await maskCoverage(bytes, contentType);
  records.push({
    image: spec.image,
    domains: spec.domains,
    ok,
    stages: stage.length ? stage : undefined,
    selectionBounds: result.selectionBounds ?? null,
    changedRatio:
      diff && !diff.error ? Number(diff.changedRatio.toFixed(6)) : null,
    bbox: diff && !diff.error ? diff.bbox : null,
    providerMaskForeground: coverage.error ?? coverage.ratio,
  });
  if (!asJson)
    console.log(
      `${ok ? "✓" : "✗"} ${spec.image.padEnd(46)} changed=${diff && !diff.error ? (diff.changedRatio * 100).toFixed(2) + "%" : "—"} selection=${result.selectionBounds ? "有" : "无"}${stage.length ? "  " + stage.join("; ") : ""}`,
    );
}

const passed = records.filter((r) => r.ok).length;
const summary = {
  denominator: records.length,
  passed,
  rate: records.length ? Number((passed / records.length).toFixed(4)) : null,
  note: "主体级自动 = provider 蒙版→原生选区→调整层预览全链路无人工介入完成，且变化像素包围盒落在选区内（±8px）。非主体蒙版的像素级 GT 比对（无独立主体 GT，未测）；选区外逐字节一致由 IMG-050 另行钉住。",
  bridgeVersion,
};

await writeFile(
  REPORT,
  JSON.stringify(
    {
      bridge: BASE,
      executedAt: new Date().toISOString(),
      summary,
      records,
      errors,
    },
    null,
    2,
  ),
);
if (asJson) console.log(JSON.stringify({ summary, records, errors }, null, 2));
else
  console.log(
    `主体级自动率：${passed}/${records.length} = ${summary.rate}\n报告：${REPORT}`,
  );
if (errors.length) process.exitCode = 1;
