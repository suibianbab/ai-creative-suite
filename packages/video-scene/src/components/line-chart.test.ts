import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { emUnits } from "../text-width.js";
import { lineChart } from "./line-chart.js";

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

function specWith(params: Record<string, unknown>): SceneSpec {
  return {
    specVersion: 1,
    componentId: "line-chart",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "年产量趋势",
  points: [
    { label: "第1年", value: 12 },
    { label: "第2年", value: 20 },
    { label: "第3年", value: 16 },
    { label: "第4年", value: 30 },
  ],
  lineColor: "#2f6f4f",
  markerColor: "#d9822b",
  textColor: "#1b2c29",
  drawMs: 1600,
};

function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

test("t=0 时 dashoffset=1（未画），t≥drawMs 时 dashoffset=0（画完）", () => {
  const spec = specWith({ ...BASE });
  const at0 = collect(
    lineChart.render(spec, makeCtx({ frame: 0 })),
    "path",
  )[0]!;
  assert.equal(at0.attrs["stroke-dashoffset"], 1);
  const done = collect(
    lineChart.render(spec, makeCtx({ frame: 24 * 3 })),
    "path",
  )[0]!;
  assert.equal(done.attrs["stroke-dashoffset"], 0);
});

test("折线路径首尾端点坐标按值映射（yMax = max×1.1）", () => {
  const node = lineChart.render(specWith({ ...BASE }), makeCtx({ frame: 0 }));
  const d = collect(node, "path")[0]!.attrs.d as string;
  const yMax = 30 * 1.1;
  const firstY = 850 - (12 / yMax) * 650;
  const lastY = 850 - (30 / yMax) * 650;
  assert.ok(d.startsWith(`M120.00 ${firstY.toFixed(2)}`), d);
  assert.ok(d.endsWith(`L880.00 ${lastY.toFixed(2)}`), d);
});

test("竖版折线、标题和端点标签落在安全区", () => {
  const node = lineChart.render(
    specWith({ ...BASE, title: "年度产量变化趋势及目标进展" }),
    makeCtx({ width: 720, height: 1280, frame: 72 }),
  );
  assert.equal(collect(node, "svg").length, 0);
  const points = collect(node, "circle");
  assert.equal(points.length, 4);
  for (const point of points) {
    assert.ok((point.attrs.cx as number) >= 72);
    assert.ok((point.attrs.cx as number) <= 648);
    assert.ok((point.attrs.cy as number) >= 128);
    assert.ok((point.attrs.cy as number) <= 1152);
  }
  for (const label of collect(node, "text")) {
    const x = label.attrs.x as number;
    const size = label.attrs["font-size"] as number;
    const width = emUnits(label.text!) * size;
    const anchor = label.attrs["text-anchor"];
    const left =
      anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    const right = left + width;
    assert.ok(left >= 72 - 1e-6, `${label.text}: ${left}`);
    assert.ok(right <= 648 + 1e-6, `${label.text}: ${right}`);
  }
});

test("数据点圆标随描画进度弹出：t=0 全 r=0，中期首点已现而末点未现，末帧全部 r=9", () => {
  const spec = specWith({ ...BASE });
  const radiiAt = (frame: number) =>
    collect(lineChart.render(spec, makeCtx({ frame })), "circle").map(
      (c) => c.attrs.r as number,
    );
  assert.deepEqual(radiiAt(0), [0, 0, 0, 0]);
  const mid = radiiAt(24 * 0.5); // drawMs=1600 → progress=easeOutCubic(0.3125)≈0.675
  assert.ok(mid[0]! > 0, "首点应已出现");
  assert.equal(mid[3]!, 0, "末点（frac=1）不应出现");
  assert.deepEqual(radiiAt(24 * 3), [9, 9, 9, 9]);
});

test("x 轴标签：有标签点渲染、无标签点跳过、超 6 字符截断加 …", () => {
  const spec = specWith({
    ...BASE,
    points: [
      { value: 1 },
      { label: "第2年", value: 2 },
      { label: "一二三四五六七八", value: 3 },
    ],
  });
  const texts = collect(
    lineChart.render(spec, makeCtx({ frame: 0 })),
    "text",
  ).map((t) => t.text);
  assert.ok(texts.includes("第2年"), "有标签点应在 t=0 渲染 x 标签");
  assert.ok(texts.includes("一二三四五六…"), "超长标签应截断");
  assert.ok(!texts.includes("一二三四五六七八"));
  // 无标签点：不产生空文本节点
  assert.ok(!texts.includes(""));
});

test("全零数据：折线为水平基线线段、无 NaN", () => {
  const node = lineChart.render(
    specWith({
      ...BASE,
      points: [{ value: 0 }, { value: 0 }, { value: 0 }],
    }),
    makeCtx({ frame: 24 * 3 }),
  );
  const d = collect(node, "path")[0]!.attrs.d as string;
  assert.ok(d.includes("850.00"), `全零应贴基线: ${d}`);
  assert.ok(!JSON.stringify(node).includes("NaN"));
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    lineChart.render(spec, makeCtx({ frame: 12 })),
    lineChart.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：points 少于 2/超 12、label 超 12、value 负/非有限、drawMs 越界、颜色非 hex 拒绝", () => {
  assert.throws(
    () => lineChart.validateParams({ ...BASE, points: [{ value: 1 }] }),
    /points/,
  );
  assert.throws(
    () =>
      lineChart.validateParams({
        ...BASE,
        points: Array.from({ length: 13 }, (_, i) => ({ value: i })),
      }),
    /points/,
  );
  assert.throws(
    () =>
      lineChart.validateParams({
        ...BASE,
        points: [
          { label: "一二三四五六七八九十一二三", value: 1 },
          { value: 2 },
        ],
      }),
    /label/,
  );
  assert.throws(
    () =>
      lineChart.validateParams({
        ...BASE,
        points: [{ value: -1 }, { value: 2 }],
      }),
    /value/,
  );
  assert.throws(
    () =>
      lineChart.validateParams({
        ...BASE,
        points: [{ value: Number.POSITIVE_INFINITY }, { value: 2 }],
      }),
    /value/,
  );
  assert.throws(
    () => lineChart.validateParams({ ...BASE, drawMs: 199 }),
    /drawMs/,
  );
  assert.throws(
    () => lineChart.validateParams({ ...BASE, lineColor: "#fff" }),
    /lineColor/,
  );
});
