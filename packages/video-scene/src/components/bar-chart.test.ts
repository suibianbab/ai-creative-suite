import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegistry } from "../default-registry.js";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import { validateSceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { emUnits } from "../text-width.js";
import { barChart } from "./bar-chart.js";

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
    componentId: "bar-chart",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "四种方案对比",
  bars: [
    { label: "甲", value: 30 },
    { label: "乙", value: 60 },
    { label: "丙", value: 20 },
  ],
  barColor: "#2f6f4f",
  accentColor: "#d9822b",
  textColor: "#1b2c29",
  enterMs: 1000,
};

// 收集指定 tag 的节点；柱矩形 = 嵌套 svg 内的 rect（背景 rect 在嵌套 svg 之外）
function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

function barRects(node: SvgNode): SvgNode[] {
  const nested = collect(node, "svg")[0]!;
  return collect(nested, "rect");
}

test("柱高按值比例：t 足够大时 h = value/yMax×650（yMax = max×1.1）", () => {
  const node = barChart.render(
    specWith({ ...BASE }),
    makeCtx({ frame: 24 * 5 }),
  );
  const rects = barRects(node);
  assert.equal(rects.length, 3);
  const yMax = 60 * 1.1;
  const expected = [(30 / yMax) * 650, (60 / yMax) * 650, (20 / yMax) * 650];
  rects.forEach((rect, i) => {
    const h = rect.attrs.height as number;
    assert.ok(
      Math.abs(h - expected[i]!) < 1e-9,
      `bar ${i}: ${h} ≠ ${expected[i]}`,
    );
  });
});

test("最大柱用 accentColor，其余用 barColor", () => {
  const node = barChart.render(
    specWith({ ...BASE }),
    makeCtx({ frame: 24 * 5 }),
  );
  const fills = barRects(node).map((rect) => rect.attrs.fill);
  assert.deepEqual(fills, ["#2f6f4f", "#d9822b", "#2f6f4f"]);
});

test("t=0：全部柱高 0；梯次延迟下 tMs=50 时柱 0 已动、柱 1 未动", () => {
  const spec = specWith({ ...BASE });
  const at0 = barRects(barChart.render(spec, makeCtx({ frame: 0 })));
  for (const rect of at0) assert.equal(rect.attrs.height, 0);
  const at50ms = barRects(
    barChart.render(spec, makeCtx({ frame: 24 * (50 / 1000) })),
  );
  assert.ok((at50ms[0]!.attrs.height as number) > 0, "柱 0 应已生长");
  assert.equal(at50ms[1]!.attrs.height, 0, "柱 1 延迟 90ms 未到");
});

test("值标签在柱完成后 300ms 淡入：完成前 opacity 0，之后 >0", () => {
  const spec = specWith({ ...BASE });
  const valuesBefore = collect(
    barChart.render(spec, makeCtx({ frame: 24 * 0.8 })),
    "text",
  ).filter((t) => t.text === "60");
  assert.equal(valuesBefore[0]!.attrs.opacity, 0);
  const valuesAfter = collect(
    barChart.render(spec, makeCtx({ frame: 24 * 1.5 })),
    "text",
  ).filter((t) => t.text === "60");
  assert.ok((valuesAfter[0]!.attrs.opacity as number) > 0);
});

test("背景为首个子节点（fill = spec.background），标题存在且居中", () => {
  const node = barChart.render(specWith({ ...BASE }), makeCtx({ frame: 0 }));
  const bg = node.children![0]!;
  assert.equal(bg.tag, "rect");
  assert.equal(bg.attrs.fill, "#ffffff");
  const title = collect(node, "text").find((t) => t.text === "四种方案对比")!;
  assert.equal(title.attrs.x, 500);
  assert.equal(title.attrs["text-anchor"], "middle");
});

test("竖版图表、数值和季度标签使用画布安全区", () => {
  const bars = [
    { label: "一季度", value: 32 },
    { label: "二季度", value: 46 },
    { label: "三季度", value: 58 },
    { label: "四季度", value: 82 },
  ];
  const node = barChart.render(
    specWith({ ...BASE, bars }),
    makeCtx({ width: 720, height: 1280, frame: 72 }),
  );
  assert.equal(
    collect(node, "svg").length,
    0,
    "竖版不应被方形 viewBox 缩成小图",
  );
  const barNodes = collect(node, "rect").filter(
    (rect) => rect.attrs.fill !== "#ffffff",
  );
  assert.equal(barNodes.length, 4);
  for (const rect of barNodes) {
    assert.ok((rect.attrs.x as number) >= 72);
    assert.ok((rect.attrs.x as number) + (rect.attrs.width as number) <= 648);
  }
  for (const text of collect(node, "text")) {
    assert.ok(emUnits(text.text!) * (text.attrs["font-size"] as number) <= 576);
    assert.ok((text.attrs.y as number) >= 128);
    assert.ok((text.attrs.y as number) <= 1152);
  }
});

test("全零数据：yMax 归一为 1，柱高 0，attrs 无 NaN（Review Focus#1）", () => {
  const node = barChart.render(
    specWith({
      ...BASE,
      bars: [
        { label: "甲", value: 0 },
        { label: "乙", value: 0 },
      ],
    }),
    makeCtx({ frame: 24 * 5 }),
  );
  for (const rect of barRects(node)) assert.equal(rect.attrs.height, 0);
  const json = JSON.stringify(node);
  assert.ok(!json.includes("NaN"), "输出含 NaN");
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    barChart.render(spec, makeCtx({ frame: 12 })),
    barChart.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：bars 空/超 8、label 空/超 12、value 负/NaN/超 1e12、title 超 40、enterMs 越界、颜色非 hex 全拒绝", () => {
  assert.throws(() => barChart.validateParams({ ...BASE, bars: [] }), /bars/);
  assert.throws(
    () =>
      barChart.validateParams({
        ...BASE,
        bars: Array.from({ length: 9 }, () => ({ label: "x", value: 1 })),
      }),
    /bars/,
  );
  assert.throws(
    () => barChart.validateParams({ ...BASE, bars: [{ label: "", value: 1 }] }),
    /label/,
  );
  assert.throws(
    () =>
      barChart.validateParams({
        ...BASE,
        bars: [{ label: "一二三四五六七八九十甲乙丙", value: 1 }],
      }),
    /label/,
  );
  assert.throws(
    () =>
      barChart.validateParams({ ...BASE, bars: [{ label: "x", value: -1 }] }),
    /value/,
  );
  assert.throws(
    () =>
      barChart.validateParams({
        ...BASE,
        bars: [{ label: "x", value: Number.NaN }],
      }),
    /value/,
  );
  assert.throws(
    () =>
      barChart.validateParams({ ...BASE, bars: [{ label: "x", value: 1e13 }] }),
    /value/,
  );
  assert.throws(
    () => barChart.validateParams({ ...BASE, title: "一".repeat(41) }),
    /title/,
  );
  assert.throws(
    () => barChart.validateParams({ ...BASE, enterMs: 199 }),
    /enterMs/,
  );
  assert.throws(
    () => barChart.validateParams({ ...BASE, enterMs: 6001 }),
    /enterMs/,
  );
  assert.throws(
    () => barChart.validateParams({ ...BASE, barColor: "green" }),
    /barColor/,
  );
});

// P2-2：bar-chart cnUnits/valueSuffix opt-in（缺省原样）。
test("cnUnits=true 柱值显示万记法；缺省原数字", () => {
  const spec = (extra: Record<string, unknown>) => {
    const base = {
      specVersion: 1,
      componentId: "bar-chart",
      componentVersion: 1,
      durationMs: 3000,
      seed: 7,
      background: "#101f34",
      params: {
        title: "骑行量",
        bars: [
          { label: "之前", value: 1200000 },
          { label: "之后", value: 3500000 },
        ],
        barColor: "#4f8fd6",
        accentColor: "#f5b652",
        textColor: "#f3f5f7",
        enterMs: 900,
        ...extra,
      },
    };
    return validateSceneSpec(base, defaultRegistry);
  };
  const collect = (node: unknown): string[] => {
    const out: string[] = [];
    const walk = (n: { tag?: string; text?: string; children?: unknown[] }) => {
      if (n.tag === "text" && typeof n.text === "string") out.push(n.text);
      for (const c of n.children ?? []) walk(c as never);
    };
    walk(node as never);
    return out;
  };
  const ctx = {
    frame: 71,
    fps: 24,
    durationFrames: 72,
    width: 1280,
    height: 720,
    random: { r: () => 0.5 },
  };
  const withUnits = collect(
    barChart.render(spec({ cnUnits: true }), ctx as never),
  );
  if (!withUnits.some((t) => t.includes("120万")))
    throw new Error("cnUnits 应显示 120万: " + withUnits.join("|"));
  const without = collect(barChart.render(spec({}), ctx as never));
  if (!without.some((t) => t.includes("1200000")))
    throw new Error("缺省应保持原数字");
  const portrait = collect(
    barChart.render(spec({ cnUnits: true }), {
      ...ctx,
      width: 720,
      height: 1280,
    } as never),
  );
  if (!portrait.some((t) => t.includes("120万")))
    throw new Error("竖版 cnUnits 也应显示 120万: " + portrait.join("|"));
});
