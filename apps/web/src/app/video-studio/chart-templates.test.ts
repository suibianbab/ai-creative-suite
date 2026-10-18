import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyChartTemplate,
  buildChartRevisePatch,
  CHART_TEMPLATES,
  draftChartFromSpec,
  isChartComponentId,
} from "./chart-templates.js";

const SPEC: SceneSpec = {
  specVersion: 1,
  componentId: "text-animation",
  componentVersion: 1,
  durationMs: 3000,
  seed: 42,
  background: "#f4f7f5",
  params: {
    title: "原标题",
    titleColor: "#1b2c29",
    subtitleColor: "#5d7469",
    entrance: "fade-up",
    enterMs: 800,
  },
};

test("CHART_TEMPLATES：5 个起点模板，id/组件/label 齐全且 params 过校验", () => {
  assert.equal(CHART_TEMPLATES.length, 5);
  const ids = new Set(CHART_TEMPLATES.map((t) => t.templateId));
  assert.deepEqual([...ids].sort(), [
    "bar-compare-4",
    "bar-rank-6",
    "counter-kpi",
    "counter-percent",
    "line-trend-8",
  ]);
  for (const template of CHART_TEMPLATES) {
    assert.ok(template.label.length > 0);
    const applied = applyChartTemplate(SPEC, template.templateId);
    assert.equal(applied.error, null, `${template.templateId} 应可用`);
  }
});

test("isChartComponentId：三图表组件为 true，其余 false", () => {
  assert.equal(isChartComponentId("bar-chart"), true);
  assert.equal(isChartComponentId("line-chart"), true);
  assert.equal(isChartComponentId("number-counter"), true);
  assert.equal(isChartComponentId("text-animation"), false);
  assert.equal(isChartComponentId("line-drawing"), false);
});

test("applyChartTemplate：换组件保 durationMs/background/seed，未知 id 报错", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4");
  assert.equal(applied.error, null);
  assert.equal(applied.spec!.componentId, "bar-chart");
  assert.equal(applied.spec!.componentVersion, 1);
  assert.equal(applied.spec!.durationMs, 3000);
  assert.equal(applied.spec!.background, "#f4f7f5");
  assert.equal(applied.spec!.seed, 42);
  const unknown = applyChartTemplate(SPEC, "no-such-template");
  assert.equal(unknown.spec, null);
  assert.match(unknown.error!, /未知图表模板/);
});

test("applyChartTemplate 深拷贝：改产物 params 不污染模板库", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const bars = applied.params as { bars: Array<{ label: string }> };
  bars.bars[0]!.label = "污染";
  const again = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  assert.equal(
    (again.params as { bars: Array<{ label: string }> }).bars[0]!.label,
    "甲",
  );
});

test("round-trip：draftChartFromSpec(applyChartTemplate(...)) 回读模板数据（Review Focus#2）", () => {
  const bar = draftChartFromSpec(
    applyChartTemplate(SPEC, "bar-compare-4").spec!,
  );
  assert.equal(bar.title, "四种方案对比");
  assert.equal(bar.data, "甲,30\n乙,48\n丙,22\n丁,40");
  const line = draftChartFromSpec(
    applyChartTemplate(SPEC, "line-trend-8").spec!,
  );
  assert.equal(line.data.split("\n").length, 8);
  assert.ok(line.data.startsWith("第1年,12\n"));
  const counter = draftChartFromSpec(
    applyChartTemplate(SPEC, "counter-kpi").spec!,
  );
  assert.equal(counter.value, "250000");
  assert.equal(counter.suffix, "+");
});

test("buildChartRevisePatch：bar 数据合法修改生效", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "四季降水",
    data: "春,12\n夏,28\n秋,21\n冬,8",
  });
  assert.equal(next.error, null);
  const bars = (
    next.spec!.params as { bars: Array<{ label: string; value: number }> }
  ).bars;
  assert.deepEqual(bars, [
    { label: "春", value: 12 },
    { label: "夏", value: 28 },
    { label: "秋", value: 21 },
    { label: "冬", value: 8 },
  ]);
  assert.equal((next.spec!.params as { title: string }).title, "四季降水");
  // 未改字段保留基底（颜色/enterMs）
  assert.equal((next.spec!.params as { enterMs: number }).enterMs, 1200);
});

test("buildChartRevisePatch：行格式错误带行号定位、越界行数拒绝（Review Focus#5 混合行）", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const bad = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "甲,30\n乙 xyz\n丙,20",
  });
  assert.equal(bad.spec, null);
  assert.match(bad.error!, /第 2 行/);
  const empty = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "",
  });
  assert.match(empty.error!, /bars/);
  const tooMany = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: Array.from({ length: 9 }, (_, i) => `项${i},1`).join("\n"),
  });
  assert.match(tooMany.error!, /bars/);
  // line 混合标签行：裸数值行合法
  const lineSpec = applyChartTemplate(SPEC, "line-trend-8").spec!;
  const mixed = buildChartRevisePatch(lineSpec, {
    ...draftChartFromSpec(lineSpec),
    data: "12\n第2年,20\n16",
  });
  assert.equal(mixed.error, null);
  const points = (
    mixed.spec!.params as {
      points: Array<{ label?: string; value: number }>;
    }
  ).points;
  assert.deepEqual(points, [
    { value: 12 },
    { label: "第2年", value: 20 },
    { value: 16 },
  ]);
});

test("buildChartRevisePatch：空行跳过、CRLF 容忍、尾随空白 trim（Review Focus#4）", () => {
  const applied = applyChartTemplate(SPEC, "bar-compare-4").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    data: "甲,30\r\n\r\n  乙,48  \n  \n丙,22\n丁,40\n",
  });
  assert.equal(next.error, null);
  const bars = (next.spec!.params as { bars: Array<{ label: string }> }).bars;
  assert.deepEqual(
    bars.map((b) => b.label),
    ["甲", "乙", "丙", "丁"],
  );
});

test("buildChartRevisePatch：counter 数值/前缀/后缀/标题修改与非法拒绝", () => {
  const applied = applyChartTemplate(SPEC, "counter-percent").spec!;
  const next = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "合格率",
    value: "99.9",
    prefix: "约 ",
    suffix: "%",
  });
  assert.equal(next.error, null);
  const params = next.spec!.params as {
    title: string;
    value: number;
    prefix: string;
  };
  assert.equal(params.title, "合格率");
  assert.equal(params.value, 99.9);
  assert.equal(params.prefix, "约 ");
  const badValue = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    value: "abc",
  });
  assert.match(badValue.error!, /value/);
  const badTitle = buildChartRevisePatch(applied, {
    ...draftChartFromSpec(applied),
    title: "一".repeat(41),
  });
  assert.match(badTitle.error!, /title/);
});

test("buildChartRevisePatch：非图表组件 spec 返回错误", () => {
  const result = buildChartRevisePatch(SPEC, {
    title: "",
    data: "",
    value: "",
    prefix: "",
    suffix: "",
  });
  assert.equal(result.spec, null);
  assert.match(result.error!, /图表/);
});
