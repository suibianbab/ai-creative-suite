import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { mapJourney } from "./map-journey.js";

// collect 为各组件测试私有惯例（bar/line/counter 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "两城行程",
  origin: { label: "甲城", x: 200, y: 500 },
  destination: { label: "乙城", x: 800, y: 500 },
  waypoints: [],
  routeColor: "#2f6f4f",
  markerColor: "#d9822b",
  pinColor: "#c0392b",
  textColor: "#1b2c29",
  drawMs: 1000,
};
const BASE_WP = {
  ...BASE,
  origin: { label: "甲城", x: 200, y: 500 },
  destination: { label: "丁城", x: 800, y: 500 },
  waypoints: [
    { label: "乙站", x: 400, y: 400 },
    { label: "丙站", x: 600, y: 600 },
  ],
};

function specWith(params: unknown) {
  return {
    componentId: "map-journey",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function ctxAt(ms: number): FrameContext {
  // frame 类型为 number（非整数限定）：分数帧 → tMs 精确等于 ms
  return {
    frame: (ms / 1000) * 24,
    fps: 24,
    width: 1920,
    height: 1080,
  } as FrameContext;
}

test("校验表：越界输入逐项拒绝", () => {
  const cases: Array<[unknown, RegExp]> = [
    [
      { ...BASE, origin: { label: "", x: 1, y: 1 } },
      /origin\.label 必须是 1\.\.8 个字符/,
    ],
    [
      { ...BASE, destination: { label: "乙", x: -5, y: 1 } },
      /x \/ y 必须是 0\.\.1000 的数/,
    ],
    [
      {
        ...BASE,
        waypoints: Array.from({ length: 7 }, () => ({ x: 1, y: 1 })),
      },
      /waypoints 必须是 0\.\.6 个/,
    ],
    [
      { ...BASE, waypoints: [{ x: 100, y: 2001 }] },
      /x \/ y 必须是 0\.\.1000 的数/,
    ],
    [{ ...BASE, routeColor: "#12345" }, /routeColor 必须是 #rrggbb/],
    [{ ...BASE, drawMs: 199 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "t".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => mapJourney.validateParams(params), re);
  }
});

test("两点直线路径：d 为 M + 单段 C；marker 等速走弧长（直线可精确断言）", () => {
  const node = mapJourney.render(specWith(BASE) as never, ctxAt(0));
  const paths = collect(node, "path").filter(
    (p) => (p.attrs as { d?: string }).d,
  );
  assert.equal(paths.length, 1);
  const d = paths[0]!.attrs.d as string;
  assert.ok(d.startsWith("M 200.00,500.00 C"));
  assert.equal(d.split(" C ").length, 2);
  // progress=easeOutCubic(0.5)=0.875 → 弧长 0.875×600 → x = 200+525=725
  const mid = mapJourney.render(specWith(BASE) as never, ctxAt(500));
  const marker = collect(mid, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(marker.attrs.cx, 725);
  // 末帧 marker 到终点
  const end = mapJourney.render(specWith(BASE) as never, ctxAt(2000));
  const endMarker = collect(end, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(endMarker.attrs.cx, 800);
});

test("描画进度：dashoffset 1 → 中间 ∈(0,1) → 0", () => {
  const route = (ms: number) =>
    (collect(
      mapJourney.render(specWith(BASE) as never, ctxAt(ms)),
      "path",
    ).find((p) => (p.attrs as { d?: string }).d)!.attrs ?? {}) as Record<
      string,
      number | string
    >;
  assert.equal(route(0)["stroke-dashoffset"], 1);
  const mid = route(500)["stroke-dashoffset"] as number;
  assert.ok(mid > 0 && mid < 1, `mid=${mid}`);
  assert.equal(route(2000)["stroke-dashoffset"], 0);
});

test("waypoint 圆标时窗：末帧全部 r=9（含末点 frac 钳制）", () => {
  const end = mapJourney.render(specWith(BASE_WP) as never, ctxAt(3000));
  const radii = collect(end, "circle")
    .filter((c) => (c.attrs as { fill?: string }).fill === BASE.routeColor)
    .map((c) => c.attrs.r);
  assert.deepEqual(radii, [9, 9]);
});

test("图钉落下窗口：起点 0..20%、终点 60..80%", () => {
  // tMs=100（drawMs×0.1）：origin pinP=easeOutCubic(0.5)≈0.875；dest pin=0
  const early = mapJourney.render(specWith(BASE) as never, ctxAt(100));
  const pins = collect(early, "g").filter((g) =>
    (g.attrs as { transform?: string }).transform
      ?.toString()
      .startsWith("translate"),
  );
  assert.equal(pins.length, 2);
  assert.ok(Math.abs(((pins[0]!.attrs.opacity as number) ?? 0) - 0.875) < 1e-9);
  assert.equal(pins[1]!.attrs.opacity, 0);
  // 末帧：两钉 opacity 1、scale 1
  const end = mapJourney.render(specWith(BASE) as never, ctxAt(2000));
  const endPins = collect(end, "g").filter(
    (g) => typeof (g.attrs as { transform?: string }).transform === "string",
  );
  assert.deepEqual(
    endPins.map((p) => p.attrs.opacity),
    [1, 1],
  );
  for (const p of endPins) {
    assert.ok((p.attrs.transform as string).includes("scale(1.0000)"));
  }
});

test("重合点守卫：origin==destination 无 NaN、marker 停起点", () => {
  const node = mapJourney.render(
    specWith({
      ...BASE,
      destination: { label: "乙城", x: 200, y: 500 },
    }) as never,
    ctxAt(2000),
  );
  assert.ok(!JSON.stringify(node).includes("NaN"));
  const marker = collect(node, "circle").find(
    (c) => (c.attrs as { fill?: string }).fill === BASE.markerColor,
  )!;
  assert.equal(marker.attrs.cx, 200);
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE_WP) as never;
  assert.deepEqual(
    mapJourney.render(s, ctxAt(350)),
    mapJourney.render(s, ctxAt(350)),
  );
});
