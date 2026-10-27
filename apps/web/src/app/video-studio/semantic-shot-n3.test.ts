import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticShot,
  type SemanticDraftShot,
  validateSemanticShot,
  verifySourcedNumbers,
} from "./semantic-storyboard";

// N3（交接单 2026-10-27）：compare-split@2 / timeline-milestones@2 接入受限
// IR。数值/日期防伪造：数字必须来自用户原话（verifySourcedNumbers 确定性
// 子集校验）；用户没给就不得出现具体数字（用顺序词）。

const COMPARE_IR: SemanticDraftShot = {
  intent: "compare-explainer",
  title: "睡前习惯与入睡速度",
  narrationText: "换成阅读，入睡更快",
  durationMs: 4000,
  metricLabel: "入睡所需时间",
  beforeLabel: "刷手机",
  beforeValue: "40分钟",
  beforeNote: "蓝光提神",
  afterLabel: "阅读",
  afterValue: "15分钟",
  afterNote: "身心放松",
  deltaText: "缩短到15分钟",
  deltaPositive: true,
};

const TIMELINE_IR: SemanticDraftShot = {
  intent: "timeline-explainer",
  title: "种子发芽四阶段",
  narrationText: "从种子到开花的旅程",
  durationMs: 4000,
  milestones: [
    { date: "播种", label: "埋入土壤" },
    { date: "发芽", label: "破土见光" },
    { date: "幼苗", label: "长出真叶" },
    { date: "开花", label: "绽放成花" },
  ],
};

test("N3 compare-explainer：合法 IR 通过校验并编译到 compare-split@2", () => {
  const v = validateSemanticShot(COMPARE_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5010);
  assert.equal(c.plan.spec.componentId, "compare-split");
  assert.equal(c.plan.spec.componentVersion, 2);
  const params = c.plan.spec.params as Record<string, unknown>;
  assert.equal(params.beforeValue, "40分钟");
  assert.equal(params.deltaPositive, true);
  // renderHint 预告屏幕上会出现什么（交接单 N3 要求）。
  assert.match(c.plan.renderHint, /刷手机/);
  assert.match(c.plan.renderHint, /40分钟/);
  assert.match(c.plan.renderHint, /阅读/);
});

test("N3 compare-explainer：未知字段拒绝（严格键集合口径延续）", () => {
  const bad = validateSemanticShot({
    ...COMPARE_IR,
    imageUrl: "https://e.com/a.png",
  });
  assert.ok(!bad.ok);
  assert.ok(
    bad.errors.some((e) => e.includes("imageUrl") && /素材|照片/.test(e)),
    bad.errors.join("; "),
  );
});

test("N3 timeline-explainer：合法 IR 编译到 timeline-milestones@2（默认 done）", () => {
  const v = validateSemanticShot(TIMELINE_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5011);
  assert.equal(c.plan.spec.componentId, "timeline-milestones");
  assert.equal(c.plan.spec.componentVersion, 2);
  const params = c.plan.spec.params as { milestones: Array<{ status: string }> };
  assert.ok(params.milestones.every((m) => m.status === "done"));
  assert.match(c.plan.renderHint, /播种/);
  assert.match(c.plan.renderHint, /开花/);
});

test("N3 verifySourcedNumbers：数值必须来自用户原话", () => {
  const userText = "睡前刷手机1小时 vs 阅读30分钟，入睡时间从40分钟缩短到15分钟";
  // IR 数值（40/15）都在原话里 → 通过。
  assert.deepEqual(
    verifySourcedNumbers(COMPARE_IR, userText),
    [],
  );
  // 模型编造 85% → 拒绝并点名。
  const fabricated = verifySourcedNumbers(
    { ...COMPARE_IR, afterValue: "85%" },
    userText,
  );
  assert.ok(fabricated.length > 0, "编造数值应被拒绝");
  assert.match(fabricated[0]!, /85/);
  // 时间线：无日期顺序词用文字 → 无数字 → 任何用户句都通过。
  assert.deepEqual(verifySourcedNumbers(TIMELINE_IR, "讲种子发芽"), []);
  // 时间线编造年份 → 拒绝。
  const fakeDates = verifySourcedNumbers(
    {
      ...TIMELINE_IR,
      milestones: [
        { date: "第1周", label: "播种" },
        { date: "2024年", label: "发芽" },
      ],
    },
    "讲种子发芽",
  );
  assert.ok(fakeDates.some((e) => /2024/.test(e)), fakeDates.join("; "));
});

test("N3 timeline-explainer：时长下限按节点数延长（演完+停留）", () => {
  const v = validateSemanticShot({ ...TIMELINE_IR, durationMs: 2000 });
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5011);
  // 4 节点下限 2900+3×300=3800ms。
  assert.ok(
    c.plan.spec.durationMs >= 3800,
    `durationMs=${c.plan.spec.durationMs}`,
  );
});
