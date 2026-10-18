import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 数字滚动组件 v1：大数字 count-up（value × easeOutCubic(t/countMs)，toFixed
// 直拼——不用 toLocaleString，locale 不确定）+ accent 下划线生长 + 底部标题。
// 1000×1000 设计空间嵌套 svg viewBox；render 纯函数，禁墙钟/随机/网络。

type NumberCounterParams = {
  title: string;
  value: number;
  prefix: string;
  suffix: string;
  decimals: number; // 0..2
  countMs: number; // 200..6000
  numberColor: string;
  accentColor: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const NUMBER_MAX_SIZE = 200;
const NUMBER_SAFE_WIDTH = 840;
const UNDERLINE_FULL = 320;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): NumberCounterParams {
  if (!isRecord(value)) throw new Error("number-counter params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("number-counter params.title 必须是 ≤40 个字符");
  }
  if (
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    value.value > MAX_VALUE
  ) {
    throw new Error(`number-counter params.value 必须是 0..${MAX_VALUE} 的数`);
  }
  if (typeof value.prefix !== "string" || value.prefix.length > 6) {
    throw new Error("number-counter params.prefix 必须是 ≤6 个字符");
  }
  if (typeof value.suffix !== "string" || value.suffix.length > 6) {
    throw new Error("number-counter params.suffix 必须是 ≤6 个字符");
  }
  if (
    !Number.isInteger(value.decimals) ||
    (value.decimals as number) < 0 ||
    (value.decimals as number) > 2
  ) {
    throw new Error("number-counter params.decimals 必须是 0..2 的整数");
  }
  if (
    !Number.isInteger(value.countMs) ||
    (value.countMs as number) < 200 ||
    (value.countMs as number) > 6000
  ) {
    throw new Error("number-counter params.countMs 必须是 200..6000 的整数");
  }
  if (!isHexColor(value.numberColor))
    throw new Error("number-counter params.numberColor 必须是 #rrggbb");
  if (!isHexColor(value.accentColor))
    throw new Error("number-counter params.accentColor 必须是 #rrggbb");
  return value as NumberCounterParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as NumberCounterParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.countMs));
  const displayed = (params.value * progress).toFixed(params.decimals);
  const text = `${params.prefix}${displayed}${params.suffix}`;
  const underlineW = UNDERLINE_FULL * progress;

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
              y: 460,
              "font-size": fitFontSize(
                NUMBER_MAX_SIZE,
                text,
                NUMBER_SAFE_WIDTH,
              ),
              fill: params.numberColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text,
          },
          {
            tag: "rect",
            attrs: {
              x: 500 - underlineW / 2,
              y: 560,
              width: underlineW,
              height: 10,
              rx: 5,
              fill: params.accentColor,
            },
          },
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 660,
              "font-size": fitFontSize(44, params.title, 880),
              fill: params.numberColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
        ],
      },
    ],
  };
}

export const numberCounter: SceneComponent = {
  componentId: "number-counter",
  version: 1,
  validateParams,
  render,
};
