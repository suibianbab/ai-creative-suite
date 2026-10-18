import {
  resolveTransitionWindows,
  type ShotTransition,
  type TransitionWindow,
} from "@acs/video-document";

// —— P1 转场（Feature ④ spec R4）：工作台草稿纯逻辑——组件只做渲染/状态接线 ——
// 行 = 逐边界（0..shotCount-2）；kind none = 无转场（不进 patch）。
export type TransitionDraftRow = {
  boundary: number;
  kind: "none" | "fade";
  durationMs: number;
};

const DEFAULT_MS = 500;

// 镜头增删后越界条目静默丢弃（spec 错误表：草稿重建时丢弃，校验层兜底拒绝）。
export function transitionsDraftFromProject(
  shotCount: number,
  transitions?: ShotTransition[],
): TransitionDraftRow[] {
  const byBoundary = new Map(
    (transitions ?? [])
      .filter(
        (transition) =>
          transition.boundary >= 0 && transition.boundary < shotCount - 1,
      )
      .map((transition) => [transition.boundary, transition]),
  );
  return Array.from({ length: Math.max(shotCount - 1, 0) }, (_, boundary) => {
    const existing = byBoundary.get(boundary);
    return {
      boundary,
      kind: existing ? "fade" : "none",
      durationMs: existing?.durationMs ?? DEFAULT_MS,
    };
  });
}

// 全无 → patch undefined（文档不加 transitions 键，A1 字节不变口径）；
// 非法时长 → patch undefined + error（行内提示，不落文档）。
export function buildTransitionsPatch(rows: TransitionDraftRow[]): {
  patch: ShotTransition[] | undefined;
  error: string | null;
} {
  const active = rows.filter((row) => row.kind === "fade");
  for (const row of active) {
    if (
      !Number.isInteger(row.durationMs) ||
      row.durationMs < 100 ||
      row.durationMs > 2000
    ) {
      return {
        patch: undefined,
        error: `转场时长须为 100..2000 的整数毫秒（边界 ${row.boundary + 1}）`,
      };
    }
  }
  if (active.length === 0) return { patch: undefined, error: null };
  return {
    patch: active.map((row) => ({
      boundary: row.boundary,
      kind: "fade" as const,
      durationMs: row.durationMs,
    })),
    error: null,
  };
}

// 非法编辑不清除已配置转场：键盘输入的中间态（如把 500 改打 1500 时的
// 首键 1）返回 previous 同引用——文档内容不动，草稿重建 effect 也不触发
// （行不被重置、行内错误不被抹掉）；合法才给 patch / undefined（删键）。
export function transitionsAfterEdit(
  rows: TransitionDraftRow[],
  previous: ShotTransition[] | undefined,
): { transitions: ShotTransition[] | undefined; error: string | null } {
  const { patch, error } = buildTransitionsPatch(rows);
  return { transitions: error === null ? patch : previous, error };
}

// 预览端装配失败降级为告警而不是抛错（spec 错误表：预览告警标记，CLI 出片
// 路径仍大声失败）——span 不足/相邻合计借空等 resolveTransitionWindows 的
// 拒绝在整片预览里呈现为无叠层 + 文案指路，不炸整个工作台页面。
export function previewTransitionWindows(
  transitions: ShotTransition[] | undefined,
  spans: Array<{ startFrame: number; frames: number }>,
  fps: number,
): { windows: TransitionWindow[]; warning: string | null } {
  if (!transitions || transitions.length === 0) {
    return { windows: [], warning: null };
  }
  try {
    return {
      windows: resolveTransitionWindows(transitions, spans, fps),
      warning: null,
    };
  } catch (error) {
    return {
      windows: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}
