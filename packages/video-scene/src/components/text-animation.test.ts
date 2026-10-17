import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { textAnimation } from "./text-animation.js";

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
    componentId: "text-animation",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

function findText(node: SvgNode, text: string): SvgNode | null {
  if (node.text === text) return node;
  for (const child of node.children ?? []) {
    const found = findText(child, text);
    if (found) return found;
  }
  return null;
}

function requireText(node: SvgNode, text: string): SvgNode {
  const found = findText(node, text);
  if (!found) throw new Error(`未找到文本节点：${text}`);
  return found;
}

const BASE = {
  title: "云制作",
  titleColor: "#111111",
  subtitleColor: "#666666",
  entrance: "fade-up",
  enterMs: 800,
};

test("标题 0 帧时不可见（入场前），第 1 秒完全可见", () => {
  const spec = specWith({ ...BASE });
  const ctx0 = makeCtx({ frame: 0 });
  const ctx24 = makeCtx({ frame: 24 });
  assert.equal(
    requireText(textAnimation.render(spec, ctx0), "云制作").attrs.opacity,
    0,
  );
  assert.equal(
    requireText(textAnimation.render(spec, ctx24), "云制作").attrs.opacity,
    1,
  );
});

test("副标题延迟 400ms：第 10 帧（~417ms）仍未完成入场，第 40 帧完成", () => {
  const spec = specWith({ ...BASE, subtitle: "Video Studio" });
  const early = requireText(
    textAnimation.render(spec, makeCtx({ frame: 10 })),
    "Video Studio",
  );
  const done = requireText(
    textAnimation.render(spec, makeCtx({ frame: 40 })),
    "Video Studio",
  );
  assert.ok(
    (early.attrs.opacity as number) > 0 && (early.attrs.opacity as number) < 1,
  );
  assert.equal(done.attrs.opacity, 1);
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE, subtitle: "副标题" });
  assert.deepEqual(
    textAnimation.render(spec, makeCtx({ frame: 12 })),
    textAnimation.render(spec, makeCtx({ frame: 12 })),
  );
});

test("标题字号 = height/8、水平居中锚点", () => {
  const node = requireText(
    textAnimation.render(specWith({ ...BASE }), makeCtx()),
    "云制作",
  );
  assert.equal(node.attrs["font-size"], 90); // 720/8
  assert.equal(node.attrs["text-anchor"], "middle");
  assert.equal(node.attrs.x, 640); // width/2
});

test("params 校验：未知 entrance / 空 title / 非法颜色 / enterMs 越界均拒绝", () => {
  assert.throws(
    () => textAnimation.validateParams({ ...BASE, entrance: "spin" }),
    /entrance/,
  );
  assert.throws(
    () => textAnimation.validateParams({ ...BASE, title: "" }),
    /title/,
  );
  assert.throws(
    () => textAnimation.validateParams({ ...BASE, titleColor: "red" }),
    /titleColor/,
  );
  assert.throws(
    () => textAnimation.validateParams({ ...BASE, enterMs: 100 }),
    /enterMs/,
  );
  assert.throws(
    () => textAnimation.validateParams({ ...BASE, enterMs: 9999 }),
    /enterMs/,
  );
});
