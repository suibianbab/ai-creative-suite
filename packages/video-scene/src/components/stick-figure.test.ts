import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { stickFigure } from "./stick-figure.js";

// collect 为各组件测试私有惯例（bar/line/map/flow 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "火柴人",
  groundY: 800,
  figures: [{ action: "站", fromX: 500, toX: 500 }],
  strokeColor: "#1b2c29",
  groundColor: "#9aa8a0",
  textColor: "#1b2c29",
  enterMs: 200,
  cycleMs: 1000,
  travelMs: 1000,
};

function specWith(params: unknown) {
  return {
    componentId: "stick-figure",
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
// tMs = frame/fps×1000；at(10.8) → 450ms 等，测试全部走可整除断言值
const at = (tMs: number) =>
  stickFigure.render(
    specWith(BASE),
    makeCtx({ frame: (tMs / 1000) * 24 }) as never,
  );
// 唯一 figure 的 <g>：嵌套 svg children = [标题, 地面线, ...figures]
const figureGroup = (root: SvgNode, i = 0) =>
  collect(root, "g").filter((g) => "transform" in g.attrs)[i]!;

test("站姿几何：呼吸 bob 与关节端点逐条断言（tMs=1000）", () => {
  // bob = 2·sin(2π·1000/1600) = −1.41421 → hipY = 800−120+1.41421 = 681.41
  const g = figureGroup(at(1000));
  assert.equal(g.attrs.transform, "translate(500.00 681.41)");
  const lines = collect(g, "line");
  assert.equal(lines.length, 7); // 脊柱+双臂×2段+双腿
  // 子序：脊柱, 臂L 上/前, 臂R 上/前, 腿L, 腿R（实现 children 顺序）
  assert.equal(`${lines[0]!.attrs.x1},${lines[0]!.attrs.y1}`, "0.00,0.00");
  assert.equal(`${lines[0]!.attrs.x2},${lines[0]!.attrs.y2}`, "0.00,-110.00");
  // 臂L：upper −6° → 肘 (−sin6°×52, −110+cos6°×52) = (−5.44, −58.28)
  assert.equal(`${lines[1]!.attrs.x2},${lines[1]!.attrs.y2}`, "-5.44,-58.28");
  // 臂L 前臂 rel 0 → 手 (−sin6°×100, −110+cos6°×100) = (−10.45, −10.55)
  assert.equal(`${lines[2]!.attrs.x2},${lines[2]!.attrs.y2}`, "-10.45,-10.55");
  // 臂R 镜像：前臂手 (10.45, −10.55)
  assert.equal(`${lines[4]!.attrs.x2},${lines[4]!.attrs.y2}`, "10.45,-10.55");
  // 腿L −4° → foot (−8.37, 119.71)；腿R +4° → (8.37, 119.71)
  assert.equal(`${lines[5]!.attrs.x2},${lines[5]!.attrs.y2}`, "-8.37,119.71");
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "8.37,119.71");
});

test("走循环：φ=0.25 摆极值（腿 26°/臂 −20°/bob 4）", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 500, toX: 500 }],
  });
  const root = stickFigure.render(spec, makeCtx({ frame: 10.8 }) as never); // tMs=450, φ=0.25
  const g = collect(root, "g").filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(g.attrs.transform, "translate(500.00 676.00)");
  const lines = collect(g, "line");
  // 腿L 26° → (52.60, 107.86)；腿R −26° → (−52.60, 107.86)
  assert.equal(`${lines[5]!.attrs.x2},${lines[5]!.attrs.y2}`, "52.60,107.86");
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "-52.60,107.86");
  // 臂L −20° → 肘 (−17.79, −61.14)
  assert.equal(`${lines[1]!.attrs.x2},${lines[1]!.attrs.y2}`, "-17.79,-61.14");
});

test("走循环：φ=0.5 回中（swing≈0）", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 500, toX: 500 }],
  });
  const root = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700, φ=0.5
  const g = collect(root, "g").filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(g.attrs.transform, "translate(500.00 680.00)");
  const lines = collect(g, "line");
  // 回中：x2 数值近似 0（frame→tMs 浮点噪声使 sin(π)≈−6e-15，字符串钉 "-0.00"/"0.00" 不可重复——1e-9 惯例）
  assert.ok(Math.abs(Number(lines[5]!.attrs.x2)) < 1e-9);
});

test("行进窗口：travelMs 中途线性、到点后原地循环", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 80, toX: 920 }],
    travelMs: 1000,
  });
  const mid = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700 → 0.5 → x=500
  assert.equal(
    collect(mid, "g").filter((x) => "transform" in x.attrs)[0]!.attrs.transform,
    "translate(500.00 680.00)",
  );
  const done = stickFigure.render(spec, makeCtx({ frame: 120 }) as never); // tMs=5000 → x=920（踏步继续）
  assert.equal(
    (
      collect(done, "g").filter((x) => "transform" in x.attrs)[0]!.attrs
        .transform as string
    ).startsWith("translate(920.00 "),
    true,
  );
});

test("跳：φ=0.5 抛物线顶点（yOff 120、腿 ±10°、臂 ±120°）与 φ=0.25 落地段同站", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "跳", fromX: 500, toX: 500 }],
  });
  const peak = stickFigure.render(spec, makeCtx({ frame: 16.8 }) as never); // tMs=700, φ=0.5
  const g = collect(peak, "g").filter((x) => "transform" in x.attrs)[0]!;
  // bob=2·sin(2π·700/1600)=0.76537 → hipY=800−120−0.76537−120=559.23
  assert.equal(g.attrs.transform, "translate(500.00 559.23)");
  const lines = collect(g, "line");
  // 臂R 120° → 肘 (45.03,−136.00)、手 (86.60,−160.00)
  assert.equal(`${lines[3]!.attrs.x2},${lines[3]!.attrs.y2}`, "45.03,-136.00");
  assert.equal(`${lines[4]!.attrs.x2},${lines[4]!.attrs.y2}`, "86.60,-160.00");
  // 腿R +10° → foot (20.84, 118.18)
  assert.equal(`${lines[6]!.attrs.x2},${lines[6]!.attrs.y2}`, "20.84,118.18");
  const ground = stickFigure.render(spec, makeCtx({ frame: 7.2 }) as never); // tMs=300, φ=0.1 ≤ 0.15 落地
  const gg = collect(ground, "g").filter((x) => "transform" in x.attrs)[0]!;
  // bob=2·sin(2π·300/1600)=1.84776 → hipY=678.15；腿 ±4°
  assert.equal(gg.attrs.transform, "translate(500.00 678.15)");
  const gl = collect(gg, "line");
  assert.equal(`${gl[5]!.attrs.x2},${gl[5]!.attrs.y2}`, "-8.37,119.71");
});

test("挥手：前臂每周期摆 3 次（φ=0.25 与 φ=1/12 手 y 相差 40.57）", () => {
  const spec = specWith({
    ...BASE,
    figures: [{ action: "挥手", fromX: 500, toX: 500 }],
  });
  const a = stickFigure.render(spec, makeCtx({ frame: 10.8 }) as never); // φ=0.25 → rel=−85
  const b = stickFigure.render(spec, makeCtx({ frame: 6.8 }) as never); // tMs=283.33, φ=1/12 → rel=−35
  const la = collect(
    collect(a, "g").filter((x) => "transform" in x.attrs)[0]!,
    "line",
  );
  const lb = collect(
    collect(b, "g").filter((x) => "transform" in x.attrs)[0]!,
    "line",
  );
  // 右前臂（index 4）：肘 (26,−155.03) 固定（臂根在颈 y=−110）；手 x 同
  // 69.50，y −134.75（rel=−85）↔ −175.32（rel=−35）——挥手摆幅
  assert.equal(`${la[4]!.attrs.x2},${la[4]!.attrs.y2}`, "69.50,-134.75");
  assert.equal(`${lb[4]!.attrs.x2},${lb[4]!.attrs.y2}`, "69.50,-175.32");
});

test("镜像：toX<fromX 整组 scale(-1,1)，向右无 scale", () => {
  const left = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 800, toX: 200 }],
  });
  const gl = collect(
    stickFigure.render(left, makeCtx({ frame: 10.8 }) as never),
    "g",
  ).filter((x) => "transform" in x.attrs)[0]!;
  assert.equal(gl.attrs.transform, "translate(650.00 676.00) scale(-1,1)");
  const right = specWith({
    ...BASE,
    figures: [{ action: "走", fromX: 80, toX: 920 }],
  });
  const gr = collect(
    stickFigure.render(right, makeCtx({ frame: 10.8 }) as never),
    "g",
  ).filter((x) => "transform" in x.attrs)[0]!;
  assert.equal((gr.attrs.transform as string).includes("scale"), false);
});

test("淡入与梯次：raw clamp01 opacity 逐项 1e-9 近似（已立惯例）", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "站", fromX: 300, toX: 300 },
      { action: "站", fromX: 600, toX: 600 },
    ],
  });
  const groups = (tMs: number) =>
    collect(
      stickFigure.render(spec, makeCtx({ frame: (tMs / 1000) * 24 }) as never),
      "g",
    ).filter((x) => "transform" in x.attrs);
  // fig0 delay0：tMs=100→0.5；fig1 delay200：tMs=300→0.5、tMs=500→1
  const ops = [
    groups(100)[0]!.attrs.opacity,
    groups(300)[1]!.attrs.opacity,
    groups(500)[1]!.attrs.opacity,
  ];
  const exp = [0.5, 0.5, 1];
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs((ops[i] as number) - exp[i]!) < 1e-9);
  }
});

test("tMs=0 边界：φ 取 0 站姿、三组俱在、全树无 NaN", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "走", fromX: 80, toX: 920 },
      { action: "跳", fromX: 500, toX: 500 },
      { action: "挥手", fromX: 700, toX: 700 },
    ],
  });
  const root = stickFigure.render(spec, makeCtx({ frame: 0 }) as never);
  const groups = collect(root, "g").filter((x) => "transform" in x.attrs);
  assert.equal(groups.length, 3);
  // fig0：bob=0 → hipY=680；progress=clamp01(−0.2)=0 → x=80
  assert.equal(groups[0]!.attrs.transform, "translate(80.00 680.00)");
  assert.equal(JSON.stringify(root).includes("NaN"), false);
});

test("帧确定性：同 spec 同 ctx 双调 deepEqual", () => {
  const spec = specWith({
    ...BASE,
    figures: [
      { action: "走", fromX: 80, toX: 920 },
      { action: "挥手", fromX: 700, toX: 700 },
    ],
  });
  const ctx = makeCtx({ frame: 17.28 });
  assert.deepEqual(
    stickFigure.render(spec, ctx as never),
    stickFigure.render(spec, ctx as never),
  );
});

test("校验表：越界/非法输入逐项拒绝（消息逐字）", () => {
  const cases: Array<[unknown, RegExp]> = [
    ["not-object", /stick-figure params 必须是对象/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
    [{ ...BASE, figures: [] }, /figures 必须是 1\.\.3 个/],
    [
      {
        ...BASE,
        figures: [
          { action: "站", fromX: 100, toX: 100 },
          { action: "站", fromX: 200, toX: 200 },
          { action: "站", fromX: 300, toX: 300 },
          { action: "站", fromX: 400, toX: 400 },
        ],
      },
      /figures 必须是 1\.\.3 个/,
    ],
    [
      { ...BASE, figures: [{ action: "跑", fromX: 100, toX: 100 }] },
      /action 必须是 走\/站\/挥手\/指\/跳/,
    ],
    [
      { ...BASE, figures: [{ action: "走", fromX: "300", toX: 300 }] },
      /fromX \/ toX 必须是 0\.\.1000 的数/,
    ],
    [
      { ...BASE, figures: [{ action: "走", fromX: -1, toX: 300 }] },
      /fromX \/ toX 必须是 0\.\.1000 的数/,
    ],
    [
      { ...BASE, figures: [{ action: "走", fromX: 100, toX: 1001 }] },
      /fromX \/ toX 必须是 0\.\.1000 的数/,
    ],
    [{ ...BASE, groundY: 399 }, /groundY 必须是 400\.\.900 的数/],
    [{ ...BASE, groundY: 901 }, /groundY 必须是 400\.\.900 的数/],
    [{ ...BASE, enterMs: 199 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, cycleMs: 6000.5 }, /cycleMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, travelMs: "400" }, /travelMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, strokeColor: "#12345" }, /strokeColor 必须是 #rrggbb/],
    [{ ...BASE, groundColor: "red" }, /groundColor 必须是 #rrggbb/],
  ];
  for (const [params, pattern] of cases) {
    assert.throws(
      () => stickFigure.validateParams(params),
      pattern,
      `input: ${JSON.stringify(params).slice(0, 80)}`,
    );
  }
  // 合法最小输入不抛（返回原值）
  assert.equal(stickFigure.validateParams(BASE), BASE);
});
