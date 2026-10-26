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
import {
  applyPlan,
  applyStoryboard,
  describeStoryboardAppend,
  storyboardConfirmLines,
} from "./apply-plan.js";
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
function uuidFactory(kind: string, start: number) {
  let n = start;
  return () => `${kind}-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

test("空项目应用分镜：追加 4 镜头、order 0..3、事件 submitted、Σ时长=30000", () => {
  const result = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 0),
    version: uuidFactory("dddddddd", 0),
  });
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
    "brief 更新为分镜快照句",
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
  assert.match(result.notice, /4 个镜头/);
});

// D2 Task1：分镜旁白文本落入 ContentVersion.narrationText（TTS 合成输入）
test("应用分镜：narrationText 逐镜头落入内容版本，与分镜结果一致", () => {
  const result = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 100),
    version: uuidFactory("dddddddd", 100),
  });
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

// 语义分镜（2026-10-26）：AI 路径的 provenance 不得记成 planner-rules；
// 默认（不传）仍为 planner-rules，旧路径与旧测试行为不变。
test("应用分镜：默认 provenance=planner-rules；语义路径可传入 AI 引擎标识", () => {
  const rules = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 200),
    version: uuidFactory("dddddddd", 200),
  });
  assert.equal(
    rules.document.shots[0]!.contentVersions[0]!.provenance.engineId,
    "planner-rules",
  );
  assert.equal(
    rules.document.shots[0]!.contentVersions[0]!.provenance.engineVersion,
    "1",
  );

  const semantic = applyStoryboard(
    emptyProject(),
    storyboard,
    {
      shot: uuidFactory("cccccccc", 300),
      version: uuidFactory("dddddddd", 300),
    },
    { engineId: "planner-semantic", engineVersion: "qwen-plus/prompt1/compiler1" },
  );
  assert.equal(
    semantic.document.shots[0]!.contentVersions[0]!.provenance.engineId,
    "planner-semantic",
  );
  assert.equal(
    semantic.document.shots[0]!.contentVersions[0]!.provenance.engineVersion,
    "qwen-plus/prompt1/compiler1",
  );
  validateVideoProject(semantic.document);
});

// Task 2：镜头说明是规划产物，应用层原样落库（不再二次拼接文案）。
test("应用分镜：镜头说明逐字落入工作版本，与分镜结果一致", () => {
  const result = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 150),
    version: uuidFactory("dddddddd", 150),
  });
  assert.ok(storyboard.ok);
  result.document.shots.forEach((shot, index) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    assert.equal(
      working!.description,
      storyboard.shots[index]!.description,
      `镜头 ${index + 1} 说明未原样落档`,
    );
  });
  assert.equal(
    result.document.shots[0]!.contentVersions[0]!.description,
    "开场（文字动画）：标题「勾股定理」进入画面",
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
  const result = applyStoryboard(withShot.document, storyboard, {
    shot: uuidFactory("cccccccc", 0),
    version: uuidFactory("dddddddd", 0),
  });
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
  const result = applyStoryboard(lockedBase, storyboard, {
    shot: uuidFactory("cccccccc", 0),
    version: uuidFactory("dddddddd", 0),
  });
  assert.equal(result.document.shots.length, 5);
  assert.equal(result.document.shots[4]!.locked, false, "新镜头不继承 locked");
  assertAppendOnlyEvolution(lockedBase, result.document);
});

// —— 2026-10-18 Codex 复核反馈：分镜应用 = 追加语义，需求与成片必须一致 ——
//
// 规划句在 planStoryboard 快照进 StoryboardResult，applyStoryboard 不再收
// 调用方当下的输入（「规划后改句子再应用写过期 sentence」被结构性消灭）；
// brief.applications 逐次记录应用快照，film*After 与 shots 可对账——
// 「8 秒项目再应用 8 秒分镜」时，数据明说整片变 16 秒，而不是需求仍写 8 秒。

test("分镜结果快照规划句：brief.sentence 来自快照而非调用方当下输入", () => {
  assert.ok(storyboard.ok);
  assert.equal(storyboard.sentence, STORYBOARD_SENTENCE);
  const result = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 200),
    version: uuidFactory("dddddddd", 200),
  });
  assert.equal(result.document.brief.sentence, STORYBOARD_SENTENCE);
});

test("空项目首次应用分镜：applications 首条快照与 shots 对账", () => {
  const result = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 300),
    version: uuidFactory("dddddddd", 300),
  });
  const apps = result.document.brief.applications;
  assert.equal(apps?.length, 1);
  const app0 = apps![0]!;
  assert.equal(app0.sentence, STORYBOARD_SENTENCE);
  assert.equal(app0.appendedShotCount, 4);
  assert.equal(app0.appendedDurationMs, 30000);
  assert.equal(app0.filmShotCountAfter, 4);
  assert.equal(app0.filmTotalMsAfter, 30000);
  assert.equal(typeof app0.appliedAt, "string");
});

test("已有镜头项目追加分镜：快照记追加后整片，需求与成片不打架", () => {
  // 8s 单镜头项目 + 30s 分镜 → 成片 5 镜头 / 38s；数据必须明说
  const withShot = applyPlan(
    emptyProject(),
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  const result = applyStoryboard(withShot.document, storyboard, {
    shot: uuidFactory("cccccccc", 400),
    version: uuidFactory("dddddddd", 400),
  });
  assert.equal(result.document.shots.length, 5);
  const app0 = result.document.brief.applications![0]!;
  assert.equal(app0.appendedShotCount, 4);
  assert.equal(app0.appendedDurationMs, 30000);
  assert.equal(app0.filmShotCountAfter, 5);
  assert.equal(app0.filmTotalMsAfter, 38000);
  assert.equal(result.document.brief.sentence, STORYBOARD_SENTENCE);
  assert.match(result.notice, /5 个镜头/);
  assert.match(result.notice, /38s/);
});

test("两次应用分镜：applications 追加第二条，brief.sentence 为最近一次", () => {
  const first = applyStoryboard(emptyProject(), storyboard, {
    shot: uuidFactory("cccccccc", 500),
    version: uuidFactory("dddddddd", 500),
  });
  const secondSentence = "做一个10秒的STEM解说视频，主题是二次方程，分3个镜头";
  const sb2 = planStoryboard(secondSentence);
  assert.ok(sb2.ok);
  const second = applyStoryboard(first.document, sb2, {
    shot: uuidFactory("eeeeeeee", 0),
    version: uuidFactory("ffffffff", 0),
  });
  const apps = second.document.brief.applications;
  assert.equal(apps?.length, 2);
  const app1 = apps![1]!;
  assert.equal(app1.sentence, secondSentence);
  assert.equal(app1.appendedShotCount, 3);
  // 语速感知（spec R4）：二次方程要点镜头 10 字 → 3400ms > 等分 3333ms，
  // Σ=10067；用户要的 10s 是目标值，容纳旁白优先。
  assert.equal(app1.appendedDurationMs, 10067);
  assert.equal(app1.filmShotCountAfter, 7);
  assert.equal(app1.filmTotalMsAfter, 40067);
  assert.equal(second.document.brief.sentence, secondSentence);
});

test("分镜确认卡逐镜头带出旁白与时长", () => {
  const storyboard = planStoryboard(
    "做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头",
  );
  assert.ok(storyboard.ok);
  const lines = storyboardConfirmLines(storyboard);
  assert.equal(lines.length, 4);
  assert.equal(lines[0]!.index, 1);
  assert.equal(lines[0]!.label, "开场");
  assert.equal(lines[0]!.narrationText, "勾股定理。");
  assert.equal(lines[1]!.narrationText, "勾股定理，要点 1。");
  assert.equal(lines[3]!.narrationText, "谢谢观看。");
  assert.equal(
    lines[1]!.durationSeconds,
    storyboard.shots[1]!.plan.spec.durationMs / 1000,
  );
  assert.equal(lines[1]!.renderHint, storyboard.shots[1]!.plan.renderHint);
});

test("describeStoryboardAppend：确认卡算术预告（空项目/已有镜头）", () => {
  const withShot = applyPlan(
    emptyProject(),
    "做一个8秒的线描动画，标题是山水发布",
    plan,
    IDS,
  );
  assert.equal(
    describeStoryboardAppend(withShot.document, storyboard),
    "当前整片 1 个镜头 / 8s，应用后 5 个镜头 / 38s（追加 4 个镜头，+30s）",
  );
  assert.equal(
    describeStoryboardAppend(emptyProject(), storyboard),
    "整片将从本分镜开始：4 个镜头 / 30s",
  );
});
