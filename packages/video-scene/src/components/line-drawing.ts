import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";

// 线描组件 v1：多条 SVG path 依次显现（pathLength=1 归一化 + dashoffset 揭示）。
// 路径在 1000×1000 设计空间内表达；渲染经嵌套 svg viewBox 等比居中（横竖版同 spec）。
// 组件契约：render(spec, ctx) 纯函数；禁墙钟/未播种随机/网络。

type LineDrawingParams = {
  paths: string[];
  strokeColor: string;
  strokeWidth: number; // 1..20
  revealMs: number; // 500..10000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const MAX_PATHS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateParams(value: unknown): LineDrawingParams {
  if (!isRecord(value)) throw new Error("line-drawing params 必须是对象");
  if (
    !Array.isArray(value.paths) ||
    value.paths.length < 1 ||
    value.paths.length > MAX_PATHS ||
    value.paths.some(
      (p) => typeof p !== "string" || p.length < 2 || p.length > 2000,
    )
  ) {
    throw new Error(
      `line-drawing params.paths 必须是 ${1}..${MAX_PATHS} 条非空 path d 字符串`,
    );
  }
  if (
    typeof value.strokeColor !== "string" ||
    !HEX_COLOR.test(value.strokeColor)
  ) {
    throw new Error("line-drawing params.strokeColor 必须是 #rrggbb");
  }
  if (
    !Number.isInteger(value.strokeWidth) ||
    (value.strokeWidth as number) < 1 ||
    (value.strokeWidth as number) > 20
  ) {
    throw new Error("line-drawing params.strokeWidth 必须是 1..20 的整数");
  }
  if (
    !Number.isInteger(value.revealMs) ||
    (value.revealMs as number) < 500 ||
    (value.revealMs as number) > 10000
  ) {
    throw new Error("line-drawing params.revealMs 必须是 500..10000 的整数");
  }
  return value as LineDrawingParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as LineDrawingParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const progress = easeOutCubic(clamp01(tMs / params.revealMs));
  const dashoffset = 1 - progress;
  const paths: SvgNode[] = params.paths.map((d) => ({
    tag: "path",
    attrs: {
      d,
      fill: "none",
      stroke: params.strokeColor,
      "stroke-width": params.strokeWidth,
      pathLength: 1,
      "stroke-dasharray": 1,
      "stroke-dashoffset": dashoffset,
      "stroke-linecap": "round",
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
        children: paths,
      },
    ],
  };
}

export const lineDrawing: SceneComponent = {
  componentId: "line-drawing",
  version: 1,
  validateParams,
  render,
};
