import type { ShotTransition } from "./types.js";

// —— P1 转场帧数学（Feature ④ spec R2）：dip-to-black 向相邻 span 内部借帧 ——
// 装配一次 resolveTransitionWindows（span 不足在此大声拒绝），逐帧只查
// transitionOverlayAt。纯函数、无随机：同输入同输出（帧确定性纪律）。
export type TransitionWindow = {
  boundary: number;
  startFrame: number; // 窗口全局首帧（左镜头尾部第一借帧）
  frames: number; // = halfOut + halfIn
  halfOut: number; // 左镜头尾部借帧数（ceil(T/2)）
  halfIn: number; // 右镜头头部借帧数（floor(T/2)）
};

export function resolveTransitionWindows(
  transitions: ShotTransition[],
  spans: Array<{ startFrame: number; frames: number }>,
  fps: number,
): TransitionWindow[] {
  // 逐 span 合计借帧：相邻边界共享中 span（左界 halfIn + 右界 halfOut），
  // 合计 ≥ span 帧数 = 窗口重叠或该镜头无可见帧（spec：无重叠、无悬空帧，
  // 与单边界「halfOut ≥ left.frames 即拒绝」同一口径：每 span 至少留 1 帧）。
  const borrowed = spans.map(() => 0);
  const windows = transitions.map((transition) => {
    const left = spans[transition.boundary];
    const right = spans[transition.boundary + 1];
    // schema 已保证 boundary 范围；装配期防御（spans 与 shots 错位属编程错误）
    if (!left || !right) {
      throw new Error(
        `transitions[${transition.boundary}] 对应的 span 不存在（spans 与镜头数错位）`,
      );
    }
    const total = Math.round((transition.durationMs * fps) / 1000);
    if (total < 2) {
      throw new Error(
        `转场 ${transition.durationMs}ms @${fps}fps 仅换算 ${total} 帧（不足 2 帧）：加大 durationMs`,
      );
    }
    const halfOut = Math.ceil(total / 2);
    const halfIn = total - halfOut;
    if (halfOut >= left.frames || halfIn >= right.frames) {
      throw new Error(
        `镜头 ${transition.boundary + 1}→${transition.boundary + 2} 的转场 ${transition.durationMs}ms 借帧（${halfOut}+${halfIn}）超出相邻 span（${left.frames}+${right.frames} 帧）：缩短 durationMs 或加长镜头`,
      );
    }
    borrowed[transition.boundary] =
      (borrowed[transition.boundary] ?? 0) + halfOut;
    borrowed[transition.boundary + 1] =
      (borrowed[transition.boundary + 1] ?? 0) + halfIn;
    return {
      boundary: transition.boundary,
      startFrame: left.startFrame + left.frames - halfOut,
      frames: total,
      halfOut,
      halfIn,
    };
  });
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const total = borrowed[spanIndex] ?? 0;
    if (total > 0 && total >= spans[spanIndex]!.frames) {
      throw new Error(
        `镜头 ${spanIndex + 1} 被相邻转场合计借帧 ${total} ≥ 该镜头 ${spans[spanIndex]!.frames} 帧（窗口重叠或无可见帧）：缩短 durationMs 或加长镜头`,
      );
    }
  }
  return windows;
}

// 0 = 无叠加；左窗线性升至 1（左尾帧全黑），右窗自 1 线性降（右首帧全黑）。
export function transitionOverlayAt(
  windows: TransitionWindow[],
  frame: number,
): number {
  let opacity = 0;
  for (const window of windows) {
    const offset = frame - window.startFrame;
    if (offset < 0 || offset >= window.frames) continue;
    const value =
      offset < window.halfOut
        ? (offset + 1) / window.halfOut
        : 1 - (offset - window.halfOut) / window.halfIn;
    opacity = Math.max(opacity, value);
  }
  return opacity;
}
