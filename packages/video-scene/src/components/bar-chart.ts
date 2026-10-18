import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 柱状图组件 v1：标题 + N 柱对比（最大柱 accent 高亮），逐柱 90ms 梯次自基线
// 生长，值标签在柱完成后 300ms 淡入。1000×1000 设计空间嵌套 svg viewBox
//（横竖版同 spec 等比居中，沿 line-drawing 先例）；render 纯函数，禁墙钟/随机/网络。

type BarChartParams = {
  title: string;
  bars: Array<{ label: string; value: number }>;
  barColor: string;
  accentColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 图表区（设计空间坐标）：x 120..880，y 200..850（基线）
const LEFT = 120;
const RIGHT = 880;
const TOP = 200;
const BASELINE = 850;
const CHART_WIDTH = RIGHT - LEFT;
const CHART_HEIGHT = BASELINE - TOP;
const STAGGER_MS = 90;
const VALUE_FADE_MS = 300;
const MAX_BARS = 8;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): BarChartParams {
  if (!isRecord(value)) throw new Error("bar-chart params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("bar-chart params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.bars) ||
    value.bars.length < 1 ||
    value.bars.length > MAX_BARS
  ) {
    throw new Error(
      `bar-chart params.bars 必须是 1..${MAX_BARS} 条 {label, value}`,
    );
  }
  value.bars.forEach((bar, i) => {
    if (!isRecord(bar))
      throw new Error(`bar-chart params.bars[${i}] 必须是对象`);
    if (
      typeof bar.label !== "string" ||
      bar.label.length < 1 ||
      bar.label.length > 12
    ) {
      throw new Error(`bar-chart params.bars[${i}].label 必须是 1..12 个字符`);
    }
    if (
      typeof bar.value !== "number" ||
      !Number.isFinite(bar.value) ||
      bar.value < 0 ||
      bar.value > MAX_VALUE
    ) {
      throw new Error(
        `bar-chart params.bars[${i}].value 必须是 0..${MAX_VALUE} 的数`,
      );
    }
  });
  if (!isHexColor(value.barColor))
    throw new Error("bar-chart params.barColor 必须是 #rrggbb");
  if (!isHexColor(value.accentColor))
    throw new Error("bar-chart params.accentColor 必须是 #rrggbb");
  if (!isHexColor(value.textColor))
    throw new Error("bar-chart params.textColor 必须是 #rrggbb");
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("bar-chart params.enterMs 必须是 200..6000 的整数");
  }
  return value as BarChartParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as BarChartParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const values = params.bars.map((bar) => bar.value);
  const maxValue = Math.max(...values);
  // y 上限 = max×1.1（值标签头空间）；全零归一为 1 防除零
  const yMax = maxValue * 1.1 || 1;
  const slot = CHART_WIDTH / params.bars.length;
  const barW = slot * 0.55;

  const bars: SvgNode[] = [];
  const labels: SvgNode[] = [];
  const valueTexts: SvgNode[] = [];
  params.bars.forEach((bar, i) => {
    const delay = i * STAGGER_MS;
    const grow = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const h = (bar.value / yMax) * CHART_HEIGHT * grow;
    const center = LEFT + i * slot + slot / 2;
    bars.push({
      tag: "rect",
      attrs: {
        x: center - barW / 2,
        y: BASELINE - h,
        width: barW,
        height: h,
        rx: 6,
        fill: bar.value === maxValue ? params.accentColor : params.barColor,
      },
    });
    labels.push({
      tag: "text",
      attrs: {
        x: center,
        y: 890,
        "font-size": 26,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: grow,
      },
      text: bar.label,
    });
    valueTexts.push({
      tag: "text",
      attrs: {
        x: center,
        y: BASELINE - h - 18,
        "font-size": 28,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01((tMs - delay - params.enterMs) / VALUE_FADE_MS),
      },
      text: String(bar.value),
    });
  });

  const grids: SvgNode[] = [0.25, 0.5, 0.75].map((ratio) => ({
    tag: "line" as const,
    attrs: {
      x1: LEFT,
      y1: TOP + CHART_HEIGHT * ratio,
      x2: RIGHT,
      y2: TOP + CHART_HEIGHT * ratio,
      stroke: params.textColor,
      opacity: 0.15,
      "stroke-width": 2,
    },
  }));

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          fill: spec.background,
        },
      },
      {
        // 嵌套 svg：1000×1000 设计空间等比映射到画布并居中（preserveAspectRatio 默认 xMidYMid meet）
        tag: "svg",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          viewBox: `0 0 ${DESIGN_SPACE} ${DESIGN_SPACE}`,
        },
        children: [
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 100,
              "font-size": fitFontSize(48, params.title, 880),
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          ...grids,
          {
            tag: "line",
            attrs: {
              x1: LEFT,
              y1: BASELINE,
              x2: RIGHT,
              y2: BASELINE,
              stroke: params.textColor,
              opacity: 0.5,
              "stroke-width": 3,
            },
          },
          ...bars,
          ...valueTexts,
          ...labels,
        ],
      },
    ],
  };
}

export const barChart: SceneComponent = {
  componentId: "bar-chart",
  version: 1,
  validateParams,
  render,
};
