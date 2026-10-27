// P2.5-T4（B2）：mediaClipCss 已南迁 @acs/video-scene（出片与预览单源），
// 此处再导出保持既有 import 面不变（X4）。帧驱动 seek 目标与节流仍在本文件。
export { mediaClipCss, mediaMotionTransform } from "@acs/video-scene";

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
