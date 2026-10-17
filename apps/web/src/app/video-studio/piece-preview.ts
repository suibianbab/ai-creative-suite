// 整片预览的纯推进逻辑（可单测）：rAF 的 dt 折算成帧增量后调用。
// 到尾回零循环（与单镜头预览同语义），负增量钳零——播放循环永不越界。
export function advanceGlobalFrame(
  current: number,
  deltaFrames: number,
  totalFrames: number,
): number {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0)
    throw new Error("totalFrames 必须为正整数");
  const next = current + deltaFrames;
  if (next >= totalFrames) return 0;
  if (next < 0) return 0;
  return next;
}

// 整片预览的镜头画布上下文：与出片同帧率（24），帧数直接用量化 span 帧数。
// 不能由 durationMs 重新 ceil（1600ms 首镜头 span=38，ceil(1600×24/1000)=39；
// 更不能沿用单镜头预览的 30fps——动画会慢 20% 且末 20% 帧永不显示）。
export type ShotCanvasContext = { fps: number; durationFrames: number };

export function shotCanvasContext(item: {
  durationMs: number;
  frames: number;
}): ShotCanvasContext {
  if (!Number.isInteger(item.frames) || item.frames <= 0)
    throw new Error("frames 必须为正整数");
  return { fps: 24, durationFrames: item.frames };
}
