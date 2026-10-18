import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 加载进度环 v1：闭式弧长爬升——e = easeOutCubic(clamp01(tMs/progressMs))，
// 弧占比 frac = (targetPercent/100)·e（pathLength=1 + dasharray 1 +
// dashoffset 1−frac，沿 line-drawing 口径；rotate(-90) 自 12 点），中心
// 百分比 round(targetPercent·e)% 与弧同缓动同步，p≥1 保持。render 纯函数：
// 禁墙钟/未播种随机/网络。

type LoadingProgressParams = {
  title: string;
  label: string;
  targetPercent: number; // 1..100
  inkColor: string;
  accentColor: string;
  progressMs: number; // 400..2000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const TITLE_FADE_MS = 300;
const RING_R = 180;
const RING_STROKE = 22;
const TRACK_OPACITY = 0.12;
const PERCENT_FONT = 96;
const LABEL_FONT = 36;
const LABEL_MAX_WIDTH = 600;
const LABEL_Y = 780;
const MAX_LABEL = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LoadingProgressParams {
  if (!isRecord(value)) {
    throw new Error("loading-progress params 必须是对象");
  }
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("loading-progress params.title 必须是 ≤40 个字符");
  }
  const labelChars =
    typeof value.label === "string" ? Array.from(value.label) : [];
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    throw new Error(
      `loading-progress params.label 必须是 1..${MAX_LABEL} 个字符`,
    );
  }
  if (
    !Number.isInteger(value.targetPercent) ||
    (value.targetPercent as number) < 1 ||
    (value.targetPercent as number) > 100
  ) {
    throw new Error(
      "loading-progress params.targetPercent 必须是 1..100 的整数",
    );
  }
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`loading-progress params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.progressMs) ||
    (value.progressMs as number) < 400 ||
    (value.progressMs as number) > 2000
  ) {
    throw new Error(
      "loading-progress params.progressMs 必须是 400..2000 的整数",
    );
  }
  return value as LoadingProgressParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LoadingProgressParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const e = easeOutCubic(clamp01(tMs / params.progressMs));
  const frac = (params.targetPercent / 100) * e;
  const percent = Math.round(params.targetPercent * e);

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
              y: 100,
              "font-size": fitFontSize(48, params.title, 880),
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01(tMs / TITLE_FADE_MS),
            },
            text: params.title,
          },
          {
            tag: "circle",
            attrs: {
              cx: 500,
              cy: 520,
              r: RING_R,
              fill: "none",
              stroke: params.inkColor,
              "stroke-width": RING_STROKE,
              opacity: TRACK_OPACITY,
            },
          },
          {
            tag: "circle",
            attrs: {
              cx: 500,
              cy: 520,
              r: RING_R,
              fill: "none",
              stroke: params.accentColor,
              "stroke-width": RING_STROKE,
              "stroke-linecap": "round",
              pathLength: 1,
              "stroke-dasharray": 1,
              "stroke-dashoffset": Number((1 - frac).toFixed(4)),
              transform: "rotate(-90 500 520)",
            },
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 520,
              "font-size": PERCENT_FONT,
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: `${percent}%`,
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: LABEL_Y,
              "font-size": fitFontSize(
                LABEL_FONT,
                params.label,
                LABEL_MAX_WIDTH,
              ),
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.label,
          },
        ],
      },
    ],
  };
}

export const loadingProgress: SceneComponent = {
  componentId: "loading-progress",
  version: 1,
  validateParams,
  render,
};
