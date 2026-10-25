import { barChart } from "./components/bar-chart.js";
import { basicShapes } from "./components/basic-shapes.js";
import { compareSplit } from "./components/compare-split.js";
import { explainerComposition } from "./components/explainer-composition.js";
import { flowDiagram } from "./components/flow-diagram.js";
import { flowSteps } from "./components/flow-steps.js";
import { lineChart } from "./components/line-chart.js";
import { lineDrawing } from "./components/line-drawing.js";
import { loadingDots } from "./components/loading-dots.js";
import { loadingProgress } from "./components/loading-progress.js";
import { mapGrid } from "./components/map-grid.js";
import { mapJourney } from "./components/map-journey.js";
import { numberCounter } from "./components/number-counter.js";
import { sketchNote } from "./components/sketch-note.js";
import { stickFigure } from "./components/stick-figure.js";
import { textAnimation } from "./components/text-animation.js";
import { timelineMilestones } from "./components/timeline-milestones.js";
import { createRegistry, type SceneRegistry } from "./registry.js";

// 平台默认注册表：文字动画 / 线描 / 基础图形，全部 version 1。
// 新视觉能力 = 追加组件并 bump registryVersion，不是放开自由代码生成。
// v2（P2-① 数据可视化）：追加 bar-chart / line-chart / number-counter，
// 同一分支内原子落地，版本维持 2。
// v3（P2-② 地图动画）：追加 map-grid / map-journey，同一分支内原子落地。
// v4（P2-③ 流程图/示意图）：追加流程组件，同一分支内原子落地。
// v5（P2-④ 火柴人）：追加 stick-figure，同一分支内原子落地。
// v6（P2-⑤ 手绘）：追加 sketch-note，同一分支内原子落地。
// v7（P2-⑥ 加载）：追加 loading-dots / loading-progress，同一分支内原子落地。
// v9（T4 构图缺口）：追加 compare-split（前后对比）/ timeline-milestones
// （里程碑时间轴），复用既有 SvgNode/fitFontSize/ easing 基建。
export const defaultRegistry: SceneRegistry = createRegistry(
  [
    textAnimation,
    lineDrawing,
    basicShapes,
    barChart,
    lineChart,
    numberCounter,
    mapGrid,
    mapJourney,
    flowSteps,
    flowDiagram,
    stickFigure,
    sketchNote,
    loadingDots,
    loadingProgress,
    explainerComposition,
    compareSplit,
    timelineMilestones,
  ],
  9,
);
