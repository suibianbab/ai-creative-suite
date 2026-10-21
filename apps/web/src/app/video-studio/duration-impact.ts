// 镜头卡改时长时的影响提示（纯函数，不碰文档）：
// 用累计边界量化「当前 → 改后」的整片帧数，并检查相邻转场的借帧是否仍
// 装得下。出片帧数与转场窗口的权威口径在 @acs/video-document，这里只做
// 预览，不改变任何文档字段。
import {
  quantizeTimeline,
  resolveTransitionWindows,
  type VideoProject,
  ZeroFrameShotError,
  zeroFrameShotIndexes,
} from "@acs/video-document";

export type DurationImpact = {
  changed: boolean;
  // 本次编辑的镜头序号（越界时即入参值）。
  shotIndex: number;
  // 改后量化失败且原因是零帧时，首个报错镜头的序号；否则 null。
  // 仅供诊断提示，局部修复闸门使用全部零帧镜头的集合比较。
  zeroFrameShotIndex: number | null;
  // 存量零帧项目本次编辑使零帧集合严格缩小，且没有新造零帧时才允许
  // 局部修复落库；整片仍不可量化时由应用闸门读取。
  partialRepairAllowed: boolean;
  // 当前文档本身无法量化（如存量零帧镜头）时为 null，调用方按"无法量化"展示；
  // 改后仍可能量化成功，这正是把存量零帧镜头改回可出片时长的修复入口。
  beforeFrames: number | null;
  // 改后无法量化时为 null；时长确实改过时原因在 frameError，未改时（changed
  // 为 false，含当前文档本就无法量化）两侧都为 null 而 frameError 也为 null。
  afterFrames: number | null;
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
  // 越界守卫：调用方传错序号时不能把 undefined 塞进时间线，也不量化
  // beforeFrames（此时没有可信的前后对比），直接返回可操作错误。
  if (
    !Number.isInteger(shotIndex) ||
    shotIndex < 0 ||
    shotIndex >= current.length
  ) {
    return {
      changed: false,
      shotIndex,
      zeroFrameShotIndex: null,
      partialRepairAllowed: false,
      beforeFrames: null,
      afterFrames: null,
      frameError: `镜头序号 ${shotIndex} 越界（共 ${current.length} 个镜头）`,
      transitionIssue: null,
    };
  }
  const next = [...current];
  next[shotIndex] = Math.round(nextDurationMs);
  const changed = next[shotIndex] !== current[shotIndex];

  // 当前文档不一定可量化：存量零帧镜头（如 1ms @24fps）会让 quantizeTimeline
  // 抛 ZeroFrameShotError。这里只降级 beforeFrames 为 null，不抛——否则挂载
  // 镜头卡时 useMemo 在渲染期崩溃，用户反而失去修订时长的入口。
  let beforeFrames: number | null = null;
  try {
    beforeFrames = quantizeTimeline(current, fps).totalFrames;
  } catch {
    // 存量零帧等编排错误：beforeFrames 保持 null 表示"当前文档无法量化"。
  }

  if (!changed) {
    // 时长没变 → 帧数与转场窗口都不会变，直接返回，不解析转场。
    return {
      changed: false,
      shotIndex,
      zeroFrameShotIndex: null,
      partialRepairAllowed: false,
      beforeFrames,
      afterFrames: beforeFrames,
      frameError: null,
      transitionIssue: null,
    };
  }

  let afterFrames: number | null = null;
  let frameError: string | null = null;
  let zeroFrameShotIndex: number | null = null;
  let partialRepairAllowed = false;
  let spans: Array<{ startFrame: number; frames: number }> | null = null;
  try {
    const quantized = quantizeTimeline(next, fps);
    afterFrames = quantized.totalFrames;
    spans = quantized.shots.map(({ startFrame, frames }) => ({
      startFrame,
      frames,
    }));
  } catch (error) {
    // 零帧镜头等编排错误：保留可操作文案，不改文档。记下报错镜头序号，
    // 闸门据此判断本次编辑的镜头自己是否仍为零帧。
    frameError = errorMessage(error);
    if (error instanceof ZeroFrameShotError) {
      zeroFrameShotIndex = error.shotIndex;
      if (beforeFrames === null) {
        // 同一份累计边界帧数学检查全部零帧：首个报错镜头可能遮住本次
        // 新造的零帧。只允许零帧集合严格缩小且没有新增成员的修复。
        try {
          const beforeZeros = new Set(zeroFrameShotIndexes(current, fps));
          const afterZeros = zeroFrameShotIndexes(next, fps);
          partialRepairAllowed =
            afterZeros.length < beforeZeros.size &&
            afterZeros.every((index) => beforeZeros.has(index));
        } catch {
          partialRepairAllowed = false;
        }
      }
    }
  }

  let transitionIssue: string | null = null;
  // 只解析直接挂在本次改动镜头 span 上的两条相邻边界（shotIndex - 1 /
  // shotIndex）：它们的借帧余量被这次改时长直接影响。更远的转场要么与
  // 本镜头无关，要么只有 span 的帧数（也就是借帧余量）会因累计边界量化
  // 的取整而偏移至多 ±1 帧，都不该算在本次编辑头上（文档校验只查转场
  // 形状/取值范围、不查逐帧容量，见 packages/video-document/src/validate.ts，
  // 别处既有非法转场也不能连坐）。
  // 交给 resolveTransitionWindows 只覆盖相邻两条：逐条与相邻合计借帧都会
  // 校验，错误信息即出片期对这些相邻窗口的真实拒绝原因；±1 帧取整导致
  // 远处转场失效的情形不在行内提示，出片期仍 fail-loud。
  const adjacentTransitions = (project.transitions ?? []).filter(
    (transition) =>
      transition.boundary === shotIndex - 1 ||
      transition.boundary === shotIndex,
  );
  if (
    afterFrames !== null &&
    spans !== null &&
    adjacentTransitions.length > 0
  ) {
    try {
      resolveTransitionWindows(adjacentTransitions, spans, fps);
    } catch (error) {
      transitionIssue = errorMessage(error);
    }
  }

  return {
    changed,
    shotIndex,
    zeroFrameShotIndex,
    partialRepairAllowed,
    beforeFrames,
    afterFrames,
    frameError,
    transitionIssue,
  };
}

// 应用闸门：零帧时长挡在 onRevise 之前——否则下一次渲染 quantizeTimeline 会抛
// ZeroFrameShotError，整页崩溃，未保存草稿全丢。
export function durationApplyError(
  impact: DurationImpact | null,
): string | null {
  // 不可编辑等场景没有 impact；时长未改（含越界哨兵）不拦。
  if (impact === null || !impact.changed) return null;
  // transitionIssue 仍只警告不拦：导出期已是 fail-loud，编辑期不重复拦。
  if (impact.frameError === null) return null;
  // 存量坏项目允许逐镜头修复，但不能把新的零帧借前面的报错掩盖掉。
  if (impact.partialRepairAllowed) return null;
  return `无法应用：${impact.frameError}`;
}
