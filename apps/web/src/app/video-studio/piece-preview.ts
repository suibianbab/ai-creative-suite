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
