// timeline-milestones@1：里程碑时间轴——横向（横版）/纵向（竖版）轴线，
// 节点圆 + 日期 + 标签 + 完成态填充（已完成=实心主色，进行中=空心强调色，
// 待启动=空心灰）。纯函数渲染；参数有界；确定性。
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

export type Milestone = {
  date: string;
  label: string;
  status: "done" | "active" | "pending";
};

export type TimelineMilestonesParams = {
  title: string;
  milestones: Milestone[];
  textColor: string;
  lineColor: string;
  doneColor: string;
  activeColor: string;
  pendingColor: string;
  enterMs: number;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readColor(
  value: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = value[key];
  if (v === undefined) return fallback;
  if (typeof v !== "string" || !HEX_COLOR.test(v))
    throw new Error(`timeline-milestones 参数 ${key} 须为 #RRGGBB`);
  return v;
}

const STATUS_SET = new Set(["done", "active", "pending"]);

export function validateParams(value: unknown): TimelineMilestonesParams {
  if (!isRecord(value))
    throw new Error("timeline-milestones params 必须是对象");
  const title = value.title;
  if (typeof title !== "string" || title.length < 1 || title.length > 30)
    throw new Error("timeline-milestones title 须为 1..30 字");
  const raw: unknown = value.milestones;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6)
    throw new Error("timeline-milestones milestones 须为 2..6 项");
  const milestones = raw.map((item, index): Milestone => {
    if (!isRecord(item)) throw new Error(`milestones[${index}] 必须是对象`);
    const date = item.date;
    const label = item.label;
    const status = item.status;
    if (typeof date !== "string" || date.length < 1 || date.length > 10)
      throw new Error(`milestones[${index}].date 须为 1..10 字`);
    if (typeof label !== "string" || label.length < 1 || label.length > 12)
      throw new Error(`milestones[${index}].label 须为 1..12 字`);
    if (typeof status !== "string" || !STATUS_SET.has(status))
      throw new Error(`milestones[${index}].status 须为 done/active/pending`);
    return { date, label, status: status as Milestone["status"] };
  });
  return {
    title,
    milestones,
    textColor: readColor(value, "textColor", "#1b2c29"),
    lineColor: readColor(value, "lineColor", "#c8d4cd"),
    doneColor: readColor(value, "doneColor", "#2f6f4f"),
    activeColor: readColor(value, "activeColor", "#d9822b"),
    pendingColor: readColor(value, "pendingColor", "#9aa8a0"),
    enterMs:
      typeof value.enterMs === "number" &&
      value.enterMs >= 200 &&
      value.enterMs <= 5000
        ? value.enterMs
        : 1400,
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const p = spec.params as TimelineMilestonesParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const n = p.milestones.length;
  const portrait = ctx.height > ctx.width;
  const titleSize = fitFontSize(ctx.width * 0.045, p.title, ctx.width * 0.8);
  const dateSize = fitFontSize(
    ctx.width * 0.024,
    "0000-00-00",
    ctx.width * 0.16,
  );
  const labelSize = fitFontSize(
    ctx.width * 0.026,
    "四个字标签",
    ctx.width * 0.18,
  );
  const nodeR = Math.min(ctx.width, ctx.height) * 0.018;

  // 轴线位置：横版 y=60%，纵版 x=50%
  const axisY = portrait ? ctx.height * 0.55 : ctx.height * 0.58;
  const axisX = portrait ? ctx.width * 0.5 : 0;
  const start = portrait ? ctx.height * 0.28 : ctx.width * 0.12;
  const end = portrait ? ctx.height * 0.82 : ctx.width * 0.9;
  const step = (end - start) / (n - 1);
  const titleAppear = easeOutCubic(clamp01(tMs / 600));
  const axisAppear = easeOutCubic(clamp01((tMs - 300) / 800));

  const position = (index: number) =>
    portrait
      ? { x: axisX, y: start + step * index }
      : { x: start + step * index, y: axisY };

  const nodes: SvgNode[] = [];
  p.milestones.forEach((milestone, index) => {
    const appear = easeOutCubic(clamp01((tMs - 600 - index * 300) / 500));
    const { x, y } = position(index);
    const color =
      milestone.status === "done"
        ? p.doneColor
        : milestone.status === "active"
          ? p.activeColor
          : p.pendingColor;
    const filled = milestone.status === "done";
    const textAnchor = portrait ? "start" : "middle";
    const dateY = portrait ? y - nodeR * 2.2 : y - nodeR * 2.8;
    const labelY = portrait ? y + nodeR * 2.5 : y + nodeR * 3;
    const dateX = portrait ? x + nodeR * 2.5 : x;
    nodes.push(
      {
        tag: "circle",
        attrs: {
          cx: x,
          cy: y,
          r: filled ? nodeR : nodeR * 0.7,
          fill: filled ? color : "none",
          stroke: color,
          "stroke-width": 3,
          opacity: appear,
        },
      },
      {
        tag: "text",
        attrs: {
          x: dateX,
          y: dateY,
          "font-size": dateSize,
          fill: p.textColor,
          "text-anchor": textAnchor,
          "dominant-baseline": "middle",
          opacity: appear * 0.7,
        },
        text: milestone.date,
      },
      {
        tag: "text",
        attrs: {
          x: dateX,
          y: labelY,
          "font-size": labelSize,
          fill: p.textColor,
          "text-anchor": textAnchor,
          "dominant-baseline": "middle",
          opacity: appear,
        },
        text: milestone.label,
      },
    );
  });

  const line = portrait
    ? {
        tag: "line",
        attrs: {
          x1: axisX,
          y1: start,
          x2: axisX,
          y2: end,
          stroke: p.lineColor,
          "stroke-width": 4,
          "stroke-linecap": "round",
          opacity: axisAppear,
        },
      }
    : {
        tag: "line",
        attrs: {
          x1: start,
          y1: axisY,
          x2: end,
          y2: axisY,
          stroke: p.lineColor,
          "stroke-width": 4,
          "stroke-linecap": "round",
          opacity: axisAppear,
        },
      };

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
        tag: "text",
        attrs: {
          x: ctx.width / 2,
          y: ctx.height * 0.16,
          "font-size": titleSize,
          fill: p.textColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          opacity: titleAppear,
        },
        text: p.title,
      },
      line,
      ...nodes,
    ],
  };
}

export const timelineMilestones: SceneComponent = {
  componentId: "timeline-milestones",
  version: 1,
  validateParams,
  render,
};
