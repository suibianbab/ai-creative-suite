import type { FrameContext, SceneSpecLike } from "./registry.js";

// 每画幅版式覆写（2026-10-23 brief §三B）：SceneSpec 顶层可选字段，
// 缺省 = 既有自动布局（旧项目零变化）。容器只约定「按画幅分桶」；
// 每个桶的字段形状由组件自己的 validateLayout 深度校验（registry.ts），
// 解释也归组件——预览与出片走同一 component.render，天然同规则。
export type AspectLayoutContainer = {
  portrait?: Record<string, unknown>;
  landscape?: Record<string, unknown>;
};

// 当前画幅的覆写（无 = undefined → 组件走自动布局）。
// 与组件一致用画布比例判画幅（isPortrait 同口径）。
export function layoutFor(
  spec: SceneSpecLike,
  ctx: FrameContext,
): Record<string, unknown> | undefined {
  const layout = (spec as { layout?: AspectLayoutContainer }).layout;
  if (!layout) return undefined;
  return ctx.height > ctx.width ? layout.portrait : layout.landscape;
}
