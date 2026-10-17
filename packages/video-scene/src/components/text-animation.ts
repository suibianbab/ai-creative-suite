import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";

// 文字动画组件 v1：标题 + 可选副标题，fade-up / scale-in 两种入场。
// 组件契约：render(spec, ctx) 纯函数；时间 tMs = frame/fps*1000；禁墙钟/未播种随机/网络。

type TextAnimationParams = {
  title: string;
  subtitle?: string;
  titleColor: string;
  subtitleColor: string;
  entrance: "fade-up" | "scale-in";
  enterMs: number; // 200..3000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SUBTITLE_DELAY_MS = 400;
// 文本行两侧留白：字号钳制后行宽 ≤ 画布宽 × 该系数。
const TEXT_SAFE_WIDTH = 0.88;

// 估算一行文本的 em 宽：CJK/全角类字符按 1em，其余（拉丁/数字/空格）按 0.6em。
function emWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! >= 0x2e80 ? 1 : 0.6;
  }
  return width;
}

// 字号钳制：base 是按高度推的期望字号；若文本行会超出画布宽（竖版长标题），
// 等比缩到安全宽度内。空文本不渲染字形，直接返回 base。
function fitFontSize(base: number, text: string, canvasWidth: number): number {
  const em = emWidth(text);
  if (em === 0) return base;
  return Math.min(base, (canvasWidth * TEXT_SAFE_WIDTH) / em);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): TextAnimationParams {
  if (!isRecord(value)) throw new Error("text-animation params 必须是对象");
  if (
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 80
  ) {
    throw new Error("text-animation params.title 必须是 1..80 字符");
  }
  if (
    value.subtitle !== undefined &&
    (typeof value.subtitle !== "string" || value.subtitle.length > 80)
  ) {
    throw new Error("text-animation params.subtitle 必须是至多 80 字符");
  }
  if (!isHexColor(value.titleColor))
    throw new Error("text-animation params.titleColor 必须是 #rrggbb");
  if (!isHexColor(value.subtitleColor))
    throw new Error("text-animation params.subtitleColor 必须是 #rrggbb");
  if (value.entrance !== "fade-up" && value.entrance !== "scale-in") {
    throw new Error(
      'text-animation params.entrance 必须是 "fade-up" | "scale-in"',
    );
  }
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 3000
  ) {
    throw new Error("text-animation params.enterMs 必须是 200..3000 的整数");
  }
  return value as TextAnimationParams;
}

function entranceTransform(
  entrance: TextAnimationParams["entrance"],
  progress: number,
  height: number,
  cx: number,
  cy: number,
): string {
  if (entrance === "fade-up") {
    // translateY 40→0px，按 height/720 等比缩放
    const offsetPx = 40 * (1 - progress) * (height / 720);
    return `translate(0 ${offsetPx.toFixed(3)})`;
  }
  // scale-in：绕文本中心 0.8→1
  const s = 0.8 + 0.2 * progress;
  return `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as TextAnimationParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const titleProgress = easeOutCubic(clamp01(tMs / params.enterMs));
  const subtitleProgress = easeOutCubic(
    clamp01((tMs - SUBTITLE_DELAY_MS) / params.enterMs),
  );
  // 字号按高度推，再按文本行宽钳制（竖版画布 height 大 width 小，长标题会横向溢出裁切）
  const titleSize = fitFontSize(ctx.height / 8, params.title, ctx.width);
  const subtitleSize = fitFontSize(
    ctx.height / 14,
    params.subtitle ?? "",
    ctx.width,
  );
  const titleY = ctx.height / 2;
  const subtitleY = ctx.height / 2 + titleSize * 0.9;

  const texts: SvgNode[] = [
    {
      tag: "text",
      attrs: {
        x: ctx.width / 2,
        y: titleY,
        "font-size": titleSize,
        fill: params.titleColor,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        opacity: titleProgress,
        transform: entranceTransform(
          params.entrance,
          titleProgress,
          ctx.height,
          ctx.width / 2,
          titleY,
        ),
      },
      text: params.title,
    },
  ];
  if (params.subtitle) {
    texts.push({
      tag: "text",
      attrs: {
        x: ctx.width / 2,
        y: subtitleY,
        "font-size": subtitleSize,
        fill: params.subtitleColor,
        "text-anchor": "middle",
        opacity: subtitleProgress,
        transform: entranceTransform(
          params.entrance,
          subtitleProgress,
          ctx.height,
          ctx.width / 2,
          subtitleY,
        ),
      },
      text: params.subtitle,
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
      ...texts,
    ],
  };
}

export const textAnimation: SceneComponent = {
  componentId: "text-animation",
  version: 1,
  validateParams,
  render,
};
