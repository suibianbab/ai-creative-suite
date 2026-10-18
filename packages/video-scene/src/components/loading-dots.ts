import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 加载等待 v1：闭式相位弹跳——点 i 相位 ((tMs/cycleMs)+i/N)%1，正半周跳起
// （lift = max(0, sin(2π·phase))，cy = BASE_Y − AMP·lift），负半周贴地休息；不
// 透明度 0.35..1 随同一 lift 联动。循环动画，任意帧非空。render 纯函数：
// 禁墙钟/未播种随机/网络。

type LoadingDotsParams = {
  title: string;
  label: string;
  dots: number; // 3..6
  inkColor: string;
  accentColor: string;
  cycleMs: number; // 400..2000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const TITLE_FADE_MS = 300;
const DOT_R = 28;
const DOT_PITCH = 92; // 2·DOT_R + GAP 36
const BASE_Y = 520;
const AMP = 90;
const REST_OPACITY = 0.35;
const LABEL_FONT = 36;
const LABEL_MAX_WIDTH = 600;
const LABEL_Y = 700;
const MIN_DOTS = 3;
const MAX_DOTS = 6;
const MAX_LABEL = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): LoadingDotsParams {
  if (!isRecord(value)) throw new Error("loading-dots params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("loading-dots params.title 必须是 ≤40 个字符");
  }
  // 与 render 同口径：按码点计数（emoji 不劈半）
  const labelChars =
    typeof value.label === "string" ? Array.from(value.label) : [];
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    throw new Error(`loading-dots params.label 必须是 1..${MAX_LABEL} 个字符`);
  }
  if (
    !Number.isInteger(value.dots) ||
    (value.dots as number) < MIN_DOTS ||
    (value.dots as number) > MAX_DOTS
  ) {
    throw new Error(
      `loading-dots params.dots 必须是 ${MIN_DOTS}..${MAX_DOTS} 的整数`,
    );
  }
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`loading-dots params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.cycleMs) ||
    (value.cycleMs as number) < 400 ||
    (value.cycleMs as number) > 2000
  ) {
    throw new Error("loading-dots params.cycleMs 必须是 400..2000 的整数");
  }
  return value as LoadingDotsParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LoadingDotsParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const n = params.dots;
  const totalWidth = 2 * DOT_R + (n - 1) * DOT_PITCH;
  const left = 500 - totalWidth / 2;
  const dotNodes: SvgNode[] = [];
  for (let i = 0; i < n; i += 1) {
    const phase = (tMs / params.cycleMs + i / n) % 1;
    const lift = Math.max(0, Math.sin(2 * Math.PI * phase));
    dotNodes.push({
      tag: "circle",
      attrs: {
        cx: left + DOT_R + i * DOT_PITCH,
        cy: BASE_Y - AMP * lift,
        r: DOT_R,
        fill: params.accentColor,
        opacity: Number((REST_OPACITY + (1 - REST_OPACITY) * lift).toFixed(4)),
      },
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
          ...dotNodes,
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

export const loadingDots: SceneComponent = {
  componentId: "loading-dots",
  version: 1,
  validateParams,
  render,
};
