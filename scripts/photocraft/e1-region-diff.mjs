// E-1 补充客观指标：四案例编辑预览 vs 源图的区域差分（VLM 与人工判读之外的
// 定量裁决）。预览由原生调整层渲染，与源图严格同尺寸——无需重采样（与 E-2
// 生成模型输出 1024²/2048² 不同）。指标：区域内平均带符号亮度差（提亮为正）
// 与平均绝对差（0-255）；GT 蒙版来自 qa/fixtures/photocraft-grounding/masks/。

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const sharp = require("sharp");
const OUT = resolve(root, "artifacts/photocraft-e1-2026-10-17");
const FIX = resolve(root, "qa/fixtures");
const GROUND = resolve(FIX, "photocraft-grounding");
const MASKS = resolve(GROUND, "masks");

async function grayMask(file, size) {
  const { data } = await sharp(file)
    .resize(size.width, size.height, { kernel: "nearest" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function plane(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

function lum(buf, i) {
  // Rec.601 亮度（编辑是提亮/换色，亮度通道最能反映「动了哪里」）
  return 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
}

function regionStats(src, out, info, isInside) {
  let signed = 0;
  let absSum = 0;
  let ch = [0, 0, 0]; // R/G/B 逐通道绝对差——换色（红→蓝）亮度近乎不变，色度看这里
  let n = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!isInside(x, y)) continue;
      const i = (y * info.width + x) * info.channels;
      const d = lum(out, i) - lum(src, i);
      signed += d;
      absSum += Math.abs(d);
      ch[0] += Math.abs(out[i] - src[i]);
      ch[1] += Math.abs(out[i + 1] - src[i + 1]);
      ch[2] += Math.abs(out[i + 2] - src[i + 2]);
      n += 1;
    }
  }
  return n
    ? {
        meanSignedLumDiff: Number((signed / n).toFixed(2)),
        meanAbsLumDiff: Number((absSum / n).toFixed(2)),
        meanAbsDiffRGB: ch.map((v) => Number((v / n).toFixed(2))),
        pixels: n,
      }
    : null;
}

const cases = [
  {
    case: "c1-roof",
    source: resolve(GROUND, "meigs-house-front-street-marietta-oh.jpg"),
    preview: resolve(OUT, "c1-roof-preview-render.png"),
    masks: {
      roof: resolve(MASKS, "meigs-house-front-street-marietta-oh.jpg/屋顶.png"),
    },
    regions: (masks) => ({
      insideTarget: (x, y) => masks.roof[y * masks.w + x] >= 128,
      outsideTarget: (x, y) => masks.roof[y * masks.w + x] < 128,
    }),
  },
  {
    case: "c2-petal",
    source: resolve(GROUND, "hibiscus-brilliant.jpg"),
    preview: resolve(OUT, "c2-petal-after-retouch-render.png"),
    masks: {
      petals: resolve(MASKS, "hibiscus-brilliant.jpg/花朵.png"),
      pistil: resolve(MASKS, "hibiscus-brilliant.jpg/花蕊.png"),
    },
    regions: (masks) => ({
      insideTarget: (x, y) => masks.petals[y * masks.w + x] >= 128,
      outsideTarget: (x, y) => masks.petals[y * masks.w + x] < 128,
      // PhotoCraft brush handoff should restore the pistil.
      pistilOnly: (x, y) => masks.pistil[y * masks.w + x] >= 128,
    }),
  },
  {
    case: "c3-left-ear",
    source: resolve(FIX, "photocraft-fluffy-cat-cc0.jpg"),
    preview: resolve(OUT, "c3-left-ear-after-retouch-render.png"),
    masks: { head: resolve(MASKS, "photocraft-fluffy-cat-cc0.jpg/猫头.png") },
    // No single-ear GT: split the upper head as an isolation sanity check.
    regions: (masks, info) => ({
      headUpperLeft: (x, y) =>
        masks.head[y * masks.w + x] >= 128 &&
        y < info.height * 0.22 &&
        x < info.width * 0.7,
      headUpperRight: (x, y) =>
        masks.head[y * masks.w + x] >= 128 &&
        y < info.height * 0.22 &&
        x >= info.width * 0.7,
      outsideHead: (x, y) => masks.head[y * masks.w + x] < 128,
    }),
  },
  {
    case: "c4-lasso-fallback",
    source: resolve(FIX, "photocraft-hat-teal.png"),
    preview: resolve(OUT, "c4-lasso-fallback-preview-render.png"),
    masks: {
      crown: resolve(MASKS, "photocraft-hat-teal.png/帽顶.png"),
      brim: resolve(MASKS, "photocraft-hat-teal.png/帽沿.png"),
    },
    regions: (masks) => ({
      // 帽徽≈E-2 标签框 [600,470,300,190]（1254²）
      insideTarget: (x, y) => x >= 600 && x < 900 && y >= 470 && y < 660,
      outsideHat: (x, y) =>
        masks.crown[y * masks.w + x] < 128 && masks.brim[y * masks.w + x] < 128,
      hatExceptEmblem: (x, y) =>
        (masks.crown[y * masks.w + x] >= 128 ||
          masks.brim[y * masks.w + x] >= 128) &&
        !(x >= 600 && x < 900 && y >= 470 && y < 660),
    }),
  },
];

const rows = [];
for (const c of cases) {
  const src = await plane(c.source);
  const out = await plane(c.preview);
  if (
    src.info.width !== out.info.width ||
    src.info.height !== out.info.height
  ) {
    rows.push({
      case: c.case,
      error: `尺寸不一致 ${src.info.width}x${src.info.height} vs ${out.info.width}x${out.info.height}`,
    });
    continue;
  }
  const masks = { w: src.info.width, h: src.info.height };
  for (const [k, file] of Object.entries(c.masks))
    masks[k] = await grayMask(file, src.info);
  const regions = c.regions(masks, src.info);
  const row = { case: c.case, dims: `${src.info.width}x${src.info.height}` };
  for (const [name, fn] of Object.entries(regions)) {
    row[name] = regionStats(src.data, out.data, src.info, fn);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}

const report = {
  executedAt: new Date().toISOString(),
  method:
    "编辑预览与源图同尺寸（原生调整层渲染，无重采样）；区域平均带符号亮度差（Rec.601，提亮为正）与平均绝对差（0-255）",
  caveat:
    "花瓣为 PhotoCraft 蒙版笔刷精修后的预览；左耳为两笔耳根擦除后的预览。耳区用头部蒙版上半左右粗分（无单耳 GT）；帽徽沿用 E-2 标签框。语义与边缘质量仍须人工复核，本表仅是定量补充",
  gtMasks: "qa/fixtures/photocraft-grounding/masks/（IMG-054 GT，非独立标注）",
  rows,
};
await writeFile(
  resolve(OUT, "e1-region-diff.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log("报告：", resolve(OUT, "e1-region-diff.json"));
if (rows.some((row) => row.error)) process.exitCode = 1;
