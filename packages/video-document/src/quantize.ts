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
function frameBoundaries(durationsMs: number[], fps: number): number[] {
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
  return boundary;
}

// 与正式量化共用累计边界，列出全部零帧镜头。编辑器修复存量坏项目时
// 需要比较改动前后的全集；quantizeTimeline 的首个异常不足以证明本次
// 编辑没有引入新的零帧。
export function zeroFrameShotIndexes(
  durationsMs: number[],
  fps: number,
): number[] {
  const boundary = frameBoundaries(durationsMs, fps);
  const indexes: number[] = [];
  for (let i = 0; i < durationsMs.length; i++) {
    if (boundary[i + 1]! - boundary[i]! <= 0) indexes.push(i);
  }
  return indexes;
}

export function quantizeTimeline(
  durationsMs: number[],
  fps: number,
): QuantizedTimeline {
  const boundary = frameBoundaries(durationsMs, fps);
  const shots = durationsMs.map((_, i) => {
    const frames = boundary[i + 1]! - boundary[i]!;
    if (frames <= 0) throw new ZeroFrameShotError(i);
    return { shotIndex: i, startFrame: boundary[i]!, frames };
  });
  return { shots, totalFrames: boundary[boundary.length - 1]! };
}

export type GlobalFrameMapping = { shotIndex: number; localFrame: number };

// 全局帧 → (镜头, 镜头内本地帧)。startFrame ≤ frame < startFrame+frames 归该镜头，
// 边界帧归后一镜头的起点；frame 超出 [0, totalFrames) 钳到首/末帧，播放循环回绕不越界。
export function mapGlobalFrame(
  timeline: QuantizedTimeline,
  frame: number,
): GlobalFrameMapping {
  if (timeline.shots.length === 0) throw new Error("timeline 不能为空");
  if (!Number.isInteger(frame)) throw new Error("frame 必须为整数");
  const clamped = Math.min(Math.max(frame, 0), timeline.totalFrames - 1);
  for (const shot of timeline.shots) {
    if (clamped < shot.startFrame + shot.frames)
      return {
        shotIndex: shot.shotIndex,
        localFrame: clamped - shot.startFrame,
      };
  }
  const last = timeline.shots[timeline.shots.length - 1]!;
  return { shotIndex: last.shotIndex, localFrame: last.frames - 1 };
}
