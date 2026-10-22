import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { lineChart, lineChartLabelDisplay } from "./line-chart.js";

// 双画幅版式覆写（2026-10-23 brief §三B 折线图轴标签可读性）：
// labelStep 显示间隔（index%step===0 或末点恒显）、shortLabels 逐项短标签
// （原样显示、绕过既有 >6 字截断）；数据值与未覆写标签的行为不变。

function makeCtx(over: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 0,
    fps: 24,
    durationFrames: 288,
    width: 1280,
    height: 720,
    random: seededRandom(1),
    ...over,
  };
}

// 12 点、标签 ≥7 字（触发既有 >6 字截断）——brief 指名的真实压力案例。
const LONG_POINTS = Array.from({ length: 12 }, (_, index) => ({
  label: `第${index + 1}季度表现`,
  value: (index + 1) * 10,
}));

function specWith(
  params: Record<string, unknown>,
  layout?: SceneSpec["layout"],
): SceneSpec {
  const spec: SceneSpec = {
    specVersion: 1,
    componentId: "line-chart",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params: {
      lineColor: "#2563eb",
      markerColor: "#dc2626",
      textColor: "#111111",
      drawMs: 2000,
      ...params,
    },
  };
  return layout ? { ...spec, layout } : spec;
}

function labelNodes(node: SvgNode): SvgNode[] {
  // 折线图两层结构：背景 rect + （横版嵌套 svg）。标签 = 除标题外的全部 text。
  const found: SvgNode[] = [];
  const walk = (current: SvgNode) => {
    if (current.tag === "text" && current.text !== "压力") found.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

test("lineChartLabelDisplay：labelStep=2 → 0,2,4,6,8,10 与末点 11", () => {
  const display = lineChartLabelDisplay(LONG_POINTS, { labelStep: 2 });
  const shown = display.filter((item) => item.show).map((item) => item.index);
  assert.deepEqual(shown, [0, 2, 4, 6, 8, 10, 11]);
  assert.equal(
    display.find((item) => item.index === 3)!.text,
    "第4季度表现",
    "6 字标签不截断",
  );
  assert.equal(
    display.find((item) => item.index === 9)!.text,
    "第10季度表…",
    "7 字标签（≥10 下标）仍按既有 >6 字截断",
  );
});

test("lineChartLabelDisplay：shortLabels 原样显示且不截断", () => {
  const display = lineChartLabelDisplay(LONG_POINTS, {
    shortLabels: [{ index: 1, text: "Q2'25 首季" }],
  });
  assert.equal(display.find((item) => item.index === 1)!.text, "Q2'25 首季");
  assert.equal(
    display.find((item) => item.index === 2)!.text,
    "第3季度表现",
    "未覆写 6 字标签原样",
  );
});

test("横版 labelStep=2：只渲染间隔命中的标签；path/marker 不受影响", () => {
  const plain = specWith({ title: "压力", points: LONG_POINTS });
  const stepped = specWith(
    { title: "压力", points: LONG_POINTS },
    { portrait: { labelStep: 2 }, landscape: { labelStep: 2 } },
  );
  const ctx = makeCtx({ frame: 96 });
  const plainNode = lineChart.render(plain, ctx);
  const steppedNode = lineChart.render(stepped, ctx);
  assert.equal(labelNodes(plainNode).length, 12);
  const shownTexts = labelNodes(steppedNode).map((node) => node.text);
  assert.equal(shownTexts.length, 7);
  assert.ok(shownTexts.includes("第1季度表现"));
  assert.ok(!shownTexts.includes("第2季度表现"));
  assert.ok(shownTexts.includes("第12季度表…"), "末点恒显（>6 字仍截断）");
  // 折线与圆标：节点数量与坐标逐项一致（覆写只动标签层）。
  const pathOf = (node: SvgNode) => collect(node, "path")[0]!;
  assert.deepEqual(pathOf(steppedNode).attrs, pathOf(plainNode).attrs);
  const markerOf = (node: SvgNode) =>
    collect(node, "circle").map((m) => JSON.stringify(m.attrs));
  assert.deepEqual(markerOf(steppedNode), markerOf(plainNode));
});

function collect(node: SvgNode, tag: string): SvgNode[] {
  const found: SvgNode[] = [];
  const walk = (current: SvgNode) => {
    if (current.tag === tag) found.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

test("竖版 shortLabels + labelStep 并用", () => {
  const spec = specWith(
    { title: "压力", points: LONG_POINTS },
    {
      portrait: {
        labelStep: 3,
        shortLabels: [
          { index: 0, text: "Q1" },
          { index: 11, text: "Q4终" },
        ],
      },
    },
  );
  const node = lineChart.render(spec, makeCtx({ width: 720, height: 1280 }));
  const texts = labelNodes(node).map((n) => n.text);
  assert.deepEqual(texts, [
    "Q1",
    "第4季度表现",
    "第7季度表现",
    "第10季度表…",
    "Q4终",
  ]);
});

test("覆写只影响目标画幅：另一画幅标签与无 layout 一致", () => {
  const plain = specWith({ title: "压力", points: LONG_POINTS });
  const portraitOnly = specWith(
    { title: "压力", points: LONG_POINTS },
    { portrait: { labelStep: 2 } },
  );
  const ctx = makeCtx({ frame: 96 });
  assert.deepEqual(
    labelNodes(lineChart.render(plain, ctx)).map((n) => n.text),
    labelNodes(lineChart.render(portraitOnly, ctx)).map((n) => n.text),
  );
});

test("validateLayout：合法通过，非法边界拒绝", () => {
  const check = (
    layout: unknown,
    params: Record<string, unknown> = { title: "压力", points: LONG_POINTS },
  ) => lineChart.validateLayout!(layout, params);
  check({});
  check({ labelStep: 1 });
  check({ labelStep: 12 });
  check({ shortLabels: [{ index: 0, text: "Q1" }] });
  check({
    labelStep: 2,
    shortLabels: [{ index: 11, text: "Q4" }],
  });
  assert.throws(() => check({ labelStep: 0 }), /labelStep/);
  assert.throws(() => check({ labelStep: 13 }), /labelStep/);
  assert.throws(() => check({ labelStep: 1.5 }), /labelStep/);
  assert.throws(
    () => check({ shortLabels: [{ index: 12, text: "x" }] }),
    /index/,
  );
  assert.throws(
    () =>
      check({
        shortLabels: [
          { index: 1, text: "a" },
          { index: 1, text: "b" },
        ],
      }),
    /index/,
  );
  assert.throws(() => check({ shortLabels: [{ index: 1, text: "" }] }), /text/);
  assert.throws(
    () => check({ shortLabels: [{ index: 1, text: "x".repeat(13) }] }),
    /text/,
  );
  assert.throws(() => check({ foo: 1 }), /foo/);
});
