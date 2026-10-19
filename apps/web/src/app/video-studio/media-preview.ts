// P2.5-T3 媒体预览数学（spec §2.4 P2/P3）：objectFit/objectPosition 派生 +
// 帧驱动 seek 目标与节流。cover 语义：仅横溢出轴吃 focalX（注视点），竖溢出/
// 无溢出恒 50%（契约无 focalY）；contain 恒 letterbox 居中。
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

export function mediaSeekTargetSec(
  inMs: number,
  localFrame: number,
  fps = 24,
): number {
  return (inMs + (localFrame / fps) * 1000) / 1000;
}

export function shouldSeekVideo(
  currentSec: number,
  targetSec: number,
  thresholdSec = 0.08,
): boolean {
  return Math.abs(targetSec - currentSec) >= thresholdSec;
}
