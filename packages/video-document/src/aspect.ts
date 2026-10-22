import type { AspectTarget } from "./types.js";

// 出片帧率与画幅尺寸的唯一事实源：工作台预览（画幅切换必须与出片同坐标）
// 从这里取值；渲染 CLI 侧 scripts/video/render-scene.props.mjs 因保持纯同步
// 模块设计而留有本地常量，由 render-scene.props.test.mjs 的跨源一致性断言钉住。
export const EXPORT_FPS = 24;

export const EXPORT_DIMENSIONS: Readonly<
  Record<AspectTarget, readonly [number, number]>
> = {
  landscape: [1280, 720],
  portrait: [720, 1280],
};
