import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticShot,
  type SemanticDraftShot,
  validateSemanticShot,
  verifySourcedNumbers,
} from "./semantic-storyboard";

// N4（交接单 2026-10-27）：bar-chart / line-chart / number-counter 接入受限
// 语义 IR。模型只给业务数据与意图（label/value），颜色/时序/布局由编译器
// 定；数值只允许来自用户原话（闸校验字符串化的 value），确认卡逐项可见。

const BAR_IR: SemanticDraftShot = {
  intent: "bar-explainer",
  title: "三城市年降水",
  narrationText: "降水差异明显",
  durationMs: 4000,
  bars: [
    { label: "北京", value: 530 },
    { label: "上海", value: 1170 },
    { label: "广州", value: 1720 },
  ],
};

const LINE_IR: SemanticDraftShot = {
  intent: "line-explainer",
  title: "月均气温",
  narrationText: "夏高冬低",
  durationMs: 4000,
  points: [
    { label: "一月", value: 2 },
    { label: "七月", value: 28 },
  ],
};

const COUNTER_IR: SemanticDraftShot = {
  intent: "counter-explainer",
  title: "一天饮水建议",
  narrationText: "喝够水",
  durationMs: 3000,
  value: 1500,
  prefix: "约",
  suffix: "毫升",
};

const BAR_USER = "北京年降水530毫米，上海1170，广州1720";

test("N4 bar-explainer：合法 IR 校验并编译到 bar-chart@1（值/标签原样）", () => {
  const v = validateSemanticShot(BAR_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5020);
  assert.equal(c.plan.spec.componentId, "bar-chart");
  const params = c.plan.spec.params as {
    bars: Array<{ label: string; value: number }>;
  };
  assert.deepEqual(
    params.bars.map((b) => `${b.label}${b.value}`),
    ["北京530", "上海1170", "广州1720"],
  );
  // 确认卡逐项对账：renderHint 列出每条 label+value。
  assert.match(c.plan.renderHint, /北京 530/);
  assert.match(c.plan.renderHint, /广州 1720/);
});

test("N4 bar-explainer：条目形状/数量/数值范围校验（契约口径）", () => {
  const r1 = validateSemanticShot({ ...BAR_IR, bars: "坏数据" });
  assert.ok(!r1.ok && r1.errors.some((e) => e.includes("bars")));
  const r2 = validateSemanticShot({
    ...BAR_IR,
    bars: [{ label: "北京", value: 530 }, null],
  });
  assert.ok(!r2.ok && r2.errors.some((e) => e.includes("bars[1]")));
  const r3 = validateSemanticShot({
    ...BAR_IR,
    bars: [{ label: "北京", value: -5 }],
  });
  assert.ok(!r3.ok && r3.errors.some((e) => e.includes("value")));
  const r4 = validateSemanticShot({
    ...BAR_IR,
    bars: [{ label: "北京", value: 1e13 }],
  });
  assert.ok(!r4.ok && r4.errors.some((e) => e.includes("value")));
});

test("N4 line-explainer：合法 IR 编译到 line-chart@1；点数/值域校验", () => {
  const v = validateSemanticShot(LINE_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5021);
  assert.equal(c.plan.spec.componentId, "line-chart");
  assert.match(c.plan.renderHint, /一月 2/);
  assert.match(c.plan.renderHint, /七月 28/);
  const bad = validateSemanticShot({
    ...LINE_IR,
    points: [{ label: "一月", value: 2 }],
  });
  assert.ok(!bad.ok && bad.errors.some((e) => e.includes("points")));
});

test("N4 counter-explainer：合法 IR 编译到 number-counter@1；前后缀/小数校验", () => {
  const v = validateSemanticShot(COUNTER_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5022);
  assert.equal(c.plan.spec.componentId, "number-counter");
  const params = c.plan.spec.params as {
    value: number;
    prefix: string;
    suffix: string;
  };
  assert.equal(params.value, 1500);
  assert.equal(params.suffix, "毫升");
  assert.match(c.plan.renderHint, /1500/);
  assert.match(c.plan.renderHint, /毫升/);
  const bad = validateSemanticShot({
    ...COUNTER_IR,
    prefix: "超过六个字符的前缀",
  });
  assert.ok(!bad.ok && bad.errors.some((e) => e.includes("prefix")));
});

test("N4 数值闸：图表 value 参与来源校验（编造值拒绝、原话值放行）", () => {
  // 原话值 530/1170/1720 → 通过。
  assert.deepEqual(verifySourcedNumbers(BAR_IR, BAR_USER), []);
  // 编造 999 → 拒绝并点名。
  const fabricated = verifySourcedNumbers(
    {
      ...BAR_IR,
      bars: [
        { label: "北京", value: 530 },
        { label: "上海", value: 999 },
      ],
    },
    BAR_USER,
  );
  assert.ok(
    fabricated.some((e) => /999/.test(e)),
    fabricated.join("; "),
  );
  // counter 值与 line 值同样受闸。
  assert.ok(
    verifySourcedNumbers(COUNTER_IR, "每天喝水").length > 0,
    "counter 编造值应被拒",
  );
  assert.deepEqual(
    verifySourcedNumbers(COUNTER_IR, "建议每天约1500毫升"),
    [],
  );
  assert.deepEqual(
    verifySourcedNumbers(LINE_IR, "一月2度，七月28度"),
    [],
  );
});

test("N4 时长下限：图表镜头按组件时序延长", () => {
  const v = validateSemanticShot({ ...BAR_IR, durationMs: 2000 });
  assert.ok(v.ok);
  const c = compileSemanticShot(v.shot, 5020);
  // 3 柱：900(生长) + 2×90(逐柱) + 300(值淡入) + 400(停留) = 1780。
  assert.ok(c.plan.spec.durationMs >= 1780, `${c.plan.spec.durationMs}`);
});
