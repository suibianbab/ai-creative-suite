import assert from "node:assert/strict";
import test from "node:test";
import { layoutFor } from "./aspect-layout.js";
import {
  createRegistry,
  type SceneComponent,
  type SceneRegistry,
  type SceneSpecLike,
} from "./registry.js";
import { validateSceneSpec } from "./spec.js";

// 双画幅版式覆写契约（2026-10-23 brief §三B）：layout 是 SceneSpec 顶层
// 可选字段，缺省 = 自动布局（旧项目零变化）；存在时必须至少覆盖一个画幅，
// 且由组件自己的 validateLayout 逐画幅深度校验——不支持的组件明确拒绝。

const withLayout: SceneComponent = {
  componentId: "with-layout",
  version: 1,
  validateParams: (value) => {
    if (typeof value !== "object" || value === null)
      throw new Error("params 必须是对象");
    return value;
  },
  validateLayout: (aspectValue, params) => {
    if (typeof aspectValue !== "object" || aspectValue === null)
      throw new Error("layout 覆写必须是对象");
    if ("title" in (aspectValue as Record<string, unknown>))
      throw new Error("layout 不认识 title");
    if (typeof params !== "object") throw new Error("params 传导");
  },
  render: () => ({ tag: "g", attrs: {} }),
};
const withoutLayout: SceneComponent = {
  componentId: "without-layout",
  version: 1,
  validateParams: (value) => value,
  render: () => ({ tag: "g", attrs: {} }),
};
const registry: SceneRegistry = createRegistry([withLayout, withoutLayout], 1);

function baseSpec(): SceneSpecLike & { specVersion: 1 } {
  return {
    specVersion: 1,
    componentId: "with-layout",
    componentVersion: 1,
    durationMs: 12000,
    seed: 1,
    background: "#ffffff",
    params: { title: "云制作" },
  };
}

function ctxOf(width: number, height: number) {
  return {
    frame: 0,
    fps: 24,
    durationFrames: 288,
    width,
    height,
    random: () => 0,
  };
}

test("无 layout 的旧 spec 校验通过，layoutFor 返回 undefined", () => {
  const spec = validateSceneSpec(baseSpec(), registry);
  assert.equal("layout" in spec, false);
  assert.equal(layoutFor(spec, ctxOf(720, 1280)), undefined);
  assert.equal(layoutFor(spec, ctxOf(1280, 720)), undefined);
});

test("仅 portrait / 仅 landscape / 双画幅的合法容器通过校验", () => {
  for (const layout of [
    { portrait: { scale: 1 } },
    { landscape: { scale: 1 } },
    { portrait: { scale: 1 }, landscape: { scale: 0.9 } },
  ]) {
    const spec = { ...baseSpec(), layout };
    assert.equal(validateSceneSpec(spec, registry).layout, layout);
  }
});

test("空容器（两画幅全缺）拒绝", () => {
  assert.throws(
    () => validateSceneSpec({ ...baseSpec(), layout: {} }, registry),
    /至少覆盖一个画幅/,
  );
});

test("layout 非对象 / 画幅值非对象拒绝", () => {
  assert.throws(
    () => validateSceneSpec({ ...baseSpec(), layout: 42 }, registry),
    /layout 必须是对象/,
  );
  assert.throws(
    () =>
      validateSceneSpec({ ...baseSpec(), layout: { portrait: "x" } }, registry),
    /portrait 必须是对象/,
  );
});

test("组件未实现 validateLayout 时明确拒绝，不静默忽略", () => {
  assert.throws(
    () =>
      validateSceneSpec(
        {
          ...baseSpec(),
          componentId: "without-layout",
          layout: { portrait: { scale: 1 } },
        },
        registry,
      ),
    /without-layout@1 不支持 layout 覆写/,
  );
});

test("组件 validateLayout 抛错原样传播；非对象画幅值在容器层拦截", () => {
  assert.throws(
    () =>
      validateSceneSpec(
        { ...baseSpec(), layout: { portrait: { title: "x" } } },
        registry,
      ),
    /layout 不认识 title/,
  );
  // 非对象画幅值由容器层统一拒绝（组件只见对象形状的覆写）。
  assert.throws(
    () =>
      validateSceneSpec({ ...baseSpec(), layout: { landscape: 3 } }, registry),
    /layout\.landscape 必须是对象/,
  );
});

test("layoutFor：竖版取 portrait、横版取 landscape，缺省为 undefined", () => {
  const spec = {
    ...baseSpec(),
    layout: { portrait: { scale: 1 }, landscape: { scale: 0.9 } },
  };
  const portrait = layoutFor(spec, ctxOf(720, 1280)) as { scale: number };
  const landscape = layoutFor(spec, ctxOf(1280, 720)) as { scale: number };
  assert.equal(portrait.scale, 1);
  assert.equal(landscape.scale, 0.9);
  const onlyPortrait = { ...baseSpec(), layout: { portrait: { scale: 2 } } };
  assert.equal(
    layoutFor(onlyPortrait, ctxOf(1280, 720)),
    undefined,
    "横版无覆写 → 自动布局",
  );
  assert.deepEqual(layoutFor(onlyPortrait, ctxOf(720, 1280)), { scale: 2 });
});
