import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyLayoutToSpec,
  describeLineChartLabels,
  layoutDraftFromSpec,
  layoutMergeDecision,
  previewLineOverride,
  reconcileLineLayoutDraft,
  withoutLayoutForEdit,
} from "./aspect-layout-edit.js";
import { buildChartRevisePatch } from "./chart-templates.js";
import { buildRevisePatch } from "./shot-edit.js";

// 双画幅版式覆写编辑（2026-10-23 brief §三B）：草稿（表单原始字符串）↔
// spec.layout 的纯转换 + 折线图标签提示数据；落库前整体过 validateSceneSpec。

function textSpec(layout?: SceneSpec["layout"]): SceneSpec {
  const spec: SceneSpec = {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    durationMs: 4000,
    seed: 3,
    background: "#ffffff",
    params: {
      title: "双画幅预览与镜头级微调",
      titleColor: "#111111",
      subtitleColor: "#666666",
      entrance: "fade-up",
      enterMs: 800,
    },
  };
  return layout ? { ...spec, layout } : spec;
}

function lineSpec(layout?: SceneSpec["layout"]): SceneSpec {
  const spec: SceneSpec = {
    specVersion: 1,
    componentId: "line-chart",
    componentVersion: 1,
    durationMs: 4000,
    seed: 3,
    background: "#ffffff",
    params: {
      title: "压力",
      points: Array.from({ length: 12 }, (_, index) => ({
        label: `第${index + 1}季度表现`,
        value: index + 1,
      })),
      lineColor: "#2563eb",
      markerColor: "#dc2626",
      textColor: "#111111",
      drawMs: 2000,
    },
  };
  return layout ? { ...spec, layout } : spec;
}

test("草稿往返：spec.layout → 草稿 → apply 幂等", () => {
  const spec = textSpec({
    portrait: { titleLines: ["双画幅预览", "与镜头级微调"], titleScale: 1.2 },
    landscape: { verticalOffset: -0.1 },
  });
  const draft = layoutDraftFromSpec(spec);
  if (draft.componentId !== "text-animation") {
    assert.fail("text spec 应产出文字覆写草稿");
    return;
  }
  assert.equal(draft.portrait.titleLinesText, "双画幅预览\n与镜头级微调");
  assert.equal(draft.portrait.titleScale, "1.2");
  assert.equal(draft.portrait.verticalOffset, "");
  assert.equal(draft.landscape.verticalOffset, "-0.1");
  const applied = applyLayoutToSpec(spec, draft);
  assert.ok(!("error" in applied) && applied.spec);
  assert.deepEqual(applied.spec.layout, spec.layout);
});

test("无 layout 的 spec → 空草稿；空草稿 apply → 移除 layout 键", () => {
  const withLayout = textSpec({ portrait: { titleScale: 1.1 } });
  const draft = layoutDraftFromSpec(withLayout);
  if (draft.componentId !== "text-animation") {
    assert.fail("text spec 应产出文字覆写草稿");
    return;
  }
  const cleared = applyLayoutToSpec(withLayout, {
    ...draft,
    portrait: { ...draft.portrait, titleScale: "" },
  });
  assert.ok(!("error" in cleared) && cleared.spec);
  assert.equal("layout" in cleared.spec, false);
  assert.equal("layout" in layoutDraftFromSpec(textSpec()), false);
});

test("apply 校验：titleLines 拼接不符 → 中文错误；越界数值 → 错误", () => {
  const spec = textSpec();
  const mismatch = applyLayoutToSpec(spec, {
    componentId: "text-animation",
    portrait: {
      titleLinesText: "别的标题",
      titleScale: "",
      verticalOffset: "",
    },
    landscape: {
      titleLinesText: "",
      titleScale: "",
      verticalOffset: "",
    },
  });
  assert.match("error" in mismatch ? mismatch.error : "", /拼接须与标题一致/);
  const badScale = applyLayoutToSpec(spec, {
    componentId: "text-animation",
    portrait: { titleLinesText: "", titleScale: "1.9", verticalOffset: "" },
    landscape: { titleLinesText: "", titleScale: "", verticalOffset: "" },
  });
  assert.match("error" in badScale ? badScale.error : "", /字号缩放/);
  const badStep = applyLayoutToSpec(lineSpec(), {
    componentId: "line-chart",
    portrait: { labelStepText: "13", shortLabels: {} },
    landscape: { labelStepText: "", shortLabels: {} },
  });
  assert.match("error" in badStep ? badStep.error : "", /标签间隔/);
});

test("apply：line-chart 草稿构造 labelStep + shortLabels 并过校验", () => {
  const applied = applyLayoutToSpec(lineSpec(), {
    componentId: "line-chart",
    portrait: {
      labelStepText: "2",
      shortLabels: { 0: "Q1", 11: "Q4" },
    },
    landscape: { labelStepText: "", shortLabels: {} },
  });
  assert.ok(!("error" in applied) && applied.spec);
  assert.deepEqual(applied.spec.layout, {
    portrait: {
      labelStep: 2,
      shortLabels: [
        { index: 0, text: "Q1" },
        { index: 11, text: "Q4" },
      ],
    },
  });
});

test("不支持覆写的组件：apply 明确报错", () => {
  const barSpec: SceneSpec = {
    ...lineSpec(),
    componentId: "bar-chart",
    params: {
      title: "柱图",
      bars: [
        { label: "Q1", value: 1 },
        { label: "Q2", value: 2 },
      ],
      barColor: "#2563eb",
      accentColor: "#dc2626",
      textColor: "#111111",
      enterMs: 800,
    },
  };
  const result = applyLayoutToSpec(barSpec, {
    componentId: "line-chart",
    portrait: { labelStepText: "1", shortLabels: {} },
    landscape: { labelStepText: "", shortLabels: {} },
  });
  assert.match("error" in result ? result.error : "", /不支持/);
});

test("describeLineChartLabels：隐藏/截断/简写三类提示数据", () => {
  const points = lineSpec().params as {
    points: Array<{ label?: string; value: number }>;
  };
  const described = describeLineChartLabels(
    points,
    {
      portrait: {
        labelStep: 2,
        shortLabels: [{ index: 0, text: "Q1" }],
      },
    },
    "portrait",
  );
  assert.deepEqual(
    described.hidden.map((item) => item.index),
    [1, 3, 5, 7, 9, 10],
  );
  assert.deepEqual(
    described.shortened.map((item) => [item.index, item.to]),
    [[0, "Q1"]],
  );
  assert.deepEqual(
    described.truncated.map((item) => item.index),
    [11],
    "末点仍显示且按旧规则截断，过近的 10 号让位",
  );
  const empty = describeLineChartLabels(points, undefined, "portrait");
  assert.deepEqual(empty.hidden, []);
  assert.deepEqual(empty.shortened, []);
});

test("previewLineOverride：草稿字段的即时提示视图（非法输入静默无提示）", () => {
  assert.equal(
    previewLineOverride({ labelStepText: "", shortLabels: {} }, 12),
    undefined,
  );
  assert.deepEqual(
    previewLineOverride({ labelStepText: "2", shortLabels: { 0: "Q1" } }, 12),
    {
      labelStep: 2,
      shortLabels: [{ index: 0, text: "Q1" }],
    },
  );
  assert.equal(
    previewLineOverride({ labelStepText: "abc", shortLabels: {} }, 12),
    undefined,
    "输入中的非法间隔不提示",
  );
});

test("稀疏标注点不冒充按间隔隐藏", () => {
  const points = [
    { label: "首", value: 1 },
    { value: 2 },
    { label: "", value: 3 },
    { label: "末", value: 4 },
  ];
  assert.deepEqual(
    describeLineChartLabels({ points }, undefined, "portrait").hidden,
    [],
  );
  assert.deepEqual(
    describeLineChartLabels(
      { points },
      { portrait: { labelStep: 2 } },
      "portrait",
    ).hidden,
    [],
  );
});

test("layoutMergeDecision：换模板丢弃覆写；浏览后还原（pendingTemplateId 归空）保留", () => {
  // Issue 1（终评 Important#1）：选中模板又改回「保持当前组件」时，
  // pendingTemplateId 归空 → 既有覆写必须原样并入下一次应用，不得静默丢。
  assert.equal(
    layoutMergeDecision({
      pendingTemplateId: "",
      draftComponentId: "line-chart",
      finalComponentId: "line-chart",
    }),
    true,
    "未选模板 + 同组件 → 并入",
  );
  assert.equal(
    layoutMergeDecision({
      pendingTemplateId: "line-trend-8",
      draftComponentId: "line-chart",
      finalComponentId: "line-chart",
    }),
    false,
    "已选模板（应用即换装）→ 舍弃旧覆写",
  );
  assert.equal(
    layoutMergeDecision({
      pendingTemplateId: "",
      draftComponentId: "line-chart",
      finalComponentId: "bar-chart",
    }),
    false,
    "家族不符 → 不并入",
  );
});

test("buildRevisePatch 保留 spec.layout（文字编辑不清覆写）", () => {
  const spec = textSpec({ portrait: { titleScale: 1.1 } });
  const { patch, error } = buildRevisePatch(
    {
      description: "镜头说明",
      narrationText: "",
      background: "#ffffff",
      durationSeconds: 4,
      title: "双画幅预览与镜头级微调",
      subtitle: "",
      templateAdvanced: false,
    },
    spec,
  );
  assert.equal(error, null);
  assert.deepEqual((patch?.spec as SceneSpec).layout, {
    portrait: { titleScale: 1.1 },
  });
});

test("buildChartRevisePatch 保留 spec.layout（图表数据编辑不清覆写）", () => {
  const spec = lineSpec({ portrait: { labelStep: 2 } });
  const result = buildChartRevisePatch(spec, {
    title: "压力",
    data: Array.from(
      { length: 12 },
      (_, i) => `第${i + 1}季度表现,${i + 1}`,
    ).join("\n"),
    value: "0",
    prefix: "",
    suffix: "",
  });
  assert.ok(result.spec);
  assert.deepEqual(result.spec.layout, { portrait: { labelStep: 2 } });
});

test("同次修改标题与换行覆写：只校验合并后的最终 spec", () => {
  const old = textSpec({
    portrait: { titleLines: ["双画幅预览", "与镜头级微调"] },
  });
  const draft = layoutDraftFromSpec(old);
  assert.equal(draft.componentId, "text-animation");
  if (draft.componentId !== "text-animation") return;
  draft.portrait.titleLinesText = "新标题\n继续说明";
  const revised = buildRevisePatch(
    {
      description: "镜头说明",
      narrationText: "",
      background: "#ffffff",
      durationSeconds: 4,
      title: "新标题继续说明",
      subtitle: "",
      templateAdvanced: false,
    },
    withoutLayoutForEdit(old),
  );
  assert.equal(revised.error, null);
  const final = applyLayoutToSpec(revised.patch!.spec as SceneSpec, draft);
  assert.ok(!("error" in final));
  if ("error" in final) return;
  assert.deepEqual(final.spec.layout?.portrait?.titleLines, [
    "新标题",
    "继续说明",
  ]);
  assert.equal(
    (final.spec.params as { title: string }).title,
    "新标题继续说明",
  );
});

test("同次减少折线点数与清理短标签：只校验合并后的最终 spec", () => {
  const old = lineSpec({
    portrait: { shortLabels: [{ index: 11, text: "末" }] },
  });
  const draft = layoutDraftFromSpec(old);
  assert.equal(draft.componentId, "line-chart");
  if (draft.componentId !== "line-chart") return;
  draft.portrait.shortLabels = { 0: "首" };
  const chart = buildChartRevisePatch(withoutLayoutForEdit(old), {
    title: "压力",
    data: "第一点,1\n第二点,2",
    value: "0",
    prefix: "",
    suffix: "",
  });
  assert.equal(chart.error, null);
  const final = applyLayoutToSpec(chart.spec!, draft);
  assert.ok(!("error" in final));
  if ("error" in final) return;
  assert.deepEqual(final.spec.layout?.portrait?.shortLabels, [
    { index: 0, text: "首" },
  ]);
  assert.equal((final.spec.params as { points: unknown[] }).points.length, 2);
});

test("草稿从 12 点减到 6 点：旧末点短标签自动移除且仍能应用", () => {
  const old = lineSpec({
    portrait: { labelStep: 12, shortLabels: [{ index: 11, text: "末" }] },
  });
  const parsed = buildChartRevisePatch(withoutLayoutForEdit(old), {
    title: "压力",
    data: "甲,1\n乙,2\n丙,3\n丁,4\n戊,5\n己,6",
    value: "",
    prefix: "",
    suffix: "",
  });
  assert.equal(parsed.error, null);
  const reconciled = reconcileLineLayoutDraft(layoutDraftFromSpec(old), 6);
  assert.equal(reconciled.removed, 2);
  assert.equal(reconciled.draft?.componentId, "line-chart");
  if (reconciled.draft?.componentId !== "line-chart") return;
  assert.deepEqual(reconciled.draft.portrait.shortLabels, {});
  assert.equal(reconciled.draft.portrait.labelStepText, "");
  const applied = applyLayoutToSpec(parsed.spec!, reconciled.draft);
  assert.ok(!("error" in applied));
});

test("模板浏览后还原：8 点草稿与旧 12 点短标签在应用前同源清理", () => {
  const old = lineSpec({
    portrait: { shortLabels: [{ index: 11, text: "末" }] },
  });
  const templateDraft = {
    title: "压力",
    data: Array.from({ length: 8 }, (_, i) => `第${i + 1}点,${i + 1}`).join(
      "\n",
    ),
    value: "",
    prefix: "",
    suffix: "",
  };
  const chart = buildChartRevisePatch(withoutLayoutForEdit(old), templateDraft);
  assert.equal(chart.error, null);
  const result = reconcileLineLayoutDraft(
    layoutDraftFromSpec(old),
    (chart.spec!.params as { points: unknown[] }).points.length,
  );
  assert.equal(result.removed, 1);
  assert.ok(result.draft);
  const applied = applyLayoutToSpec(chart.spec!, result.draft!);
  assert.ok(!("error" in applied));
});

test("清空的越界短标签不计入已移除的有效覆写", () => {
  const draft = layoutDraftFromSpec(lineSpec());
  if (draft.componentId !== "line-chart") return;
  draft.portrait.shortLabels = { 10: "", 11: "" };
  draft.portrait.labelStepText = "2";
  draft.landscape.labelStepText = "3";
  const result = reconcileLineLayoutDraft(draft, 6);
  assert.equal(result.removed, 0);
  assert.deepEqual(
    result.draft && result.draft.componentId === "line-chart"
      ? result.draft.portrait.shortLabels
      : null,
    {},
  );
});
