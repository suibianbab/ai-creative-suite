import type { ShotTransition } from "@acs/video-document";

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
