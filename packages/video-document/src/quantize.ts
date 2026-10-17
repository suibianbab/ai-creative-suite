export class ZeroFrameShotError extends Error {
  constructor(public readonly shotIndex: number) {
    super(
      `第 ${shotIndex + 1} 个镜头在该帧率下为零帧：请加长时长或与相邻镜头合并`,
    );
  }
}

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export type QuantizedTimeline = {
  shots: Array<{ shotIndex: number; startFrame: number; frames: number }>;
  totalFrames: number;
};

// ADR 0003 §3.5：按累计边界取整，禁止逐镜头取整（会累积跨 fps 漂移）。
// B_0 = 0，B_i = round_half_up((Σ durations 1..i) × fps / 1000)，镜头 i 的帧数 = B_i − B_{i−1}。
// 零帧镜头是编排错误：拒绝并给出可操作提示，不静默丢帧也不补帧。
export function quantizeTimeline(
  durationsMs: number[],
  fps: number,
): QuantizedTimeline {
  if (!Array.isArray(durationsMs) || durationsMs.length === 0)
    throw new Error("durationsMs 不能为空");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps 必须为正数");
  const boundary: number[] = [0];
  let cumulative = 0;
  durationsMs.forEach((d, i) => {
    if (!Number.isInteger(d) || d <= 0)
      throw new Error(`durationMs[${i}] 必须为正整数`);
    cumulative += d;
    boundary.push(roundHalfUp((cumulative * fps) / 1000));
  });
  const shots = durationsMs.map((_, i) => {
    const frames = boundary[i + 1]! - boundary[i]!;
    if (frames <= 0) throw new ZeroFrameShotError(i);
    return { shotIndex: i, startFrame: boundary[i]!, frames };
  });
  return { shots, totalFrames: boundary[boundary.length - 1]! };
}
