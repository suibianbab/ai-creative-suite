import assert from "node:assert/strict";
import test from "node:test";
import { quantizeTimeline } from "@acs/video-document";
import type { StoryboardResult } from "./planner";
import { validateSemanticDraft, compileSemanticDraft } from "./semantic-storyboard";

const VALID = {
  topic: "水循环",
  title: "水的旅程",
  shots: [
    { intent: "title", title: "水的旅程", narrationText: "一滴水的故事", durationMs: 3000 },
    {
      intent: "cycle-explainer",
      title: "水循环四阶段",
      narrationText: "循环讲解",
      durationMs: 5000,
      cycleSteps: [
        { label: "蒸发" },
        { label: "凝结" },
        { label: "降水" },
        { label: "汇集" },
      ],
    },
    { intent: "title", title: "结尾", narrationText: "谢谢", durationMs: 3000 },
  ],
};

test("semantic IR：合法草稿通过校验并编译出有效 SceneSpec", () => {
  const v = validateSemanticDraft(VALID);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "做一条水循环短片");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  assert.equal(c.shots.length, 3);
  assert.equal(c.totalMs, 11000);
  assert.equal(c.shots[0]!.plan.spec.componentId, "text-animation");
  assert.equal(c.shots[1]!.plan.spec.componentId, "explainer-composition");
  assert.equal(
    (c.shots[1]!.plan.spec.params as { diagram: { kind: string } }).diagram.kind,
    "cycle",
  );
});

test("semantic IR：未知 intent 拒绝", () => {
  const bad = {
    ...VALID,
    shots: [
      { intent: "random", title: "T", narrationText: "N", durationMs: 3000 },
      ...VALID.shots.slice(1),
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(!v.ok);
  assert.ok(
    v.errors.some((e) => e.includes("intent")),
    v.errors.join("; "),
  );
});

test("semantic IR：缺失 cycleSteps 拒绝", () => {
  const bad2 = {
    ...VALID,
    shots: [
      { intent: "cycle-explainer", title: "T", narrationText: "N", durationMs: 3000 },
    ],
  };
  const v2 = validateSemanticDraft(bad2);
  assert.ok(!v2.ok);
  assert.ok(
    v2.errors.some((e) => e.includes("cycleSteps")),
    v2.errors.join("; "),
  );
});

test("semantic IR：旁白连 6000ms 都装不下 → 拒绝（预算不可延长）", () => {
  // 6000ms 最多 floor((6000-400)/300)=18 字；19 字无论怎么延长都读不完。
  const bad = {
    ...VALID,
    shots: [
      { intent: "title", title: "T", narrationText: "一二三四五六七八九十一二三四五六七八九", durationMs: 6000 },
      ...VALID.shots.slice(1),
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(!v.ok);
  assert.ok(
    v.errors.some((e) => e.includes("shots[0]") && e.includes("旁白")),
    v.errors.join("; "),
  );
});

test("semantic 编译：旁白超出模型时长但延长可救 → 确定性延长（旧规划器下限语义）", () => {
  // 10 字旁白预算 3400ms；模型给 2000ms 不是错误，编译器延长到 3400。
  const draft = {
    ...VALID,
    shots: [
      { intent: "title", title: "T", narrationText: "一二三四五六七八九十", durationMs: 2000 },
      ...VALID.shots.slice(1),
    ],
  };
  const v = validateSemanticDraft(draft);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "句子");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  assert.equal(c.shots[0]!.plan.spec.durationMs, 3400);
});

test("semantic IR：bullets 超 12 字 → 拒绝（sketch-note 契约）", () => {
  const bad = {
    ...VALID,
    shots: [
      {
        intent: "text-explainer",
        title: "要点",
        narrationText: "三个要点",
        durationMs: 4000,
        bullets: ["一二三四五六七八九十一二三四五"],
      },
      ...VALID.shots.slice(1),
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(!v.ok);
  assert.ok(
    v.errors.some((e) => e.includes("bullets[0]") && e.includes("12")),
    v.errors.join("; "),
  );
});

test("semantic IR：cycle caption 超 12 字 → 拒绝", () => {
  const bad = {
    ...VALID,
    shots: [
      VALID.shots[0],
      {
        intent: "cycle-explainer" as const,
        title: "水循环四阶段",
        narrationText: "循环讲解",
        durationMs: 5000,
        cycleSteps: [
          { label: "蒸发", caption: "一二三四五六七八九十一二三四五" },
          { label: "凝结" },
          { label: "降水" },
          { label: "汇集" },
        ],
      },
      VALID.shots[2],
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(!v.ok);
  assert.ok(
    v.errors.some((e) => e.includes("caption") && e.includes("12")),
    v.errors.join("; "),
  );
});

test("semantic 编译：cycle 时长不足以演完 → 确定性延长到演完下限", () => {
  // 4 阶段 cycle 演完需 (4-1)×480+3000 = 4440ms；模型给 3000ms 不是错误，
  // 编译器延长到 4440（durationMs 是模型的下限意图，同旧规划器下限语义）。
  const bad = {
    ...VALID,
    shots: [
      ...VALID.shots.slice(0, 1),
      { ...VALID.shots[1], durationMs: 3000 },
      ...VALID.shots.slice(2),
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "句子");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  assert.equal(c.shots[1]!.plan.spec.durationMs, 4440);
});

test("semantic 编译：flow-explainer 用 flow-steps@1 纵向布局（独立组件无碰撞）", () => {
  const draft = {
    topic: "水循环",
    title: "水的旅程",
    shots: [
      { intent: "title", title: "水的旅程", narrationText: "一滴水的旅程", durationMs: 2500 },
      {
        intent: "flow-explainer",
        title: "三步走",
        narrationText: "从海到云再到地",
        durationMs: 3000,
        flowSteps: ["海洋", "云朵", "河流"],
      },
      { intent: "title", title: "谢谢观看", narrationText: "谢谢观看", durationMs: 2500 },
    ],
  };
  const v = validateSemanticDraft(draft);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "句子");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  const spec = c.shots[1]!.plan.spec;
  assert.equal(spec.componentId, "flow-steps");
  assert.equal(
    (spec.params as { direction: string }).direction,
    "vertical",
  );
});

test("semantic 编译：renderHint 列出该镜屏幕文字（I-5，交接单 §3.3）", () => {
  const draft = {
    topic: "水循环",
    title: "水的旅程",
    shots: [
      { intent: "title", title: "水的旅程", narrationText: "一滴水的旅程", durationMs: 2500 },
      {
        intent: "cycle-explainer",
        title: "水循环三阶段",
        narrationText: "水在三个阶段循环",
        durationMs: 5000,
        cycleSteps: [{ label: "蒸发" }, { label: "凝结" }, { label: "降水" }],
      },
      {
        intent: "text-explainer",
        title: "为什么重要",
        narrationText: "淡水全靠它补给",
        durationMs: 4000,
        bullets: ["淡水之源", "气候推手"],
      },
      {
        intent: "flow-explainer",
        title: "路径",
        narrationText: "从海到云再到地",
        durationMs: 3000,
        flowSteps: ["海洋", "云朵", "河流"],
      },
      { intent: "title", title: "谢谢观看", narrationText: "谢谢观看", durationMs: 2500 },
    ],
  };
  const v = validateSemanticDraft(draft);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "句子");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  const hints = c.shots.map((s) => s.plan.renderHint);
  // 确认卡预告的是观众将看到的文字：标题/副标题、循环阶段、要点、流程步骤。
  assert.match(hints[0]!, /水的旅程/);
  assert.match(hints[0]!, /一滴水的旅程/);
  assert.match(hints[1]!, /蒸发/);
  assert.match(hints[1]!, /凝结/);
  assert.match(hints[1]!, /降水/);
  assert.match(hints[2]!, /淡水之源/);
  assert.match(hints[2]!, /气候推手/);
  assert.match(hints[3]!, /海洋/);
  assert.match(hints[3]!, /河流/);
});

test("semantic 编译：输出即 StoryboardResult(ok:true)，24fps 无零帧", () => {
  const v = validateSemanticDraft(VALID);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticDraft(v.draft, "做一条水循环短片");
  assert.ok(c.ok, c.ok ? "" : c.errors.join("; "));
  // 字段名与 planner.StoryboardResult 对齐：shots / totalMs / sentence / title。
  const asResult: StoryboardResult = c;
  assert.equal(asResult.ok, true);
  if (!asResult.ok) return;
  assert.equal(asResult.shots.length, 3);
  assert.equal(asResult.totalMs, asResult.shots.reduce((ms, s) => ms + s.plan.spec.durationMs, 0));
  // 每镜时长为正整数且 24fps 量化无零帧镜头。
  const durations = asResult.shots.map((s) => s.plan.spec.durationMs);
  for (const d of durations) {
    assert.ok(Number.isInteger(d) && d > 0, `durationMs=${d}`);
  }
  const timeline = quantizeTimeline(durations, 24);
  assert.ok(timeline.totalFrames > 0);
});
