// 终评 Important#2 回归：导入件里的 spec 是 unknown，可能来自更新版本（未注册
// 组件）或手改。预览解析必须把不可用的 spec 降级为 null（不可预览提示），
// 而不是把非法 spec 递进渲染路径炸掉整页编辑器。
import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProject } from "@acs/video-document";
import { applyPlan, type PlanIds } from "./apply-plan.js";
import { planFromSentence } from "./planner.js";
import { shotWorkingSpec } from "./shot-specs.js";

const IDS: PlanIds = {
  project: "cccccccc-1111-4111-8111-111111111111",
  shot: "cccccccc-2222-4222-8222-222222222222",
  version: "cccccccc-3333-4333-8333-333333333333",
};

function projectWithSpecShot(): VideoProject {
  const plan = planFromSentence("做一个4秒的文字动画，标题是预览降级");
  assert.ok(plan.ok);
  return applyPlan(
    {
      schemaVersion: 1,
      id: IDS.project,
      title: "未命名视频项目",
      brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
      shots: [],
      renderRecords: [],
      deliveries: [],
      savedVersion: 1,
    },
    "做一个4秒的文字动画，标题是预览降级",
    plan,
    IDS,
  ).document;
}

test("shotWorkingSpec：合法 spec 镜头返回已校验 spec", () => {
  const project = projectWithSpecShot();
  const spec = shotWorkingSpec(project.shots[0]!);
  assert.ok(spec);
  assert.equal(typeof spec.componentId, "string");
  assert.equal(spec.durationMs, 4000);
});

test("shotWorkingSpec：缺 working version 指针 → null", () => {
  const project = projectWithSpecShot();
  const broken = {
    ...project.shots[0]!,
    workingVersionId: "cccccccc-9999-4999-8999-999999999999",
  };
  assert.equal(shotWorkingSpec(broken), null);
});

test("shotWorkingSpec：sceneSource 非 spec → null", () => {
  const project = projectWithSpecShot();
  const nonSpec = structuredClone(project.shots[0]!);
  nonSpec.contentVersions[0]!.sceneSource = {
    type: "editor-binding",
    engineId: "remotion",
    engineVersion: "1.0.0",
    assetId: "asset-1",
  };
  assert.equal(shotWorkingSpec(nonSpec), null);
});

test("shotWorkingSpec：未注册组件的 spec（导入件来自更新版本）→ null 不抛", () => {
  const project = projectWithSpecShot();
  const future = structuredClone(project.shots[0]!);
  const version = future.contentVersions[0]!;
  assert.equal(version.sceneSource.type, "spec");
  version.sceneSource = {
    type: "spec",
    spec: {
      ...(version.sceneSource as { type: "spec"; spec: object }).spec,
      componentId: "future-animation",
      componentVersion: 99,
    },
  };
  // 旧实现（裸 cast）会把这份非法 spec 原样递进渲染路径 → 渲染期抛错炸页。
  // 新契约：这里就必须拦下，返回 null。
  assert.equal(shotWorkingSpec(future), null);
});
