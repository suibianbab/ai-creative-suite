// 3D 注册表与 orbit3d 组件测试：node --test scripts/video/three-registry.test.mjs
// 依赖 three（Node 侧）：把 THREE 命名空间显式传给 createRig，组件模块自身不 import three。
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import * as orbit3d from "./three/components/orbit3d.mjs";
import {
  createThreeRegistry,
  threeRegistry,
  UnknownThreeComponentError,
} from "./three/registry.mjs";
import { validateThreeSpec } from "./three/spec.mjs";

const FULL_SPEC = {
  specVersion: 1,
  componentId: "orbit3d",
  componentVersion: 1,
  durationMs: 4000,
  seed: 7,
  background: "#101820",
  params: {},
};

test("注册表：重复注册同 componentId@version 抛错", () => {
  const registry = createThreeRegistry([orbit3d]);
  assert.throws(
    () => registry.register(orbit3d),
    (error) =>
      error instanceof Error &&
      !(error instanceof UnknownThreeComponentError) &&
      /orbit3d@1/.test(error.message) &&
      /重复|已注册/.test(error.message),
  );
});

test("注册表：未知组件抛 UnknownThreeComponentError 且带 id/version", () => {
  const registry = createThreeRegistry([orbit3d]);
  assert.deepEqual(registry.list(), ["orbit3d@1"]);
  assert.equal(registry.version, 1);
  assert.equal(registry.get("orbit3d", 1), orbit3d);

  assert.throws(
    () => registry.get("ghost", 9),
    (error) => {
      assert.ok(error instanceof UnknownThreeComponentError);
      assert.equal(error.componentId, "ghost");
      assert.equal(error.componentVersion, 9);
      assert.match(error.message, /ghost@9/);
      return true;
    },
  );
});

test("orbit3d：validateParams 填默认值且拒绝未知键", () => {
  assert.deepEqual(orbit3d.validateParams({}), {
    shape: "box",
    color: "#4f9dff",
    accent: "#e8b04b",
    spinPerFrame: 0.02,
    tilt: 0.35,
    zoom: 1,
  });

  assert.throws(
    () => orbit3d.validateParams({ bounce: 1 }),
    (error) => /未知参数/.test(error.message) && /bounce/.test(error.message),
  );
});

test("orbit3d：shape/颜色/spinPerFrame/tilt/zoom 越界逐个拒绝", () => {
  // 枚举与颜色格式
  assert.throws(() => orbit3d.validateParams({ shape: "pyramid" }), /shape/);
  assert.throws(() => orbit3d.validateParams({ color: "red" }), /color/);
  assert.throws(() => orbit3d.validateParams({ color: "#12345" }), /color/);
  assert.throws(() => orbit3d.validateParams({ accent: "#GGGGGG" }), /accent/);

  // 数值范围越界
  assert.throws(
    () => orbit3d.validateParams({ spinPerFrame: -0.01 }),
    /spinPerFrame/,
  );
  assert.throws(
    () => orbit3d.validateParams({ spinPerFrame: 0.5001 }),
    /spinPerFrame/,
  );
  assert.throws(() => orbit3d.validateParams({ tilt: -0.1 }), /tilt/);
  assert.throws(() => orbit3d.validateParams({ tilt: 1.6 }), /tilt/);
  assert.throws(() => orbit3d.validateParams({ zoom: 0.49 }), /zoom/);
  assert.throws(() => orbit3d.validateParams({ zoom: 2.01 }), /zoom/);
  assert.throws(() => orbit3d.validateParams({ zoom: "1" }), /zoom/);

  // 数值范围含端点
  assert.equal(orbit3d.validateParams({ spinPerFrame: 0 }).spinPerFrame, 0);
  assert.equal(orbit3d.validateParams({ spinPerFrame: 0.5 }).spinPerFrame, 0.5);
  assert.equal(orbit3d.validateParams({ tilt: 0 }).tilt, 0);
  assert.equal(orbit3d.validateParams({ tilt: 1.5 }).tilt, 1.5);
  assert.equal(orbit3d.validateParams({ zoom: 0.5 }).zoom, 0.5);
  assert.equal(orbit3d.validateParams({ zoom: 2 }).zoom, 2);
});

test("orbit3d：createRig + pose 的旋转角只由帧号决定", () => {
  const params = orbit3d.validateParams({});
  const rig = orbit3d.orbit3dV2.createRig({
    THREE,
    params,
    width: 1280,
    height: 720,
    background: "#101820",
  });

  assert.ok(rig.scene.isScene);
  assert.equal(rig.camera.type, "OrthographicCamera");
  assert.equal(rig.mesh.rotation.x, params.tilt);

  orbit3d.pose(rig, 0, { fps: 24, durationFrames: 96 });
  assert.equal(rig.mesh.rotation.y, 0);

  orbit3d.pose(rig, 100, { fps: 24, durationFrames: 96 });
  assert.equal(rig.mesh.rotation.y, 2); // 100 * 0.02

  // 同一帧号换 fps/时长，角度不变：旋转不读时钟
  orbit3d.pose(rig, 100, { fps: 30, durationFrames: 60 });
  assert.equal(rig.mesh.rotation.y, 2);

  // 规格 §6 要求覆盖帧 0/帧 100 的旋转角、几何类型与颜色：颜色由参数决定，
  // 主体取 params.color，参照轴取 params.accent（orbit3d 用 normalized.accent
  // 构建它）。这是刻画既有行为的测试，不打补丁。
  assert.equal(
    rig.mesh.material.color.getHexString(),
    new THREE.Color(params.color).getHexString(),
    "主体颜色来自 params.color",
  );
  const axis = rig.scene.children.find(
    (child) => child.isMesh && child !== rig.mesh,
  );
  assert.ok(axis, "场景里必须有参照轴 Mesh");
  assert.equal(
    axis.material.color.getHexString(),
    new THREE.Color(params.accent).getHexString(),
    "参照轴颜色来自 params.accent",
  );

  // 上面的 params 是默认值，若 createRig 忽视入参写死默认色也照样通过；
  // 换一组显式非默认色才能证明颜色确实来自 params。
  const custom = orbit3d.validateParams({
    color: "#112233",
    accent: "#445566",
  });
  const customRig = orbit3d.orbit3dV2.createRig({
    THREE,
    params: custom,
    width: 1280,
    height: 720,
    background: "#101820",
  });
  assert.equal(customRig.mesh.material.color.getHexString(), "112233");
  const customAxis = customRig.scene.children.find(
    (child) => child.isMesh && child !== customRig.mesh,
  );
  assert.ok(customAxis, "自定义场景同样必须有参照轴 Mesh");
  assert.equal(customAxis.material.color.getHexString(), "445566");
});

test("orbit3d：createRig 的几何随 shape 变化", () => {
  const expected = {
    box: "BoxGeometry",
    sphere: "SphereGeometry",
    torus: "TorusGeometry",
    icosahedron: "IcosahedronGeometry",
  };
  for (const [shape, geometryType] of Object.entries(expected)) {
    const rig = orbit3d.orbit3dV2.createRig({
      THREE,
      params: orbit3d.validateParams({ shape }),
      width: 1280,
      height: 720,
      background: "#101820",
    });
    assert.equal(rig.mesh.geometry.type, geometryType, `shape=${shape}`);
  }
});

test("validateThreeSpec：未注册组件被拒且信息含 id@version", () => {
  assert.throws(
    () =>
      validateThreeSpec(
        { ...FULL_SPEC, componentId: "ghost", componentVersion: 7 },
        threeRegistry,
      ),
    (error) => {
      assert.ok(error instanceof UnknownThreeComponentError);
      assert.match(error.message, /ghost@7/);
      return true;
    },
  );
});

test("validateThreeSpec：params 越界由组件拒绝", () => {
  assert.throws(
    () =>
      validateThreeSpec({ ...FULL_SPEC, params: { zoom: 5 } }, threeRegistry),
    /zoom/,
  );
});

test("validateThreeSpec：返回规范化 params（补齐默认值）", () => {
  const spec = validateThreeSpec(
    { ...FULL_SPEC, params: { color: "#ff0000" } },
    threeRegistry,
  );

  assert.deepEqual(spec.params, {
    shape: "box",
    color: "#ff0000",
    accent: "#e8b04b",
    spinPerFrame: 0.02,
    tilt: 0.35,
    zoom: 1,
  });
  assert.equal(spec.componentId, "orbit3d");
  assert.equal(spec.componentVersion, 1);
  assert.equal(spec.durationMs, 4000);
  assert.equal(spec.seed, 7);
  assert.equal(spec.background, "#101820");
});

// —— T1：orbit3d@2 竖版方形像素取景（水平视轴恒 8×zoom，垂直随画幅）——
test("T1：orbit3d@2 注册且横竖视轴公式正确；@1 行为不变", async () => {
  const orbit3dModule = await import("./three/components/orbit3d.mjs");
  const registry = createThreeRegistry([
    orbit3dModule.orbit3dV1,
    orbit3dModule.orbit3dV2,
  ]);
  assert.deepEqual(registry.list().sort(), ["orbit3d@1", "orbit3d@2"]);

  const frustum = (rig) => ({
    w: rig.camera.right - rig.camera.left,
    h: rig.camera.top - rig.camera.bottom,
  });
  // 横版 1280×720：@2 与 @1 视轴逐值一致（水平 8，垂直 4.5——字节不变承诺）。
  const v1Landscape = orbit3dModule.orbit3dV1.createRig({
    THREE,
    params: {},
    background: "#101820",
  });
  const v2Landscape = orbit3dModule.orbit3dV2.createRig({
    THREE,
    params: {},
    background: "#101820",
    width: 1280,
    height: 720,
  });
  assert.deepEqual(frustum(v2Landscape), frustum(v1Landscape));

  // 竖版 720×1280：水平仍 8，垂直 = 8×(1280/720) ≈ 14.22（方形像素）。
  const v2Portrait = orbit3dModule.orbit3dV2.createRig({
    THREE,
    params: {},
    background: "#101820",
    width: 720,
    height: 1280,
  });
  const pf = frustum(v2Portrait);
  assert.equal(pf.w, 8);
  assert.ok(Math.abs(pf.h - 8 * (1280 / 720)) < 1e-9);

  // zoom 语义保留：水平视轴 = 8×zoom。
  const zoomed = orbit3dModule.orbit3dV2.createRig({
    THREE,
    params: { zoom: 2 },
    background: "#101820",
    width: 720,
    height: 1280,
  });
  assert.equal(frustum(zoomed).w, 16);

  // @1 不接受宽高也照常（旧渲染路径），且无宽高时 @2 回落 16:9 基线。
  const v2Default = orbit3dModule.orbit3dV2.createRig({
    THREE,
    params: {},
    background: "#101820",
  });
  assert.deepEqual(frustum(v2Default), frustum(v1Landscape));

  // validateThreeSpec 接受 componentVersion 2。
  const spec = validateThreeSpec(
    {
      ...FULL_SPEC,
      componentVersion: 2,
    },
    registry,
  );
  assert.equal(spec.componentVersion, 2);
});
