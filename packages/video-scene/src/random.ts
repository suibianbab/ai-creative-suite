// mulberry32：播种 PRNG。渲染上下文禁未播种随机（ADR 0003 §2.3）——
// 组件只能通过 FrameContext.random（由渲染器用 spec.seed 构造）取随机数。
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
