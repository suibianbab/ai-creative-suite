import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { flowDiagram } from "./flow-diagram.js";

// collect 为各组件测试私有惯例（bar/line/map 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "两节点连线",
  nodes: [
    { label: "甲", x: 300, y: 300, kind: "box" },
    { label: "乙", x: 700, y: 700, kind: "box" },
  ],
  edges: [{ from: "甲", to: "乙" }],
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
  enterMs: 200,
  drawMs: 400,
};

function specWith(params: unknown) {
  return {
    componentId: "flow-diagram",
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
    [
      { ...BASE, nodes: [{ label: "甲", x: 0, y: 0, kind: "box" }] },
      /nodes 必须是 2\.\.12 个/,
    ],
    [
      {
        ...BASE,
        nodes: Array.from({ length: 13 }, (_, i) => ({
          label: `N${i}`,
          x: 100,
          y: 100,
          kind: "box",
        })),
      },
      /nodes 必须是 2\.\.12 个/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "", x: 0, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /label 必须是 1\.\.6 个字符/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "一二三四五六七", x: 0, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /label 必须是 1\.\.6 个字符/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: 0, y: 0, kind: "box" },
          { label: "甲", x: 100, y: 100, kind: "box" },
        ],
      },
      /nodes\[1\]\.label 与 nodes\[0\] 重复/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: -1, y: 0, kind: "box" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /x \/ y 必须是 0\.\.1000 的数/,
    ],
    [
      {
        ...BASE,
        nodes: [
          { label: "甲", x: 0, y: 0, kind: "circle" },
          { label: "乙", x: 100, y: 100, kind: "box" },
        ],
      },
      /kind 必须是 box 或 diamond/,
    ],
    [{ ...BASE, edges: [] }, /edges 必须是 1\.\.16 条/],
    [
      {
        ...BASE,
        edges: Array.from({ length: 17 }, () => ({ from: "甲", to: "乙" })),
      },
      /edges 必须是 1\.\.16 条/,
    ],
    [
      { ...BASE, edges: [{ from: "丙", to: "乙" }] },
      /from\/to 必须引用已声明节点/,
    ],
    [
      {
        ...BASE,
        edges: [{ from: "甲", to: "乙", label: "一二三四五六七" }],
      },
      /label 必须是 ≤6 个字符/,
    ],
    [{ ...BASE, arrowColor: "blue" }, /arrowColor 必须是 #rrggbb/],
    [{ ...BASE, drawMs: 100 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => flowDiagram.validateParams(params), re);
  }
});

test("节点几何：盒/菱形尺寸恒定，标签居中（settle 帧全局 scale=1）", () => {
  const params = {
    ...BASE,
    nodes: [
      { label: "甲", x: 300, y: 300, kind: "box" },
      { label: "乙", x: 700, y: 700, kind: "diamond" },
    ],
  };
  const node = flowDiagram.render(specWith(params) as never, makeCtx());
  // 根 g + 2 节点 g
  const groups = collect(node, "g");
  assert.equal(groups.length, 3);
  assert.equal(groups[1]!.attrs.transform, "translate(300 300) scale(1.0000)");
  assert.equal(groups[1]!.attrs.opacity, 1);
  const boxRect = collect(groups[1]!, "rect")[0]!.attrs;
  assert.deepEqual(
    [boxRect.x, boxRect.y, boxRect.width, boxRect.height, boxRect.rx],
    [-90, -36, 180, 72, 10],
  );
  assert.equal(boxRect.fill, "#dcebe1");
  // 菱形 polygon 与箭头三角同为 polygon——按 points 区分
  const polygons = collect(node, "polygon");
  const diamond = polygons.find(
    (p) => p.attrs.points === "-110,0 0,-64 110,0 0,64",
  );
  assert.ok(diamond, "菱形 polygon 缺失");
  assert.equal(polygons.length, 2); // 菱形 + 1 支箭头三角
  // 节点标签随组、居中（短标签字号 22）
  const texts = groups[2] ? collect(groups[2]!, "text") : [];
  assert.equal(texts[0]!.text, "乙");
  assert.equal(Number(texts[0]!.attrs["font-size"]), 22);
  assert.equal(texts[0]!.attrs["text-anchor"], "middle");
});

test("边端点收缩（近圆近似 100）：对角线 d 与箭头三角", () => {
  const node = flowDiagram.render(specWith(BASE) as never, makeCtx());
  const path = collect(node, "path")[0]!;
  assert.equal(path.attrs.d, "M 370.71,370.71 L 629.29,629.29");
  assert.equal(path.attrs["stroke-width"], 8);
  assert.equal(path.attrs.pathLength, 1);
  assert.equal(path.attrs["stroke-dashoffset"], 0); // tMs=1000 已描完
  const head = collect(node, "polygon")[0]!;
  assert.equal(head.attrs.points, "629.29,629.29 614.44,624.34 624.34,614.44");
  assert.equal(head.attrs.fill, "#2f6f4f");
});

test("近距收缩与重合守卫：len<220 按 (len−20)/2，len=0 无 NaN", () => {
  const near = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 400, y: 520, kind: "box" },
        { label: "乙", x: 520, y: 520, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(near, "path")[0]!.attrs.d,
    "M 450.00,520.00 L 470.00,520.00",
  );
  const same = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 500, y: 500, kind: "box" },
        { label: "乙", x: 500, y: 500, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(same, "path")[0]!.attrs.d,
    "M 500.00,500.00 L 500.00,500.00",
  );
  assert.ok(!JSON.stringify(same).includes("NaN"));
});

test("箭头朝向由边方向唯一决定：左向边三角朝左", () => {
  const node = flowDiagram.render(
    specWith({
      ...BASE,
      nodes: [
        { label: "甲", x: 700, y: 300, kind: "box" },
        { label: "乙", x: 300, y: 300, kind: "box" },
      ],
    }) as never,
    makeCtx(),
  );
  assert.equal(
    collect(node, "path")[0]!.attrs.d,
    "M 600.00,300.00 L 400.00,300.00",
  );
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "400.00,300.00 414.00,293.00 414.00,307.00",
  );
});

test("节点梯次弹入（tMs=100，enterMs=200）：i×120ms", () => {
  const node = flowDiagram.render(
    specWith(BASE) as never,
    makeCtx({ frame: 2.4 }),
  );
  const groups = collect(node, "g").slice(1);
  // 甲：appear=easeOutCubic(0.5)=0.875、scale=1.05
  assert.equal(groups[0]!.attrs.opacity, 0.875);
  assert.ok((groups[0]!.attrs.transform as string).includes("scale(1.0500)"));
  // 乙：延迟 120ms 未入场
  assert.equal(groups[1]!.attrs.opacity, 0);
  assert.ok((groups[1]!.attrs.transform as string).includes("scale(1.4000)"));
});

test("边描画时窗：startT=max(两节点延迟)+enterMs=320，drawMs=400", () => {
  const at = (frame: number) =>
    flowDiagram.render(specWith(BASE) as never, makeCtx({ frame }));
  const offsets = [7.68, 12.48, 17.28].map(
    (f) => collect(at(f), "path")[0]!.attrs["stroke-dashoffset"],
  );
  // tMs=320 → p=0；520 → p=0.5；720 → p=1（toFixed(4) 已吸掉浮点噪声，精确相等）
  assert.deepEqual(offsets, [1, 0.5, 0]);
  const headOps = [17.28, 19.2, 21.12].map(
    (f) => collect(at(f), "polygon")[0]!.attrs.opacity,
  );
  // 三角窗口 (tMs−720)/160：720 → 0；800 → 0.5；880 → 1（raw clamp01 无 toFixed
  // 吸收，帧→tMs 换算带 1e-16 噪声——按计划 1e-9 惯例逐项近似）
  const headExp = [0, 0.5, 1];
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs((headOps[i] as number) - headExp[i]!) < 1e-9);
  }
});

test("边标随描画完成淡入：位置在边中点上移 24，窗口 +160ms 起 240ms", () => {
  const params = { ...BASE, edges: [{ from: "甲", to: "乙", label: "是" }] };
  const node = flowDiagram.render(specWith(params) as never, makeCtx());
  const label = collect(node, "text").find((t) => t.text === "是");
  assert.ok(label, "边标缺失");
  // 边中点 = ((370.71..+629.29..)/2, 同) = (500,500) → y=476（浮点容忍 1e-9）
  assert.ok(Math.abs((label!.attrs.x as number) - 500) < 1e-9);
  assert.ok(Math.abs((label!.attrs.y as number) - 476) < 1e-9);
  assert.equal(label!.attrs["text-anchor"], "middle");
  const at = (frame: number) =>
    collect(
      flowDiagram.render(specWith(params) as never, makeCtx({ frame })),
      "text",
    ).find((t) => t.text === "是")!.attrs.opacity;
  // 窗口 (tMs−320−400−160)/240：880 → 0；1000 → 0.5；1120 → 1（raw clamp01，
  // 帧换算浮点噪声——逐项 1e-9 近似）
  const labelOps = [at(21.12), at(24), at(26.88)];
  const labelExp = [0, 0.5, 1];
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs((labelOps[i] as number) - labelExp[i]!) < 1e-9);
  }
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(
    flowDiagram.render(s, makeCtx({ frame: 13 })),
    flowDiagram.render(s, makeCtx({ frame: 13 })),
  );
});
