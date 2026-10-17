import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { lineDrawing } from "./line-drawing.js";

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
    componentId: "line-drawing",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  paths: ["M 100 100 L 900 900", "M 900 100 L 100 900"],
  strokeColor: "#222222",
  strokeWidth: 6,
  revealMs: 2000,
};

function findPaths(node: SvgNode): SvgNode[] {
  if (node.tag === "path") return [node];
  return (node.children ?? []).flatMap(findPaths);
}

test("t=0 时 dashoffset=1（未画），t≥revealMs 时 dashoffset=0（画完）", () => {
  const spec = specWith({ ...BASE });
  const start = findPaths(lineDrawing.render(spec, makeCtx({ frame: 0 })))[0]!;
  const done = findPaths(
    lineDrawing.render(spec, makeCtx({ frame: 24 * 3 })),
  )[0]!;
  assert.equal(start.attrs["stroke-dashoffset"], 1);
  assert.equal(done.attrs["stroke-dashoffset"], 0);
});

test("dashoffset 随帧单调不增（缓动后仍单调）", () => {
  const spec = specWith({ ...BASE });
  const offsets = Array.from(
    { length: 49 },
    (_, frame) =>
      findPaths(lineDrawing.render(spec, makeCtx({ frame })))[0]!.attrs[
        "stroke-dashoffset"
      ] as number,
  );
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(
      offsets[i]! <= offsets[i - 1]!,
      `frame ${i}: ${offsets[i]} > ${offsets[i - 1]}`,
    );
  }
});

test("每条 path 带 pathLength=1 与 dasharray=1（路径长度归一化）", () => {
  const paths = findPaths(
    lineDrawing.render(specWith({ ...BASE }), makeCtx({ frame: 12 })),
  );
  assert.equal(paths.length, 2);
  for (const p of paths) {
    assert.equal(p.attrs.pathLength, 1);
    assert.equal(p.attrs["stroke-dasharray"], 1);
  }
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    lineDrawing.render(spec, makeCtx({ frame: 12 })),
    lineDrawing.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：空 paths / 超过 8 条 / strokeWidth 越界 / revealMs 越界 / 非法颜色拒绝", () => {
  assert.throws(
    () => lineDrawing.validateParams({ ...BASE, paths: [] }),
    /paths/,
  );
  assert.throws(
    () =>
      lineDrawing.validateParams({
        ...BASE,
        paths: Array.from({ length: 9 }, () => "M 0 0"),
      }),
    /paths/,
  );
  assert.throws(
    () => lineDrawing.validateParams({ ...BASE, strokeWidth: 0 }),
    /strokeWidth/,
  );
  assert.throws(
    () => lineDrawing.validateParams({ ...BASE, revealMs: 100 }),
    /revealMs/,
  );
  assert.throws(
    () => lineDrawing.validateParams({ ...BASE, revealMs: 20000 }),
    /revealMs/,
  );
  assert.throws(
    () => lineDrawing.validateParams({ ...BASE, strokeColor: "blue" }),
    /strokeColor/,
  );
});
