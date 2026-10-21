// P3-B：工作台 3D 镜头模板纯逻辑。Ruling 10：web 不自带烘焙注册表，
// 默认参数常量在 three-templates.ts 内声明；这里的断言即规范化契约
// （orbit3d.validateParams 会补齐且只接受这六个键的全部默认值）。
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSource } from "@acs/video-document";
import {
  buildThreeSceneVersion,
  THREE_TEMPLATE_ID,
  threeSceneFromVersion,
  threeTemplateSelectValue,
} from "./three-templates";

const SPEC_SOURCE: SceneSource = {
  type: "spec",
  spec: {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    durationMs: 12000,
    seed: 1,
    background: "#ffffff",
    params: { title: "云制作" },
  },
};

const MEDIA_SOURCE: SceneSource = {
  type: "media-clip",
  mediaAssetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001",
  inMs: 0,
  outMs: 2000,
  fit: "cover",
  focalX: 0.5,
  audio: "mute",
};

test("模板：buildThreeSceneVersion 的 durationMs 与入参一致", () => {
  const source = buildThreeSceneVersion({ durationMs: 4200, seed: 7 });
  assert.equal(source.type, "three");
  assert.equal(source.spec.durationMs, 4200);
  const other = buildThreeSceneVersion({ durationMs: 300, seed: 0 });
  assert.equal(other.spec.durationMs, 300);
});

test("模板：默认参数为 orbit3d 且通过 validateParams 规范化", () => {
  const source = buildThreeSceneVersion({ durationMs: 3000, seed: 7 });
  assert.equal(source.spec.specVersion, 1);
  assert.equal(source.spec.componentId, "orbit3d");
  assert.equal(source.spec.componentVersion, 1);
  assert.equal(source.spec.seed, 7);
  assert.equal(source.spec.background, "#101820");
  // 六个键齐全（validateParams 的规范化输出；无多余键）
  assert.deepEqual(source.spec.params, {
    shape: "box",
    color: "#4f9dff",
    accent: "#e8b04b",
    spinPerFrame: 0.02,
    tilt: 0.35,
    zoom: 1,
  });
  // 传入 params 时整体替换默认值（不与默认键合并）
  const replaced = buildThreeSceneVersion({
    durationMs: 3000,
    seed: 7,
    params: { shape: "sphere" },
  });
  assert.deepEqual(replaced.spec.params, { shape: "sphere" });
});

test("模板：threeSceneFromVersion 对 spec/media-clip 返回 null", () => {
  assert.equal(threeSceneFromVersion(undefined), null);
  assert.equal(threeSceneFromVersion({ sceneSource: SPEC_SOURCE }), null);
  assert.equal(threeSceneFromVersion({ sceneSource: MEDIA_SOURCE }), null);
  const three = buildThreeSceneVersion({ durationMs: 2000, seed: 7 });
  assert.deepEqual(threeSceneFromVersion({ sceneSource: three }), three.spec);
});

test("模板：threeTemplateSelectValue 在已是 three 且未选模板时停在 THREE_TEMPLATE_ID", () => {
  assert.equal(threeTemplateSelectValue("", true), THREE_TEMPLATE_ID);
  assert.equal(threeTemplateSelectValue("", false), "");
  assert.equal(threeTemplateSelectValue("chart-bar", true), "chart-bar");
  assert.equal(threeTemplateSelectValue("chart-bar", false), "chart-bar");
});
