import {
  applyImageOperation,
  type CropRect,
  type ImageDocument,
  type ImageOperation,
  routeImageCapability,
} from "./index.js";

export const GENERATED_BACKGROUND_NAME = "AI 背景";

function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
): CropRect {
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > ratio) {
    const width = Math.min(sourceWidth, Math.round(sourceHeight * ratio));
    return {
      x: Math.floor((sourceWidth - width) / 2),
      y: 0,
      width,
      height: sourceHeight,
    };
  }
  const height = Math.min(sourceHeight, Math.round(sourceWidth / ratio));
  return {
    x: 0,
    y: Math.floor((sourceHeight - height) / 2),
    width: sourceWidth,
    height,
  };
}

/** Composites a separately generated plate below the masked product; never changes its asset. */
export function planBackgroundPlate(
  document: ImageDocument,
  productLayerId: string,
  assetId: string,
  sourceWidth: number,
  sourceHeight: number,
  createId: () => string,
): ImageOperation[] {
  if (routeImageCapability("background-replace") !== "ai-provider")
    throw new Error("背景生成 Provider 路由配置错误");
  const product = document.layers.find((layer) => layer.id === productLayerId);
  if (product?.kind !== "image" || !product.mask)
    throw new Error("请先选中已抠图的商品图片图层。");
  if (
    !assetId ||
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < 256 ||
    sourceHeight < 256 ||
    sourceWidth * sourceHeight > 25_000_000
  )
    throw new Error("背景图片像素尺寸无效。");
  const { width, height } = document.canvas;
  const crop = coverCrop(sourceWidth, sourceHeight, width / height);
  const operations: ImageOperation[] = document.layers
    .filter(
      (layer) =>
        layer.kind === "image" && layer.name === GENERATED_BACKGROUND_NAME,
    )
    .map((layer) => ({ type: "removeLayer", layerId: layer.id }));
  const layerId = createId();
  operations.push({
    type: "addImage",
    layer: {
      id: layerId,
      kind: "image",
      name: GENERATED_BACKGROUND_NAME,
      assetId,
      sourceWidth,
      sourceHeight,
      crop,
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
    },
  });
  const remaining = document.layers.length - (operations.length - 1);
  for (let index = 0; index < remaining; index++)
    operations.push({ type: "moveLayer", layerId, direction: "down" });
  operations.reduce(applyImageOperation, document);
  return operations;
}
