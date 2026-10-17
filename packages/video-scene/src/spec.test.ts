import assert from "node:assert/strict";
import test from "node:test";
import {
  createRegistry,
  type SceneComponent,
  type SceneRegistry,
} from "./registry.js";
import { MAX_SPEC_BYTES, validateSceneSpec } from "./spec.js";

const stub: SceneComponent = {
  componentId: "stub",
  version: 1,
  validateParams: (value) => {
    if (typeof value !== "object" || value === null)
      throw new Error("stub params 必须是对象");
    return value;
  },
  render: () => ({ tag: "g", attrs: {} }),
};
const registry: SceneRegistry = createRegistry([stub], 1);

function baseSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    componentId: "stub",
    componentVersion: 1,
    durationMs: 12000,
    seed: 1,
    background: "#ffffff",
    params: { title: "云制作" },
  };
}

test("合法 spec 通过并返回 SceneSpec", () => {
  const spec = validateSceneSpec(baseSpec(), registry);
  assert.equal(spec.componentId, "stub");
});
test("未知 componentId 拒绝", () => {
  const v = baseSpec();
  v.componentId = "nope";
  assert.throws(() => validateSceneSpec(v, registry), /nope/);
});
test("未注册的组件版本拒绝", () => {
  const v = baseSpec();
  v.componentVersion = 99;
  assert.throws(() => validateSceneSpec(v, registry), /stub@99/);
});
test("spec JSON 超字节上限拒绝", () => {
  const v = baseSpec();
  v.params = { title: "x".repeat(MAX_SPEC_BYTES) };
  assert.throws(() => validateSceneSpec(v, registry), /字节/);
});
test("background 非 #rrggbb 拒绝", () => {
  const v = baseSpec();
  v.background = "white";
  assert.throws(() => validateSceneSpec(v, registry), /background/);
});
test("seed 非整数拒绝", () => {
  const v = baseSpec();
  v.seed = 1.5;
  assert.throws(() => validateSceneSpec(v, registry), /seed/);
});
test("组件自己的 params 校验会被调用", () => {
  const v = baseSpec();
  v.params = "not-an-object";
  assert.throws(() => validateSceneSpec(v, registry), /stub params/);
});
