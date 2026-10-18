import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 路径行程组件 v1：起终点图钉 + Catmull-Rom 样条（τ=0.5，端点复制法转
// cubic bezier）整条描画（pathLength=1 + dashoffset，同 line-drawing 口径）
// + 移动标记等速走采样弧长（每段 24 采样折线累计，与 line-chart 圆标同一
// 数学先例；视觉误差 <1px）+ 途经点圆标（越点 5% 进度窗口弹出，末点 frac
// 钳 1−窗口——P2-① Task 3 Ruling）+ 浅网格底纹（5×5，opacity 0.08）。
// 1000×1000 设计空间嵌套 svg viewBox；render 纯函数，禁墙钟/随机/网络。

type JPoint = { label?: string; x: number; y: number };
type MapJourneyParams = {
  title: string;
  origin: { label: string; x: number; y: number };
  destination: { label: string; x: number; y: number };
  waypoints: JPoint[];
  routeColor: string;
  markerColor: string;
  pinColor: string;
  textColor: string;
  drawMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const MARKER_R = 9;
const MARKER_WINDOW = 0.05;
const SEGMENT_SAMPLES = 24;
const MAX_WAYPOINTS = 6;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validatePoint(
  value: unknown,
  at: string,
  labelRequired: boolean,
): void {
  if (!isRecord(value)) {
    throw new Error(`map-journey params.${at} 必须是 {label, x, y}`);
  }
  if (labelRequired) {
    if (
      typeof value.label !== "string" ||
      value.label.length < 1 ||
      value.label.length > 8
    ) {
      throw new Error(`map-journey params.${at}.label 必须是 1..8 个字符`);
    }
  } else if (
    value.label !== undefined &&
    (typeof value.label !== "string" || value.label.length > 8)
  ) {
    throw new Error(`map-journey params.${at}.label 必须是 ≤8 个字符`);
  }
  for (const key of ["x", "y"] as const) {
    const v = value[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > COORD_MAX
    ) {
      throw new Error(`map-journey params.${at}.x / y 必须是 0..1000 的数`);
    }
  }
}

function validateParams(value: unknown): MapJourneyParams {
  if (!isRecord(value)) throw new Error("map-journey params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("map-journey params.title 必须是 ≤40 个字符");
  }
  validatePoint(value.origin, "origin", true);
  validatePoint(value.destination, "destination", true);
  if (
    !Array.isArray(value.waypoints) ||
    value.waypoints.length > MAX_WAYPOINTS
  ) {
    throw new Error(
      `map-journey params.waypoints 必须是 0..${MAX_WAYPOINTS} 个 {label?, x, y}`,
    );
  }
  value.waypoints.forEach((wp, i) =>
    validatePoint(wp, `waypoints[${i}]`, false),
  );
  for (const key of [
    "routeColor",
    "markerColor",
    "pinColor",
    "textColor",
  ] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`map-journey params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.drawMs) ||
    (value.drawMs as number) < 200 ||
    (value.drawMs as number) > 6000
  ) {
    throw new Error("map-journey params.drawMs 必须是 200..6000 的整数");
  }
  return value as MapJourneyParams;
}

// Catmull-Rom（τ=0.5）→ 每段 cubic bezier 控制点（端点复制法）。
function segmentControl(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  ];
}

function cubicAt(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * c1.x +
      3 * u * t * t * c2.x +
      t * t * t * p1.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * c1.y +
      3 * u * t * t * c2.y +
      t * t * t * p1.y,
  };
}

// 弧长 s 处的采样折线插值点（samples/cum 等长，cum 单调不减）。
function pointAtArc(
  samples: Array<{ x: number; y: number }>,
  cum: number[],
  s: number,
): { x: number; y: number } {
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1]! < s) k += 1;
  const span = cum[k + 1]! - cum[k]! || 1;
  const f = clamp01((s - cum[k]!) / span);
  const a = samples[k]!;
  const b = samples[k + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function pin(x: number, y: number, progress01: number, color: string): SvgNode {
  // 落下：scale 1.6 → 1 + 淡入
  const scale = 1 + 0.6 * (1 - progress01);
  return {
    tag: "g",
    attrs: {
      transform: `translate(${x} ${y}) scale(${scale.toFixed(4)})`,
      opacity: progress01,
    },
    children: [
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 10, fill: color } },
      { tag: "circle", attrs: { cx: 0, cy: 0, r: 4, fill: "#ffffff" } },
    ],
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as MapJourneyParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.drawMs));

  const pts: Array<{ x: number; y: number }> = [
    params.origin,
    ...params.waypoints,
    params.destination,
  ];
  // 路径 d + 分段（端点复制法：首段 p0=pts[0]，末段 p3=末点）
  let d = `M ${pts[0]!.x.toFixed(2)},${pts[0]!.y.toFixed(2)}`;
  const segments: Array<{
    p0: { x: number; y: number };
    c1: { x: number; y: number };
    c2: { x: number; y: number };
    p1: { x: number; y: number };
  }> = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p3 = pts[i + 2] ?? pts[i + 1]!;
    const [c1, c2] = segmentControl(p0, pts[i]!, pts[i + 1]!, p3);
    segments.push({ p0: pts[i]!, c1, c2, p1: pts[i + 1]! });
    d += ` C ${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${pts[i + 1]!.x.toFixed(2)},${pts[i + 1]!.y.toFixed(2)}`;
  }
  // 采样折线与累计弧长（每段 24 采样）
  const samples: Array<{ x: number; y: number }> = [
    { x: pts[0]!.x, y: pts[0]!.y },
  ];
  const cum: number[] = [0];
  for (const seg of segments) {
    for (let k = 1; k <= SEGMENT_SAMPLES; k += 1) {
      const pt = cubicAt(seg.p0, seg.c1, seg.c2, seg.p1, k / SEGMENT_SAMPLES);
      const prev = samples[samples.length - 1]!;
      samples.push(pt);
      cum.push(cum[cum.length - 1]! + Math.hypot(pt.x - prev.x, pt.y - prev.y));
    }
  }
  // 重合点守卫：全同点 total=0 → 1（marker 停起点，不除零）
  const total = cum[cum.length - 1]! || 1;

  // 途经点圆标（含 frac 钳制，末点在描画收尾窗口弹出）
  const waypointMarkers: SvgNode[] = params.waypoints.map((wp, j) => {
    const sampleIndex = (j + 1) * SEGMENT_SAMPLES;
    const frac = Math.min(cum[sampleIndex]! / total, 1 - MARKER_WINDOW);
    const appear = easeOutCubic(clamp01((progress - frac) / MARKER_WINDOW));
    return {
      tag: "circle",
      attrs: {
        cx: wp.x,
        cy: wp.y,
        r: MARKER_R * appear,
        fill: params.routeColor,
      },
    };
  });

  // 移动标记（等速走弧长）
  const markerPos = pointAtArc(samples, cum, progress * total);

  // 图钉窗口：起点 0..20%、终点 60..80%（drawMs 计）
  const originPinP = easeOutCubic(clamp01(tMs / (params.drawMs * 0.2)));
  const destPinP = easeOutCubic(
    clamp01((tMs - params.drawMs * 0.6) / (params.drawMs * 0.2)),
  );

  // 浅网格底纹：5×5（100..900 步 200），先于一切内容
  const gridLines: SvgNode[] = [];
  for (let v = 100; v <= 900; v += 200) {
    gridLines.push({
      tag: "line",
      attrs: {
        x1: v,
        y1: 100,
        x2: v,
        y2: 900,
        stroke: params.textColor,
        opacity: 0.08,
        "stroke-width": 2,
      },
    });
    gridLines.push({
      tag: "line",
      attrs: {
        x1: 100,
        y1: v,
        x2: 900,
        y2: v,
        stroke: params.textColor,
        opacity: 0.08,
        "stroke-width": 2,
      },
    });
  }

  const pointLabel = (
    label: string,
    x: number,
    y: number,
    opacity: number,
  ): SvgNode => ({
    tag: "text",
    attrs: {
      x,
      y: y + 34,
      "font-size": fitFontSize(24, label, 220),
      fill: params.textColor,
      "text-anchor": "middle",
      opacity,
    },
    text: label,
  });

  const labels: SvgNode[] = [
    pointLabel(
      params.origin.label,
      params.origin.x,
      params.origin.y,
      originPinP,
    ),
    ...params.waypoints.map((wp, j) => {
      const sampleIndex = (j + 1) * SEGMENT_SAMPLES;
      const frac = Math.min(cum[sampleIndex]! / total, 1 - MARKER_WINDOW);
      return pointLabel(
        wp.label ?? "",
        wp.x,
        wp.y,
        wp.label === undefined ? 0 : clamp01((progress - frac) / MARKER_WINDOW),
      );
    }),
    pointLabel(
      params.destination.label,
      params.destination.x,
      params.destination.y,
      destPinP,
    ),
  ].filter((node) => (node.text as string).length > 0);

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
          ...gridLines,
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
          {
            tag: "path",
            attrs: {
              d,
              fill: "none",
              stroke: params.routeColor,
              "stroke-width": 8,
              "stroke-linecap": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": Number((1 - progress).toFixed(4)),
            },
          },
          ...waypointMarkers,
          pin(params.origin.x, params.origin.y, originPinP, params.pinColor),
          pin(
            params.destination.x,
            params.destination.y,
            destPinP,
            params.pinColor,
          ),
          {
            tag: "circle",
            attrs: {
              cx: Number(markerPos.x.toFixed(2)),
              cy: Number(markerPos.y.toFixed(2)),
              r: 12,
              fill: params.markerColor,
              stroke: "#ffffff",
              "stroke-width": 3,
            },
          },
          ...labels,
        ],
      },
    ],
  };
}

export const mapJourney: SceneComponent = {
  componentId: "map-journey",
  version: 1,
  validateParams,
  render,
};
