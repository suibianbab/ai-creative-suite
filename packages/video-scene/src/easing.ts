// 缓动纯函数：输入先钳到 [0,1]，输出 [0,1]。所有组件共用，保证时间行为可推。
export function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}
