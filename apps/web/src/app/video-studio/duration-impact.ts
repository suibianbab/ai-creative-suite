// 镜头卡改时长时的影响提示（纯函数，不碰文档）：
// 用累计边界量化「当前 → 改后」的整片帧数，并检查相邻转场的借帧是否仍
// 装得下。出片帧数与转场窗口的权威口径在 @acs/video-document，这里只做
// 预览，不改变任何文档字段。
import {
  quantizeTimeline,
  resolveTransitionWindows,
  type VideoProject,
} from "@acs/video-document";

export type DurationImpact = {
  changed: boolean;
  beforeFrames: number;
  afterFrames: number | null; // 无法量化（如零帧镜头）时 null，原因在 frameError
  frameError: string | null;
  transitionIssue: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeDurationImpact(
  project: VideoProject,
  shotIndex: number,
  nextDurationMs: number,
  fps = 24,
): DurationImpact {
  // 当前时长取每个镜头 working 版本（文档不变量保证存在且为正整数）。
  const current = project.shots.map((shot) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    return working?.durationMs ?? 0;
  });
  const next = [...current];
  next[shotIndex] = Math.round(nextDurationMs);
  const changed = next[shotIndex] !== current[shotIndex];

  // beforeFrames 直接量化：打开的文档已通过校验，当前时长必然可量化。
  const beforeFrames = quantizeTimeline(current, fps).totalFrames;

  if (!changed) {
    // 时长没变 → 帧数与转场窗口都不会变，直接返回，不解析转场。
    return {
      changed: false,
      beforeFrames,
      afterFrames: beforeFrames,
      frameError: null,
      transitionIssue: null,
    };
  }

  let afterFrames: number | null = null;
  let frameError: string | null = null;
  let spans: Array<{ startFrame: number; frames: number }> | null = null;
  try {
    const quantized = quantizeTimeline(next, fps);
    afterFrames = quantized.totalFrames;
    spans = quantized.shots.map(({ startFrame, frames }) => ({
      startFrame,
      frames,
    }));
  } catch (error) {
    // 零帧镜头等编排错误：保留可操作文案，不改文档。
    frameError = errorMessage(error);
  }

  let transitionIssue: string | null = null;
  // 只有与本次改动相邻的边界（shotIndex - 1 / shotIndex）会因这次改时长
  // 而改变借帧余量；远处转场的窗口依赖的 span 没动。因此无相邻转场时不
  // 解析——否则远处一条早已存在的转场问题会被误报在这次改动头上。
  // 有相邻转场时仍用全量 transitions 调一次 resolveTransitionWindows：
  // 它同时校验逐条与相邻合计借帧，错误信息即出片期的真实拒绝原因。
  const transitions = project.transitions ?? [];
  const touchesAdjacent = transitions.some(
    (transition) =>
      transition.boundary === shotIndex - 1 ||
      transition.boundary === shotIndex,
  );
  if (afterFrames !== null && spans !== null && touchesAdjacent) {
    try {
      resolveTransitionWindows(transitions, spans, fps);
    } catch (error) {
      transitionIssue = errorMessage(error);
    }
  }

  return { changed, beforeFrames, afterFrames, frameError, transitionIssue };
}
