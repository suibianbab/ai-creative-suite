import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";

// 基础图形组件 v1：矩形/圆/三角按归一化包围盒布局，逐形状 opacity·scale 入场。
// 组件契约：render(spec, ctx) 纯函数；禁墙钟/未播种随机/网络。

type ShapeKind = "rect" | "circle" | "triangle";

type ShapeParams = {
  kind: ShapeKind;
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  color: string;
  delayMs: number; // 0..60000
  enterMs: number; // 200..3000
};

type BasicShapesParams = { shapes: ShapeParams[] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SHAPES = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateUnit(value: unknown, field: string): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`basic-shapes shapes.${field} 必须是 0..1 的数`);
  }
}

function validateParams(value: unknown): BasicShapesParams {
  if (!isRecord(value)) throw new Error("basic-shapes params 必须是对象");
  if (
    !Array.isArray(value.shapes) ||
    value.shapes.length < 1 ||
    value.shapes.length > MAX_SHAPES
  ) {
    throw new Error(
      `basic-shapes params.shapes 必须是 1..${MAX_SHAPES} 个形状`,
    );
  }
  for (const [index, shape] of value.shapes.entries()) {
    const field = `shapes[${index}]`;
    if (!isRecord(shape)) throw new Error(`basic-shapes ${field} 必须是对象`);
    if (
      shape.kind !== "rect" &&
      shape.kind !== "circle" &&
      shape.kind !== "triangle"
    ) {
      throw new Error(
        `basic-shapes ${field}.kind 必须是 "rect" | "circle" | "triangle"`,
      );
    }
    for (const key of ["x", "y", "w", "h"] as const)
      validateUnit(shape[key], key);
    if (typeof shape.color !== "string" || !HEX_COLOR.test(shape.color)) {
      throw new Error(`basic-shapes ${field}.color 必须是 #rrggbb`);
    }
    if (
      !Number.isInteger(shape.delayMs) ||
      (shape.delayMs as number) < 0 ||
      (shape.delayMs as number) > 60000
    ) {
      throw new Error(`basic-shapes ${field}.delayMs 必须是 0..60000 的整数`);
    }
    if (
      !Number.isInteger(shape.enterMs) ||
      (shape.enterMs as number) < 200 ||
      (shape.enterMs as number) > 3000
    ) {
      throw new Error(`basic-shapes ${field}.enterMs 必须是 200..3000 的整数`);
    }
  }
  return value as BasicShapesParams;
}

function shapeNode(shape: ShapeParams, ctx: FrameContext): SvgNode {
  const px = shape.x * ctx.width;
  const py = shape.y * ctx.height;
  const pw = shape.w * ctx.width;
  const ph = shape.h * ctx.height;
  if (shape.kind === "rect") {
    return {
      tag: "rect",
      attrs: { x: px, y: py, width: pw, height: ph, fill: shape.color },
    };
  }
  if (shape.kind === "circle") {
    return {
      tag: "circle",
      attrs: {
        cx: px + pw / 2,
        cy: py + ph / 2,
        r: Math.min(pw, ph) / 2,
        fill: shape.color,
      },
    };
  }
  const apex = `${px + pw / 2},${py}`;
  const baseLeft = `${px},${py + ph}`;
  const baseRight = `${px + pw},${py + ph}`;
  return {
    tag: "polygon",
    attrs: { points: `${apex} ${baseLeft} ${baseRight}`, fill: shape.color },
  };
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as BasicShapesParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const shapeNodes: SvgNode[] = params.shapes.map((shape) => {
    const progress = easeOutCubic(
      clamp01((tMs - shape.delayMs) / shape.enterMs),
    );
    const node = shapeNode(shape, ctx);
    const attrs = { ...node.attrs, opacity: progress };
    if (progress <= 0) return { ...node, attrs }; // 入场前完全不可见，不做 scale 变换
    // opacity·scale 入场：绕形状中心 0.8→1
    const cx = shape.x * ctx.width + (shape.w * ctx.width) / 2;
    const cy = shape.y * ctx.height + (shape.h * ctx.height) / 2;
    const s = 0.8 + 0.2 * progress;
    return {
      tag: "g",
      attrs: {
        transform: `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`,
      },
      children: [{ ...node, attrs }],
    };
  });
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
      ...shapeNodes,
    ],
  };
}

export const basicShapes: SceneComponent = {
  componentId: "basic-shapes",
  version: 1,
  validateParams,
  render,
};
