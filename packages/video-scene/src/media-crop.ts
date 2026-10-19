// P2.5-T4（spec §1 B2）裁切数学南迁：video-scene 是 web 预览与 remotion-engine
// 出片共同可达的唯一层，mediaClipCss 在此单源。web media-preview.ts 转再导出。
// cover 语义：仅横溢出轴吃 focalX（注视点），竖溢出/无溢出恒 50%（契约无
// focalY）；contain 恒 letterbox 居中。
export function mediaClipCss(
  assetWidth: number,
  assetHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fit: "cover" | "contain",
  focalX: number,
): { objectFit: "cover" | "contain"; objectPosition: string } {
  if (fit === "contain") {
    return { objectFit: "contain", objectPosition: "50% 50%" };
  }
  const scale = Math.max(canvasWidth / assetWidth, canvasHeight / assetHeight);
  const overflowX = assetWidth * scale > canvasWidth + 0.5;
  const x = overflowX ? `${(focalX * 100).toFixed(1)}%` : "50%";
  return { objectFit: "cover", objectPosition: `${x} 50%` };
}
