import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { basicShapes } from "./basic-shapes.js";

function makeCtx(over: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 0,
    fps: 24,
    durationFrames: 288,
    width: 1280,
    height: 720,
    random: seededRandom(1),
    ...over,
  };
}

function specWith(params: Record<string, unknown>): SceneSpec {
  return {
    specVersion: 1,
    componentId: "basic-shapes",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const SHAPE = {
  kind: "rect",
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.4,
  color: "#3366cc",
  delayMs: 0,
  enterMs: 500,
};
const BASE = { shapes: [SHAPE] };

function findTags(node: SvgNode, tag: string): SvgNode[] {
  const found: SvgNode[] = [];
  const walk = (n: SvgNode): void => {
    if (n.tag === tag) found.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

// 背景也是 rect，按形状颜色过滤出被测的 rect
function findShapeRects(node: SvgNode): SvgNode[] {
  return findTags(node, "rect").filter((r) => r.attrs.fill === SHAPE.color);
}

test("delayMs 前 opacity=0，入场完成后 opacity=1", () => {
  const spec = specWith({
    shapes: [{ ...SHAPE, delayMs: 1000, enterMs: 500 }],
  });
  const before = findShapeRects(
    basicShapes.render(spec, makeCtx({ frame: 12 })),
  )[0]!;
  const after = findShapeRects(
    basicShapes.render(spec, makeCtx({ frame: 24 * 3 })),
  )[0]!;
  assert.equal(before.attrs.opacity, 0);
  assert.equal(after.attrs.opacity, 1);
});

test("rect 归一化坐标映射到画布像素", () => {
  const rect = findShapeRects(
    basicShapes.render(specWith(BASE), makeCtx()),
  )[0]!;
  assert.equal(rect.attrs.x, 128); // 0.1 × 1280
  assert.equal(rect.attrs.y, 144); // 0.2 × 720
  assert.equal(rect.attrs.width, 384); // 0.3 × 1280
  assert.equal(rect.attrs.height, 288); // 0.4 × 720
});

test("circle 中心与半径按包围盒计算", () => {
  const spec = specWith({
    shapes: [{ ...SHAPE, kind: "circle", x: 0, y: 0, w: 0.5, h: 0.5 }],
  });
  const circle = findTags(basicShapes.render(spec, makeCtx()), "circle")[0]!;
  assert.equal(circle.attrs.cx, 320); // (0 + 0.25) × 1280
  assert.equal(circle.attrs.cy, 180); // (0 + 0.25) × 720
  assert.equal(circle.attrs.r, 180); // min(640, 360) / 2
});

test("triangle 顶点：顶在包围盒顶边中点、底两角", () => {
  const spec = specWith({ shapes: [{ ...SHAPE, kind: "triangle" }] });
  const polygon = findTags(basicShapes.render(spec, makeCtx()), "polygon")[0]!;
  // 顶 (0.25×1280, 0.2×720)=(320,144)；底左 (128,432)；底右 (512,432)
  assert.equal(polygon.attrs.points, "320,144 128,432 512,432");
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({
    shapes: [SHAPE, { ...SHAPE, kind: "circle", delayMs: 300 }],
  });
  assert.deepEqual(
    basicShapes.render(spec, makeCtx({ frame: 12 })),
    basicShapes.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：越界坐标 / 超过 24 个形状 / 未知 kind / 非法颜色拒绝", () => {
  assert.throws(
    () => basicShapes.validateParams({ shapes: [{ ...SHAPE, x: -0.1 }] }),
    /x/,
  );
  assert.throws(
    () => basicShapes.validateParams({ shapes: [{ ...SHAPE, w: 1.5 }] }),
    /w/,
  );
  assert.throws(
    () =>
      basicShapes.validateParams({
        shapes: Array.from({ length: 25 }, () => SHAPE),
      }),
    /shapes/,
  );
  assert.throws(
    () => basicShapes.validateParams({ shapes: [{ ...SHAPE, kind: "star" }] }),
    /kind/,
  );
  assert.throws(
    () => basicShapes.validateParams({ shapes: [{ ...SHAPE, color: "red" }] }),
    /color/,
  );
  assert.throws(
    () => basicShapes.validateParams({ shapes: [{ ...SHAPE, enterMs: 10 }] }),
    /enterMs/,
  );
});
