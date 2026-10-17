// P2-B：已打开项目上再次确认规划，不允许静默替换项目身份。
// 空项目首次规划 = 在当前文档落首个镜头（id 不变）；
// 已有镜头项目重新规划 = 明示「另存为新项目」，原项目原封不动。
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAppendOnlyEvolution,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";
import { applyPlan, applyStoryboard } from "./apply-plan.js";
import { planFromSentence, planStoryboard } from "./planner.js";

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

// —— P1 applyStoryboard：分镜应用为追加镜头（只追加演进）——

const STORYBOARD_SENTENCE = "做一个30秒的STEM解说视频，主题是勾股定理";

const storyboard = planStoryboard(STORYBOARD_SENTENCE);
assert.ok(storyboard.ok);

// UUID 形状的计数器工厂：每次调用产出互异且合法的 shot/version id。
function uuidFactory(kind: "cccccccc" | "dddddddd", start: number) {
  let n = start;
  return () => `${kind}-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

test("空项目应用分镜：追加 4 镜头、order 0..3、事件 submitted、Σ时长=30000", () => {
  const result = applyStoryboard(
    emptyProject(),
    STORYBOARD_SENTENCE,
    storyboard,
    {
      shot: uuidFactory("cccccccc", 0),
      version: uuidFactory("dddddddd", 0),
    },
  );
  assert.equal(result.mode, "storyboard-append");
  assert.equal(result.document.id, emptyProject().id, "不换项目身份");
  assert.equal(result.document.shots.length, 4);
  assert.deepEqual(
    result.document.shots.map((s) => s.order),
    [0, 1, 2, 3],
  );
  assert.equal(
    result.document.brief.sentence,
    STORYBOARD_SENTENCE,
    "brief 更新为分镜句",
  );
  assert.equal(result.document.title, "勾股定理");
  for (const shot of result.document.shots) {
    assert.equal(shot.events.length, 1);
    assert.equal(shot.events[0]!.kind, "submitted");
    assert.equal(shot.contentVersions.length, 1);
    assert.equal(shot.workingVersionId, shot.contentVersions[0]!.versionId);
  }
  const sum = result.document.shots.reduce(
    (acc, s) => acc + s.contentVersions[0]!.durationMs,
    0,
  );
  assert.equal(sum, 30000);
  validateVideoProject(result.document);
  assertAppendOnlyEvolution(emptyProject(), result.document);
  assert.match(result.notice, /追加 4 个镜头/);
});

// D2 Task1：分镜旁白文本落入 ContentVersion.narrationText（TTS 合成输入）
test("应用分镜：narrationText 逐镜头落入内容版本，与分镜结果一致", () => {
  const result = applyStoryboard(
    emptyProject(),
    STORYBOARD_SENTENCE,
    storyboard,
    {
      shot: uuidFactory("cccccccc", 100),
      version: uuidFactory("dddddddd", 100),
    },
  );
  assert.ok(storyboard.ok);
  result.document.shots.forEach((shot, index) => {
    assert.equal(
      shot.contentVersions[0]!.narrationText,
      storyboard.shots[index]!.narrationText,
      `镜头 ${index + 1} 旁白未落档`,
    );
  });
  assert.equal(
    result.document.shots[0]!.contentVersions[0]!.narrationText,
    "勾股定理。",
  );
});

test("已有镜头项目应用分镜：旧镜头逐字段不变，只追加演进通过", () => {
  const withShot = applyPlan(
    emptyProject(),
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  const oldShot = withShot.document.shots[0]!;
  const result = applyStoryboard(
    withShot.document,
    STORYBOARD_SENTENCE,
    storyboard,
    {
      shot: uuidFactory("cccccccc", 0),
      version: uuidFactory("dddddddd", 0),
    },
  );
  assert.equal(result.mode, "storyboard-append");
  assert.equal(result.document.shots.length, 5);
  assert.deepEqual(
    result.document.shots.map((s) => s.order),
    [0, 1, 2, 3, 4],
    "order 接续现有最大 +1",
  );
  const kept = result.document.shots.find((s) => s.shotId === oldShot.shotId);
  assert.deepEqual(kept, oldShot, "旧镜头逐字段原样");
  assertAppendOnlyEvolution(withShot.document, result.document);
  validateVideoProject(result.document);
});

test("locked 镜头存在的项目仍可追加分镜（locked 只管该镜头自身内容）", () => {
  const withShot = applyPlan(
    emptyProject(),
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  const lockedBase: VideoProject = {
    ...withShot.document,
    shots: withShot.document.shots.map((s) => ({ ...s, locked: true })),
  };
  const result = applyStoryboard(lockedBase, STORYBOARD_SENTENCE, storyboard, {
    shot: uuidFactory("cccccccc", 0),
    version: uuidFactory("dddddddd", 0),
  });
  assert.equal(result.document.shots.length, 5);
  assert.equal(result.document.shots[4]!.locked, false, "新镜头不继承 locked");
  assertAppendOnlyEvolution(lockedBase, result.document);
});
