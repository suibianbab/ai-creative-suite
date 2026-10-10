import type { ImageDocument, ImageLayer } from "@acs/image-document";
import { drawImageDocument, type ImageAssetMap } from "./render";

export type LightSample = {
  left: number;
  right: number;
  leftCount: number;
  rightCount: number;
  highlightFraction: number;
  shadowFraction: number;
};

export type SceneLightingReport = {
  status: "consistent" | "review" | "insufficient";
  productDelta: number;
  backgroundDelta: number;
  highlightFraction: number;
  shadowFraction: number;
  observations: string[];
};

const direction = (delta: number) =>
  Math.abs(delta) < 8 ? "不明显" : delta < 0 ? "左侧较亮" : "右侧较亮";

/** Advisory only: object material can explain a different luminance pattern. */
export function compareSceneLightSamples(
  product: LightSample,
  background: LightSample,
): SceneLightingReport {
  if (
    Math.min(
      product.leftCount,
      product.rightCount,
      background.leftCount,
      background.rightCount,
    ) < 30
  )
    return {
      status: "insufficient",
      productDelta: 0,
      backgroundDelta: 0,
      highlightFraction: 0,
      shadowFraction: 0,
      observations: ["可比较的商品或背景像素不足，请检查蒙版和图层。"],
    };
  const productDelta = product.right - product.left;
  const backgroundDelta = background.right - background.left;
  const opposed =
    Math.abs(productDelta) >= 8 &&
    Math.abs(backgroundDelta) >= 8 &&
    Math.sign(productDelta) !== Math.sign(backgroundDelta);
  const observations = [
    `商品：${direction(productDelta)}；背景：${direction(backgroundDelta)}。`,
  ];
  if (opposed)
    observations.push("商品与背景的左右明暗方向相反，建议人工复核光照。 ");
  else observations.push("左右明暗方向未显示明显冲突；仍需检查材质与色温。 ");
  if (product.highlightFraction > 0.08)
    observations.push("商品高亮像素较多，请检查细节是否过曝。 ");
  if (product.shadowFraction > 0.08)
    observations.push("商品暗部像素较多，请检查细节是否压黑。 ");
  return {
    status:
      opposed ||
      product.highlightFraction > 0.08 ||
      product.shadowFraction > 0.08
        ? "review"
        : "consistent",
    productDelta,
    backgroundDelta,
    highlightFraction: product.highlightFraction,
    shadowFraction: product.shadowFraction,
    observations: observations.map((item) => item.trim()),
  };
}

function renderLayer(
  document: ImageDocument,
  layer: ImageLayer,
  assets: ImageAssetMap,
  scale: number,
): ImageData {
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(document.canvas.width * scale));
  canvas.height = Math.max(1, Math.round(document.canvas.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法分析图层像素。");
  context.scale(scale, scale);
  drawImageDocument(
    context,
    { ...document, layers: [{ ...layer, contactShadow: undefined }] },
    assets,
    undefined,
    true,
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function sampleSides(
  image: ImageData,
  layer: ImageLayer,
  scale: number,
): LightSample {
  const x0 = Math.max(0, Math.floor((layer.x + layer.width * 0.12) * scale));
  const x1 = Math.min(
    image.width,
    Math.ceil((layer.x + layer.width * 0.88) * scale),
  );
  const y0 = Math.max(0, Math.floor((layer.y + layer.height * 0.2) * scale));
  const y1 = Math.min(
    image.height,
    Math.ceil((layer.y + layer.height * 0.8) * scale),
  );
  const center = (x0 + x1) / 2;
  let leftTotal = 0;
  let rightTotal = 0;
  let leftCount = 0;
  let rightCount = 0;
  let highlights = 0;
  let shadows = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3]! < 220) continue;
      const light =
        image.data[i]! * 0.2126 +
        image.data[i + 1]! * 0.7152 +
        image.data[i + 2]! * 0.0722;
      if (x < center) {
        leftTotal += light;
        leftCount++;
      } else {
        rightTotal += light;
        rightCount++;
      }
      if (light >= 250) highlights++;
      if (light <= 12) shadows++;
    }
  }
  const count = leftCount + rightCount;
  return {
    left: leftCount ? leftTotal / leftCount : 0,
    right: rightCount ? rightTotal / rightCount : 0,
    leftCount,
    rightCount,
    highlightFraction: count ? highlights / count : 0,
    shadowFraction: count ? shadows / count : 0,
  };
}

export function inspectSceneLighting(
  document: ImageDocument,
  product: ImageLayer,
  background: ImageLayer,
  assets: ImageAssetMap,
): SceneLightingReport {
  if (
    !product.mask ||
    !assets[product.assetId] ||
    !assets[product.mask.assetId]
  )
    throw new Error("请先导入商品原图及有效蒙版。");
  if (!assets[background.assetId]) throw new Error("背景图层素材缺失。");
  const scale = Math.min(
    1,
    640 / Math.max(document.canvas.width, document.canvas.height),
  );
  const productPixels = renderLayer(document, product, assets, scale);
  const backgroundPixels = renderLayer(document, background, assets, scale);
  return compareSceneLightSamples(
    sampleSides(productPixels, product, scale),
    sampleSides(backgroundPixels, product, scale),
  );
}
