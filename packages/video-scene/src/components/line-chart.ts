import { layoutFor } from "../aspect-layout.js";
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import { fitWrappedText, isPortrait, safeFrame } from "../safe-layout.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 折线图组件 v1：标题 + 折线描画（pathLength=1 + dashoffset，同 line-drawing
// 口径）+ 数据点圆标（描画进度越过该点累计长度占比后弹出）。1000×1000 设计
// 空间嵌套 svg viewBox；render 纯函数，禁墙钟/随机/网络。

type LineChartParams = {
  title: string;
  points: Array<{ label?: string; value: number }>;
  lineColor: string;
  markerColor: string;
  textColor: string;
  drawMs: number; // 200..6000
};

// 每画幅版式覆写（2026-10-23 brief §三B）：只动轴标签层——labelStep 显示
// 间隔（命中 index%step===0 或末点恒显）、shortLabels 逐项短标签（原样
// 显示，绕过既有 >6 字截断）。数据值与未覆写标签行为不变。
type LineChartLayoutOverride = {
  labelStep?: number;
  shortLabels?: Array<{ index: number; text: string }>;
};

const LINE_CHART_LAYOUT_KEYS = ["labelStep", "shortLabels"] as const;

export type LineChartLabelItem = {
  index: number;
  label: string | undefined;
  show: boolean;
  text: string;
};

// 标签显示规则（渲染与工作台「哪些标签被隐藏/截断/简写」提示共用）：
// 未覆写标签维持既有 >6 字截断；shortLabels 命中项原样显示。
export function lineChartLabelDisplay(
  points: Array<{ label?: string; value: number }>,
  override: LineChartLayoutOverride | undefined,
): LineChartLabelItem[] {
  const n = points.length;
  const step = override?.labelStep ?? 1;
  const shortByIndex = new Map(
    (override?.shortLabels ?? []).map((item) => [item.index, item.text]),
  );
  return points.map((point, index) => {
    const label = point.label;
    const shortened = label === undefined ? undefined : shortByIndex.get(index);
    const text =
      shortened !== undefined
        ? shortened
        : label === undefined
          ? ""
          : label.length > 6
            ? `${label.slice(0, 6)}…`
            : label;
    return {
      index,
      label,
      // 旧口径 `if (!point.label) return` 同时跳过 undefined 与 ""——
      // show 判定保持同口径，空字符串标签不渲染（旧 spec 逐字节不变）。
      show:
        label !== undefined &&
        label !== "" &&
        (step <= 1 || index % step === 0 || index === n - 1),
      text,
    };
  });
}

function validateLayout(aspectValue: unknown, params: unknown): void {
  if (!isRecord(aspectValue))
    throw new Error("line-chart layout 覆写必须是对象");
  for (const key of Object.keys(aspectValue)) {
    if (!(LINE_CHART_LAYOUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `line-chart layout 不支持 ${key}（允许 ${LINE_CHART_LAYOUT_KEYS.join("/")}）`,
      );
    }
  }
  const points =
    isRecord(params) && Array.isArray(params.points) ? params.points : [];
  const maxStep = Math.max(points.length, 1);
  if (aspectValue.labelStep !== undefined) {
    const step = aspectValue.labelStep;
    if (
      typeof step !== "number" ||
      !Number.isInteger(step) ||
      step < 1 ||
      step > maxStep
    ) {
      throw new Error(
        `line-chart layout.labelStep 必须是 1..${maxStep} 的整数`,
      );
    }
  }
  if (aspectValue.shortLabels !== undefined) {
    const entries = aspectValue.shortLabels;
    if (!Array.isArray(entries)) {
      throw new Error("line-chart layout.shortLabels 必须是数组");
    }
    const seen = new Set<number>();
    entries.forEach((entry) => {
      if (!isRecord(entry)) {
        throw new Error("line-chart layout.shortLabels[] 必须是对象");
      }
      const index = entry.index;
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw new Error("line-chart layout.shortLabels[].index 必须是整数");
      }
      if (index < 0 || index >= points.length) {
        throw new Error(
          `line-chart layout.shortLabels[].index ${index} 越界（0..${points.length - 1}）`,
        );
      }
      if (seen.has(index)) {
        throw new Error(`line-chart layout.shortLabels[].index ${index} 重复`);
      }
      seen.add(index);
      const text = entry.text;
      if (typeof text !== "string" || text.length < 1 || text.length > 12) {
        throw new Error(
          "line-chart layout.shortLabels[].text 必须是 1..12 个字符",
        );
      }
    });
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const LEFT = 120;
const RIGHT = 880;
const TOP = 200;
const BASELINE = 850;
const CHART_WIDTH = RIGHT - LEFT;
const CHART_HEIGHT = BASELINE - TOP;
const MARKER_R = 9;
const MARKER_WINDOW = 0.05; // 描画进度越过该点后 5% 进度窗口内弹出
const MAX_POINTS = 12;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LineChartParams {
  if (!isRecord(value)) throw new Error("line-chart params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("line-chart params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > MAX_POINTS
  ) {
    throw new Error(
      `line-chart params.points 必须是 2..${MAX_POINTS} 个 {label?, value}`,
    );
  }
  value.points.forEach((point, i) => {
    if (!isRecord(point))
      throw new Error(`line-chart params.points[${i}] 必须是对象`);
    if (
      point.label !== undefined &&
      (typeof point.label !== "string" || point.label.length > 12)
    ) {
      throw new Error(`line-chart params.points[${i}].label 必须是 ≤12 个字符`);
    }
    if (
      typeof point.value !== "number" ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      point.value > MAX_VALUE
    ) {
      throw new Error(
        `line-chart params.points[${i}].value 必须是 0..${MAX_VALUE} 的数`,
      );
    }
  });
  if (!isHexColor(value.lineColor))
    throw new Error("line-chart params.lineColor 必须是 #rrggbb");
  if (!isHexColor(value.markerColor))
    throw new Error("line-chart params.markerColor 必须是 #rrggbb");
  if (!isHexColor(value.textColor))
    throw new Error("line-chart params.textColor 必须是 #rrggbb");
  if (
    !Number.isInteger(value.drawMs) ||
    (value.drawMs as number) < 200 ||
    (value.drawMs as number) > 6000
  ) {
    throw new Error("line-chart params.drawMs 必须是 200..6000 的整数");
  }
  return value as LineChartParams;
}

function renderPortrait(
  spec: SceneSpecLike,
  ctx: FrameContext,
  params: LineChartParams,
  progress: number,
): SvgNode {
  const safe = safeFrame(ctx);
  const title = fitWrappedText(
    params.title,
    ctx.width * 0.075,
    safe.textWidth,
    2,
  );
  const plotLeft = safe.left + ctx.width * 0.035;
  const plotRight = safe.right - ctx.width * 0.035;
  const plotTop = ctx.height * 0.42;
  const baseline = ctx.height * 0.72;
  const plotHeight = baseline - plotTop;
  const plotWidth = plotRight - plotLeft;
  const values = params.points.map((point) => point.value);
  const yMax = Math.max(...values) * 1.1 || 1;
  const n = params.points.length;
  const xs = params.points.map(
    (_, index) => plotLeft + (plotWidth * index) / (n - 1),
  );
  const ys = params.points.map(
    (point) => baseline - (point.value / yMax) * plotHeight,
  );
  const d = xs
    .map(
      (x, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${ys[index]!.toFixed(2)}`,
    )
    .join(" ");
  const cum = [0];
  for (let index = 1; index < n; index++) {
    cum.push(
      cum[index - 1]! +
        Math.hypot(xs[index]! - xs[index - 1]!, ys[index]! - ys[index - 1]!),
    );
  }
  const total = cum[n - 1]!;
  const markers: SvgNode[] = params.points.map((_, index) => {
    const frac = Math.min(cum[index]! / total, 1 - MARKER_WINDOW);
    const appear = easeOutCubic(clamp01((progress - frac) / MARKER_WINDOW));
    return {
      tag: "circle",
      attrs: {
        cx: xs[index]!,
        cy: ys[index]!,
        r: ctx.width * 0.0125 * appear,
        fill: params.markerColor,
      },
    };
  });
  const labelSlot = plotWidth / (n - 1);
  const labels: SvgNode[] = [];
  for (const item of lineChartLabelDisplay(
    params.points,
    layoutFor(spec, ctx) as LineChartLayoutOverride | undefined,
  )) {
    if (!item.show) continue;
    const index = item.index;
    labels.push({
      tag: "text",
      attrs: {
        x: xs[index]!,
        y: baseline + ctx.height * 0.048,
        "font-size": fitFontSize(
          ctx.width * 0.036,
          item.text,
          index === 0 || index === n - 1 ? labelSlot * 1.7 : labelSlot * 0.9,
        ),
        fill: params.textColor,
        "text-anchor":
          index === 0 ? "start" : index === n - 1 ? "end" : "middle",
        "dominant-baseline": "middle",
        opacity: clamp01(progress * 2),
      },
      text: item.text,
    });
  }
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
      ...title.lines.map(
        (line, index): SvgNode => ({
          tag: "text",
          attrs: {
            x: ctx.width / 2,
            y:
              ctx.height * 0.255 +
              (index - (title.lines.length - 1) / 2) * title.fontSize * 1.25,
            "font-size": title.fontSize,
            fill: params.textColor,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          text: line,
        }),
      ),
      ...[0.25, 0.5, 0.75].map(
        (ratio): SvgNode => ({
          tag: "line",
          attrs: {
            x1: plotLeft,
            y1: plotTop + plotHeight * ratio,
            x2: plotRight,
            y2: plotTop + plotHeight * ratio,
            stroke: params.textColor,
            opacity: 0.15,
            "stroke-width": 2,
          },
        }),
      ),
      {
        tag: "line",
        attrs: {
          x1: plotLeft,
          y1: baseline,
          x2: plotRight,
          y2: baseline,
          stroke: params.textColor,
          opacity: 0.5,
          "stroke-width": 3,
        },
      },
      {
        tag: "path",
        attrs: {
          d,
          fill: "none",
          stroke: params.lineColor,
          "stroke-width": ctx.width * 0.011,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          pathLength: 1,
          "stroke-dasharray": 1,
          "stroke-dashoffset": 1 - progress,
        },
      },
      ...markers,
      ...labels,
    ],
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LineChartParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.drawMs));
  if (isPortrait(ctx)) return renderPortrait(spec, ctx, params, progress);
  const values = params.points.map((point) => point.value);
  const yMax = Math.max(...values) * 1.1 || 1;
  const n = params.points.length;
  const xs = params.points.map((_, i) => LEFT + (CHART_WIDTH * i) / (n - 1));
  const ys = params.points.map(
    (point) => BASELINE - (point.value / yMax) * CHART_HEIGHT,
  );

  const d = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${ys[i]!.toFixed(2)}`)
    .join(" ");

  // 累计长度占比（设计空间坐标；比例与渲染空间一致，比例尺不变）
  const cum = [0];
  for (let i = 1; i < n; i += 1) {
    cum.push(
      cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!),
    );
  }
  const total = cum[n - 1]!; // n≥2 且 xs 严格递增 → total > 0
  const markers: SvgNode[] = params.points.map((_, i) => {
    // frac 上界钳到 1-MARKER_WINDOW：progress 上界为 1，末点 frac=1 时
    // (progress-frac) 恒 ≤0，圆标会永不弹出；钳制让收尾段（最后 5% 进度）弹出。
    const frac = Math.min(cum[i]! / total, 1 - MARKER_WINDOW);
    const appear = easeOutCubic(clamp01((progress - frac) / MARKER_WINDOW));
    return {
      tag: "circle",
      attrs: {
        cx: xs[i]!,
        cy: ys[i]!,
        r: MARKER_R * appear,
        fill: params.markerColor,
      },
    };
  });

  const labels: SvgNode[] = [];
  for (const item of lineChartLabelDisplay(
    params.points,
    layoutFor(spec, ctx) as LineChartLayoutOverride | undefined,
  )) {
    if (!item.show) continue;
    labels.push({
      tag: "text",
      attrs: {
        x: xs[item.index]!,
        y: 875,
        "font-size": 26,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01(progress * 2), // 随描画前半程淡入
      },
      text: item.text,
    });
  }

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
              y: 155,
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
          {
            tag: "path",
            attrs: {
              d,
              fill: "none",
              stroke: params.lineColor,
              "stroke-width": 8,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": 1 - progress,
            },
          },
          ...markers,
          ...labels,
        ],
      },
    ],
  };
}

export const lineChart: SceneComponent = {
  componentId: "line-chart",
  version: 1,
  validateParams,
  validateLayout,
  render,
};
