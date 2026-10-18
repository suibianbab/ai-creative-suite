import { barChart } from "./components/bar-chart.js";
import { basicShapes } from "./components/basic-shapes.js";
import { lineChart } from "./components/line-chart.js";
import { lineDrawing } from "./components/line-drawing.js";
import { textAnimation } from "./components/text-animation.js";
import { createRegistry, type SceneRegistry } from "./registry.js";

// 平台默认注册表：文字动画 / 线描 / 基础图形，全部 version 1。
// 新视觉能力 = 追加组件并 bump registryVersion，不是放开自由代码生成。
// v2（P2-① 数据可视化）：追加 bar-chart / line-chart / number-counter，
// 同一分支内原子落地，版本维持 2。
export const defaultRegistry: SceneRegistry = createRegistry(
  [textAnimation, lineDrawing, basicShapes, barChart, lineChart],
  2,
);
