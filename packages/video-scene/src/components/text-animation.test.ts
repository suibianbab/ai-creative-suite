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

test("竖版画布长标题/副标题字号钳制到画布宽内，横版字号不变", () => {
  // 审片发现的缺陷：字号只按 height 推，720×1280 竖版下 6 字标题
  // 160px×6=960px > 720px 画布宽，左右双侧裁切。
  const spec = specWith({
    ...BASE,
    subtitle: "Video Studio P0",
    title: "云制造发布会",
  });
  const portrait = makeCtx({ width: 720, height: 1280, durationFrames: 288 });
  const title = requireText(
    textAnimation.render(spec, portrait),
    "云制造发布会",
  );
  const titleSize = title.attrs["font-size"] as number;
  assert.ok(
    titleSize * 6 <= 720 * 0.9,
    `竖版标题 6 字 × ${titleSize}px 超出画布：${titleSize * 6} > ${720 * 0.9}`,
  );
  assert.ok(titleSize < 160, "钳制未生效：字号仍为未钳制的 height/8=160");
  const subtitle = requireText(
    textAnimation.render(spec, portrait),
    "Video Studio P0",
  );
  const subtitleSize = subtitle.attrs["font-size"] as number;
  assert.ok(
    subtitleSize * 9 <= 720, // ASCII ≈ 0.6em/字符 × 15 字符 = 9em
    `竖版副标题宽 ${subtitleSize * 9} > 720`,
  );
  // 横版（clamp 富余）保持原字号：height/8=90、height/14≈91.4
  const landscape = makeCtx();
  assert.equal(
    requireText(textAnimation.render(spec, landscape), "云制造发布会").attrs[
      "font-size"
    ],
    90,
  );
  assert.equal(
    requireText(textAnimation.render(spec, landscape), "Video Studio P0").attrs[
      "font-size"
    ],
    720 / 14,
  );
});

test("竖版较长双行标题保持竖向留白，不发生标题与副标题重叠", () => {
  const spec = specWith({
    ...BASE,
    title: "STEM 自定义标题",
    subtitle: "看见一滴水的循环",
  });
  const portrait = makeCtx({ width: 720, height: 1280, durationFrames: 216 });
  const rendered = textAnimation.render(spec, portrait);
  const title = requireText(rendered, "STEM 自定义标题");
  const subtitle = requireText(rendered, "看见一滴水的循环");
  const centerDistance =
    (subtitle.attrs.y as number) - (title.attrs.y as number);
  const halfHeights =
    ((title.attrs["font-size"] as number) +
      (subtitle.attrs["font-size"] as number)) /
    2;
  assert.equal(subtitle.attrs["dominant-baseline"], "middle");
  assert.ok(centerDistance - halfHeights >= 20);
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
