// P2-B：已打开项目上再次确认规划，不允许静默替换项目身份。
// 空项目首次规划 = 在当前文档落首个镜头（id 不变）；
// 已有镜头项目重新规划 = 明示「另存为新项目」，原项目原封不动。
import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProject } from "@acs/video-document";
import { applyPlan } from "./apply-plan.js";
import { planFromSentence } from "./planner.js";

const IDS = {
  project: "aaaaaaaa-1111-4111-8111-111111111111",
  shot: "aaaaaaaa-2222-4222-8222-222222222222",
  version: "aaaaaaaa-3333-4333-8333-333333333333",
};

function emptyProject(): VideoProject {
  return {
    schemaVersion: 1,
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    title: "未命名视频项目",
    brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
    shots: [],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

const plan = planFromSentence("做一个8秒的线描动画，标题是山水发布");
assert.ok(plan.ok);

test("空项目首次应用：first-shot，文档 id 不变，落首个镜头", () => {
  const project = emptyProject();
  const result = applyPlan(
    project,
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  assert.equal(result.mode, "first-shot");
  assert.equal(result.document.id, project.id, "首次规划不得换项目身份");
  assert.equal(result.document.shots.length, 1);
  assert.equal(result.document.title, "山水发布");
  assert.equal(
    result.document.brief.sentence,
    "做一个8秒的线描动画，标题是山水发布",
  );
});

test("已有镜头项目重新应用：save-as-new，新 id，原项目不被修改", () => {
  const withShot = applyPlan(
    emptyProject(),
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  const before = JSON.stringify(withShot.document);

  const replan = planFromSentence("做一个12秒的文字动画，标题是云制造");
  assert.ok(replan.ok);
  const rePlanned = applyPlan(
    withShot.document,
    "做一个12秒的文字动画，标题是云制造",
    replan,
    IDS,
  );
  assert.equal(rePlanned.mode, "save-as-new");
  assert.notEqual(rePlanned.document.id, withShot.document.id);
  assert.equal(rePlanned.document.id, IDS.project);
  assert.equal(rePlanned.document.shots.length, 1);
  assert.match(rePlanned.notice, /另存为新项目/);
  assert.equal(JSON.stringify(withShot.document), before, "输入文档原封不动");
});
