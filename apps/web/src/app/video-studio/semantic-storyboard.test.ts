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

test("semantic IR：旁白超出镜头时长预算 → 拒绝并给出预算", () => {
  // 2000ms 只装得下 floor((2000-400)/300)=5 字；10 字必须被拒。
  const bad = {
    ...VALID,
    shots: [
      { intent: "title", title: "T", narrationText: "一二三四五六七八九十", durationMs: 2000 },
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

test("semantic IR：cycle 镜头时长不足以演完 → 拒绝并点名下限", () => {
  // 4 阶段 cycle 需要 ≥ (4-1)×480+3000 = 4440ms；3000ms 必须被拒。
  const bad = {
    ...VALID,
    shots: [
      ...VALID.shots.slice(0, 1),
      { ...VALID.shots[1], durationMs: 3000 },
      ...VALID.shots.slice(2),
    ],
  };
  const v = validateSemanticDraft(bad);
  assert.ok(!v.ok);
  assert.ok(
    v.errors.some((e) => e.includes("shots[1]") && e.includes("4440")),
    v.errors.join("; "),
  );
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
