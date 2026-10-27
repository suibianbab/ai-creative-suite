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

test("N3 verifySourcedNumbers：数值必须原样来自用户原话（P1-2 收紧）", () => {
  const userText = "睡前刷手机1小时 vs 阅读30分钟，入睡时间从40分钟缩短到15分钟";
  // IR 数值（40/15）都在原话里 → 通过。
  assert.deepEqual(
    verifySourcedNumbers(COMPARE_IR, userText),
    [],
  );
  // P1-2：差值推导不可靠（单位/可比量无法判定）→ 只接受原话数字。
  // 40-15=25 不再放行——deltaText 须用原话数字表述（如「缩短到15分钟」）。
  const derived = verifySourcedNumbers(
    { ...COMPARE_IR, deltaText: "缩短25分钟" },
    userText,
  );
  assert.ok(derived.some((e) => /25/.test(e)), "差值数字应被拒绝");
  // 混合单位差（1小时-30分钟=29?）同样拒绝。
  const mixedUnit = verifySourcedNumbers(
    { ...COMPARE_IR, deltaText: "缩短29分钟" },
    "耗时从1小时变为30分钟",
  );
  assert.ok(mixedUnit.some((e) => /29/.test(e)), "混合单位差值应被拒绝");
  // P1-2：旁白/短注里的编造数字也要拦（此前只查 value/delta/date）。
  const noteFabricated = verifySourcedNumbers(
    { ...COMPARE_IR, beforeNote: "提高85%" },
    "比较读书和手机",
  );
  assert.ok(
    noteFabricated.some((e) => /85/.test(e) && /beforeNote/.test(e)),
    noteFabricated.join("; "),
  );
  const narrationFabricated = verifySourcedNumbers(
    { ...COMPARE_IR, narrationText: "效果提高85%" },
    "比较读书和手机",
  );
  assert.ok(
    narrationFabricated.some((e) => /85/.test(e) && /narrationText/.test(e)),
    narrationFabricated.join("; "),
  );
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
  assert.ok(
    fakeDates.some((e) => /2024/.test(e)),
    fakeDates.join("; "),
  );
  // 序数豁免：「第1步」这类结构性序号不算事实数字。
  const ordinal = verifySourcedNumbers(
    {
      intent: "flow-explainer",
      title: "三步",
      narrationText: "三步完成",
      durationMs: 3000,
      flowSteps: ["第1步准备", "第2步执行", "第3步收尾"],
    },
    "教我三步完成",
  );
  assert.deepEqual(ordinal, []);
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

// P1-1（Codex 复核 2026-10-27）：新 intent 的字段形状必须在校验层拦住——
// 坏 milestones/compare 字段不得进数值闸（TypeError→500）或编译期才失败。
test("N3 P1-1：timeline milestones 形状校验（字符串/null 条目/坏 status）", () => {
  const base = {
    intent: "timeline-explainer" as const,
    title: "测试",
    narrationText: "看看过程",
    durationMs: 3000,
  };
  const r1 = validateSemanticShot({ ...base, milestones: "坏数据" });
  assert.ok(!r1.ok, "milestones 字符串必须被拒");
  assert.ok(r1.errors.some((e) => e.includes("milestones")));

  const r2 = validateSemanticShot({
    ...base,
    milestones: [{ date: "播种", label: "a" }, null, { date: "发芽", label: "b" }],
  });
  assert.ok(!r2.ok, "null 条目必须被拒");
  assert.ok(r2.errors.some((e) => e.includes("milestones[1]")));

  const r3 = validateSemanticShot({
    ...base,
    milestones: [
      { date: "播种", label: "a", status: "bogus" },
      { date: "发芽", label: "b" },
    ],
  });
  assert.ok(!r3.ok, "坏 status 必须被拒");
  assert.ok(r3.errors.some((e) => e.includes("status")));
});

test("N3 P1-1：compare 字段缺失/错型在校验层拒绝（带字段路径）", () => {
  const base = {
    intent: "compare-explainer" as const,
    title: "T",
    narrationText: "N",
    durationMs: 3000,
  };
  const r1 = validateSemanticShot(base);
  assert.ok(!r1.ok, "缺全部对比字段必须被拒");
  assert.ok(r1.errors.some((e) => e.includes("metricLabel")));
  assert.ok(r1.errors.some((e) => e.includes("deltaPositive")));

  const r2 = validateSemanticShot({
    ...base,
    metricLabel: 123,
    beforeLabel: "A", beforeValue: "1", beforeNote: "x",
    afterLabel: "B", afterValue: "2", afterNote: "y",
    deltaText: "d", deltaPositive: "yes",
  });
  assert.ok(!r2.ok);
  assert.ok(r2.errors.some((e) => e.includes("metricLabel")));
  assert.ok(r2.errors.some((e) => e.includes("deltaPositive")));
});


// I-1（独立评审 2026-10-27）：全角数字与汉字数值不得绕过闸。
test("N3 I-1：全角/汉字数字同样受闸", () => {
  // 无数字基底（隔离数值字段，避免与原话无关的 40/15 干扰断言）。
  const base = {
    ...COMPARE_IR,
    beforeValue: "更长",
    afterValue: "更短",
    deltaText: "更快",
  };
  const userText = "比较读书和手机";
  // 全角２５。
  const fullWidth = verifySourcedNumbers(
    { ...base, beforeNote: "提高２５％" },
    userText,
  );
  assert.ok(
    fullWidth.some((e) => /２５|25/.test(e)),
    fullWidth.join("; "),
  );
  // 汉字「二十五」。
  const chinese = verifySourcedNumbers(
    { ...base, beforeNote: "提高二十五个百分点" },
    userText,
  );
  assert.ok(
    chinese.some((e) => /二十五/.test(e)),
    chinese.join("; "),
  );
  // 原话里有「三十」→ 汉字数值原样引用通过。
  const okCase = verifySourcedNumbers(
    { ...base, beforeNote: "约三十分钟" },
    "比较读书半小时和手机三十分钟",
  );
  assert.deepEqual(okCase, []);
});

// I-3（独立评审）：compare/timeline 标题上限对齐组件契约 30 字。
test("N3 I-3：compare/timeline 标题 ≤30 字（组件契约）", () => {
  const longTitle = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一";
  const r1 = validateSemanticShot({ ...COMPARE_IR, title: longTitle });
  assert.ok(!r1.ok);
  assert.ok(
    r1.errors.some((e) => e.includes("title") && e.includes("30")),
    r1.errors.join("; "),
  );
  const r2 = validateSemanticShot({ ...TIMELINE_IR, title: longTitle });
  assert.ok(!r2.ok);
  assert.ok(r2.errors.some((e) => e.includes("30")));
  // 旧四 intent 维持 32（组件契约 ≥40，取既有交集口径）。
  const r3 = validateSemanticShot({
    intent: "title",
    title: longTitle.slice(0, 32),
    narrationText: "旁白",
    durationMs: 2500,
  });
  assert.ok(r3.ok, r3.ok ? "" : r3.errors.join("; "));
});
