// compare-split@1：前后对比布局——左「前」右「后」分栏，各带标签/数值/
// 说明，中间箭头，底部差值徽章（颜色由改善/恶化语义决定）。纯函数渲染；
// 所有参数有界；确定性（无时钟、无随机）。
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

export type CompareSplitParams = {
  title: string;
  metricLabel: string;
  beforeLabel: string;
  beforeValue: string;
  beforeNote: string;
  afterLabel: string;
  afterValue: string;
  afterNote: string;
  deltaText: string;
  deltaPositive: boolean; // true=改善（绿），false=恶化（红）
  textColor: string;
  panelColor: string;
  accentColor: string;
  positiveColor: string;
  negativeColor: string;
  enterMs: number;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  params: Record<string, unknown>,
  key: string,
  max: number,
): string {
  const value = params[key];
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    throw new Error(`compare-split 参数 ${key} 须为 1..${max} 字`);
  return value;
}

function readColor(
  params: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !HEX_COLOR.test(value))
    throw new Error(`compare-split 参数 ${key} 须为 #RRGGBB`);
  return value;
}

export function validateParams(value: unknown): CompareSplitParams {
  if (!isRecord(value)) throw new Error("compare-split params 必须是对象");
  return {
    title: readString(value, "title", 30),
    metricLabel: readString(value, "metricLabel", 20),
    beforeLabel: readString(value, "beforeLabel", 12),
    beforeValue: readString(value, "beforeValue", 12),
    beforeNote: readString(value, "beforeNote", 20),
    afterLabel: readString(value, "afterLabel", 12),
    afterValue: readString(value, "afterValue", 12),
    afterNote: readString(value, "afterNote", 20),
    deltaText: readString(value, "deltaText", 16),
    deltaPositive: value.deltaPositive === true,
    textColor: readColor(value, "textColor", "#1b2c29"),
    panelColor: readColor(value, "panelColor", "#e8f0eb"),
    accentColor: readColor(value, "accentColor", "#d9822b"),
    positiveColor: readColor(value, "positiveColor", "#2f6f4f"),
    negativeColor: readColor(value, "negativeColor", "#b3261e"),
    enterMs:
      typeof value.enterMs === "number" &&
      value.enterMs >= 200 &&
      value.enterMs <= 5000
        ? value.enterMs
        : 1200,
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const p = spec.params as CompareSplitParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const titleSize = fitFontSize(ctx.width * 0.045, p.title, ctx.width * 0.8);
  const labelSize = fitFontSize(
    ctx.width * 0.028,
    p.metricLabel,
    ctx.width * 0.6,
  );
  const valueSize = fitFontSize(
    ctx.width * 0.065,
    p.afterValue,
    ctx.width * 0.35,
  );
  const noteSize = fitFontSize(
    ctx.width * 0.022,
    p.beforeNote,
    ctx.width * 0.38,
  );
  const deltaSize = fitFontSize(
    ctx.width * 0.032,
    p.deltaText,
    ctx.width * 0.3,
  );
  const portrait = ctx.height > ctx.width;
  const panelW = portrait ? ctx.width * 0.84 : ctx.width * 0.38;
  const panelH = portrait ? ctx.height * 0.28 : ctx.height * 0.42;
  const leftX = portrait ? ctx.width * 0.08 : ctx.width * 0.08;
  const rightX = portrait ? ctx.width * 0.08 : ctx.width * 0.54;
  const leftY = portrait ? ctx.height * 0.28 : ctx.height * 0.32;
  const rightY = portrait ? ctx.height * 0.62 : ctx.height * 0.32;
  const arrowX = portrait ? ctx.width * 0.5 : ctx.width * 0.5;
  const arrowY = portrait ? ctx.height * 0.585 : ctx.height * 0.53;
  const appear = easeOutCubic(clamp01((tMs - 200) / p.enterMs));
  const afterAppear = easeOutCubic(clamp01((tMs - 700) / p.enterMs));
  const deltaAppear = easeOutCubic(clamp01((tMs - 1400) / 600));

  const panel = (x: number, y: number, opacity: number): SvgNode => ({
    tag: "rect",
    attrs: {
      x,
      y,
      width: panelW,
      height: panelH,
      rx: 16,
      fill: p.panelColor,
      opacity,
    },
  });

  const text = (
    x: number,
    y: number,
    content: string,
    size: number,
    fill: string,
    opacity: number,
    anchor = "middle",
  ): SvgNode => ({
    tag: "text",
    attrs: {
      x,
      y,
      "font-size": size,
      fill,
      "text-anchor": anchor,
      "dominant-baseline": "middle",
      opacity,
    },
    text: content,
  });

  const panelContent = (
    x: number,
    y: number,
    label: string,
    value: string,
    note: string,
    opacity: number,
  ): SvgNode[] => [
    text(
      x + panelW / 2,
      y + panelH * 0.22,
      label,
      labelSize,
      p.accentColor,
      opacity,
    ),
    text(
      x + panelW / 2,
      y + panelH * 0.52,
      value,
      valueSize,
      p.textColor,
      opacity,
    ),
    text(
      x + panelW / 2,
      y + panelH * 0.82,
      note,
      noteSize,
      p.textColor,
      opacity * 0.7,
    ),
  ];

  const arrow = portrait
    ? {
        tag: "path",
        attrs: {
          d: `M ${arrowX - 14} ${arrowY - 18} L ${arrowX} ${arrowY + 4} L ${arrowX + 14} ${arrowY - 18}`,
          stroke: p.accentColor,
          "stroke-width": 6,
          fill: "none",
          "stroke-linecap": "round",
          opacity: afterAppear,
        },
      }
    : {
        tag: "path",
        attrs: {
          d: `M ${arrowX - 18} ${arrowY - 14} L ${arrowX + 4} ${arrowY} L ${arrowX - 18} ${arrowY + 14}`,
          stroke: p.accentColor,
          "stroke-width": 6,
          fill: "none",
          "stroke-linecap": "round",
          opacity: afterAppear,
        },
      };

  const deltaColor = p.deltaPositive ? p.positiveColor : p.negativeColor;
  const badgeW = deltaSize * (p.deltaText.length + 2);
  const badgeX = ctx.width / 2 - badgeW / 2;
  const badgeY = portrait ? ctx.height * 0.86 : ctx.height * 0.86;

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
      text(
        ctx.width / 2,
        ctx.height * 0.14,
        p.title,
        titleSize,
        p.textColor,
        appear,
      ),
      text(
        ctx.width / 2,
        ctx.height * 0.22,
        p.metricLabel,
        labelSize,
        p.textColor,
        appear * 0.7,
      ),
      panel(leftX, leftY, appear),
      ...panelContent(
        leftX,
        leftY,
        p.beforeLabel,
        p.beforeValue,
        p.beforeNote,
        appear,
      ),
      panel(rightX, rightY, afterAppear),
      ...panelContent(
        rightX,
        rightY,
        p.afterLabel,
        p.afterValue,
        p.afterNote,
        afterAppear,
      ),
      arrow,
      {
        tag: "rect",
        attrs: {
          x: badgeX,
          y: badgeY,
          width: badgeW,
          height: deltaSize * 2.2,
          rx: 12,
          fill: deltaColor,
          opacity: deltaAppear,
        },
      },
      text(
        ctx.width / 2,
        badgeY + deltaSize * 1.1,
        p.deltaText,
        deltaSize,
        "#ffffff",
        deltaAppear,
      ),
    ],
  };
}

export const compareSplit: SceneComponent = {
  componentId: "compare-split",
  version: 1,
  validateParams,
  render,
};
