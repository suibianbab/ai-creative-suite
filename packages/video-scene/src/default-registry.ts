import { basicShapes } from "./components/basic-shapes.js";
import { lineDrawing } from "./components/line-drawing.js";
import { textAnimation } from "./components/text-animation.js";
import { createRegistry, type SceneRegistry } from "./registry.js";

// 平台默认注册表 v1（ADR 0003 §2）：文字动画 / 线描 / 基础图形，全部 version 1。
// 新视觉能力 = 追加组件并 bump registryVersion，不是放开自由代码生成。
export const defaultRegistry: SceneRegistry = createRegistry(
  [textAnimation, lineDrawing, basicShapes],
  1,
);
