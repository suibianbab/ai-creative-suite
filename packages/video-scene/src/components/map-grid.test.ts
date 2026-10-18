import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { hexLerp, mapGrid } from "./map-grid.js";

// collect 为各组件测试私有惯例（bar/line/counter 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "六大区分布",
  regions: [
    { label: "甲", row: 0, col: 0, value: 10 },
    { label: "乙", row: 1, col: 2, value: 50 },
  ],
  baseColor: "#000000",
  highlightColor: "#ffffff",
  textColor: "#1b2c29",
  enterMs: 200,
};

function specWith(params: unknown) {
  return {
    componentId: "map-grid",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 24,
    fps: 24,
    width: 1920,
    height: 1080,
    ...overrides,
  } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...BASE, regions: [] }, /regions 必须是 1\.\.24 个/],
    [
      {
        ...BASE,
        regions: Array.from({ length: 25 }, (_, i) => ({
          label: `R${i}`,
          row: 0,
          col: 0,
        })),
      },
      /regions 必须是 1\.\.24 个/,
    ],
    [
      { ...BASE, regions: [{ label: "", row: 0, col: 0 }] },
      /label 必须是 1\.\.8 个字符/,
    ],
    [
      { ...BASE, regions: [{ label: "一二三四五六七八九", row: 0, col: 0 }] },
      /label 必须是 1\.\.8 个字符/,
    ],
    [
      { ...BASE, regions: [{ label: "甲", row: 1.5, col: 0 }] },
      /row \/ col 必须是 0\.\.7 的整数/,
    ],
    [
      { ...BASE, regions: [{ label: "甲", row: 0, col: 8 }] },
      /row \/ col 必须是 0\.\.7 的整数/,
    ],
    [
      { ...BASE, regions: [{ label: "甲", row: 0, col: 0, value: -1 }] },
      /value 必须是 0\.\.1e12 的数/,
    ],
    [{ ...BASE, baseColor: "red" }, /baseColor 必须是 #rrggbb/],
    [{ ...BASE, enterMs: 100 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => mapGrid.validateParams(params), re);
  }
});

test("hexLerp：端点、中点、越界钳制", () => {
  assert.equal(hexLerp("#000000", "#ffffff", 0), "#000000");
  assert.equal(hexLerp("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(hexLerp("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(hexLerp("#000000", "#ffffff", 2), "#ffffff");
  assert.equal(hexLerp("#102030", "#304050", 0.5), "#203040");
});

test("网格几何：row/col 唯一决定块位置与尺寸，网格整体居中", () => {
  // 区 x 140..860（宽 720）、y 220..820（高 600）；rows=2, cols=3
  // cell = min(720/3, 600/2) = 240；块 = 240×0.86 = 206.4
  // ox = 140 + (720-720)/2 = 140；oy = 220 + (600-480)/2 = 280
  const node = mapGrid.render(specWith(BASE) as never, makeCtx());
  const rects = collect(node, "rect");
  // 背景 rect + 2 块
  assert.equal(rects.length, 3);
  const a = rects[1]!.attrs;
  const b = rects[2]!.attrs;
  // 甲 (0,0)：cx = 140+120=260, cy = 280+120=400
  assert.equal(a.x, 260 - 206.4 / 2);
  assert.equal(a.y, 400 - 206.4 / 2);
  assert.equal(a.width, 206.4);
  assert.equal(a.height, 206.4);
  // 乙 (1,2)：cx = 140+2×240+120=740, cy = 280+240+120=640
  assert.equal(b.x, 740 - 206.4 / 2);
  assert.equal(b.y, 640 - 206.4 / 2);
});

test("单区域几何：不除零、块居中", () => {
  const node = mapGrid.render(
    specWith({ ...BASE, regions: [{ label: "孤", row: 0, col: 0 }] }) as never,
    makeCtx(),
  );
  const rects = collect(node, "rect");
  // rows=1, cols=1 → cell = min(720,600)=600；块 516；ox=140+60=200, oy=220
  assert.equal(rects[1]!.attrs.width, 516);
  assert.ok(!JSON.stringify(node).includes("NaN"));
});

test("无值区域全 baseColor；value=0 也映射 baseColor（t=0）", () => {
  const noValue = mapGrid.render(
    specWith({ ...BASE, regions: [{ label: "甲", row: 0, col: 0 }] }) as never,
    makeCtx(),
  );
  assert.equal(collect(noValue, "rect")[1]!.attrs.fill, "#000000");
  const zero = mapGrid.render(
    specWith({
      ...BASE,
      regions: [{ label: "甲", row: 0, col: 0, value: 0 }],
    }) as never,
    makeCtx(),
  );
  assert.equal(collect(zero, "rect")[1]!.attrs.fill, "#000000");
});

test("choropleth：value/maxValue 决定插值色（max 本身 t=1/1.1）", () => {
  const node = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 120 }));
  const fills = collect(node, "rect")
    .slice(1)
    .map((r) => r.attrs.fill);
  // maxValue = 50×1.1 = 55 → 乙 t = 50/55 = 10/11
  assert.equal(fills[1], hexLerp("#000000", "#ffffff", 10 / 11));
});

test("梯次淡入：逐块 90ms 延迟；标签在块完成后 300ms 淡入", () => {
  // enterMs=200；tMs=100 → 甲 appear=easeOutCubic(0.5)≈0.875，
  // 乙 delay=90 → easeOutCubic(0.05)=1-0.95³
  const mid = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 2.4 }));
  const opacities = collect(mid, "rect")
    .slice(1)
    .map((r) => r.attrs.opacity);
  assert.ok(Math.abs((opacities[0] as number) - 0.875) < 1e-9);
  assert.ok(Math.abs((opacities[1] as number) - (1 - 0.95 ** 3)) < 1e-9);
  const midTexts = collect(mid, "text").map((t) => t.attrs.opacity);
  assert.equal(midTexts.filter((o) => (o as number) === 0).length >= 1, true);
  const end = mapGrid.render(specWith(BASE) as never, makeCtx({ frame: 72 }));
  assert.deepEqual(
    collect(end, "rect")
      .slice(1)
      .map((r) => r.attrs.opacity),
    [1, 1],
  );
  assert.deepEqual(
    collect(end, "text")
      .filter((t) => t.text !== BASE.title)
      .map((t) => t.attrs.opacity),
    [1, 1],
  );
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(
    mapGrid.render(s, makeCtx({ frame: 13 })),
    mapGrid.render(s, makeCtx({ frame: 13 })),
  );
});

test("全零值守卫：maxValue 归一 1、无 NaN", () => {
  const node = mapGrid.render(
    specWith({
      ...BASE,
      regions: [
        { label: "甲", row: 0, col: 0, value: 0 },
        { label: "乙", row: 0, col: 1, value: 0 },
      ],
    }) as never,
    makeCtx({ frame: 72 }),
  );
  assert.ok(!JSON.stringify(node).includes("NaN"));
});
