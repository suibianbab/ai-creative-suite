import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { flowSteps } from "./flow-steps.js";

// collect 为各组件测试私有惯例（bar/line/map 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "四步流程",
  steps: [{ label: "甲" }, { label: "乙" }, { label: "丙" }, { label: "丁" }],
  direction: "horizontal",
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
  enterMs: 200,
};

function specWith(params: unknown) {
  return {
    componentId: "flow-steps",
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
    [{ ...BASE, steps: [{ label: "甲" }] }, /steps 必须是 2\.\.8 个/],
    [
      {
        ...BASE,
        steps: Array.from({ length: 9 }, () => ({ label: "步" })),
      },
      /steps 必须是 2\.\.8 个/,
    ],
    [
      { ...BASE, steps: [{ label: "" }, { label: "乙" }] },
      /label 必须是 1\.\.10 个字符/,
    ],
    [
      {
        ...BASE,
        steps: [{ label: "一二三四五六七八九十壹" }, { label: "乙" }],
      },
      /label 必须是 1\.\.10 个字符/,
    ],
    [{ ...BASE, steps: [{ label: "甲" }, 5] }, /steps\[1\] 必须是对象/],
    [
      { ...BASE, direction: "diagonal" },
      /direction 必须是 horizontal 或 vertical/,
    ],
    [{ ...BASE, boxColor: "green" }, /boxColor 必须是 #rrggbb/],
    [{ ...BASE, arrowColor: "rgb(1,2,3)" }, /arrowColor 必须是 #rrggbb/],
    [{ ...BASE, enterMs: 100 }, /enterMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
  ];
  for (const [params, re] of cases) {
    assert.throws(() => flowSteps.validateParams(params), re);
  }
});

test("横向几何：步数唯一决定盒位与尺寸（N=4）", () => {
  // slot=720/3=240；boxW=min(172.8,240)=172.8、boxH=96；中心 y=520
  const node = flowSteps.render(specWith(BASE) as never, makeCtx());
  const rects = collect(node, "rect");
  assert.equal(rects.length, 5); // 背景 + 4 盒
  // 盒左缘 = cx − boxW/2（boxW=240×0.72 浮点非精确，逐项 1e-9 容忍）
  const boxLefts = rects.slice(1).map((r) => r.attrs.x as number);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(boxLefts[i]! - (140 + i * 240 - 86.4)) < 1e-9);
  }
  for (const r of rects.slice(1)) {
    assert.equal(r.attrs.y, 520 - 48);
    assert.ok(Math.abs((r.attrs.width as number) - 172.8) < 1e-9);
    assert.equal(r.attrs.height, 96);
    assert.equal(r.attrs.rx, 10);
    assert.equal(r.attrs.fill, "#dcebe1");
  }
  // 标题存在且居中（map-grid 同款）
  const title = collect(node, "text").find((t) => t.text === "四步流程");
  assert.equal(title?.attrs.x, 500);
  assert.equal(title?.attrs["dominant-baseline"], "middle");
});

test("纵向几何与箭头（N=5）：盒位/尺寸 + 首箭头 d 与三角", () => {
  const params = {
    ...BASE,
    steps: [
      { label: "一" },
      { label: "二" },
      { label: "三" },
      { label: "四" },
      { label: "五" },
    ],
    direction: "vertical" as const,
  };
  const node = flowSteps.render(specWith(params) as never, makeCtx());
  const rects = collect(node, "rect").slice(1);
  // slot=600/4=150；boxH=min(108,160)=108、boxW=280；中心 x=500
  assert.deepEqual(
    rects.map((r) => r.attrs.y),
    [220 - 54, 370 - 54, 520 - 54, 670 - 54, 820 - 54],
  );
  for (const r of rects) {
    assert.equal(r.attrs.x, 500 - 140);
    assert.equal(r.attrs.width, 280);
    assert.equal(r.attrs.height, 108);
  }
  assert.equal(collect(node, "path").length, 4);
  assert.equal(collect(node, "polygon").length, 4);
  assert.equal(
    collect(node, "path")[0]!.attrs.d,
    "M 500.00,284.00 L 500.00,306.00",
  );
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "500.00,306.00 493.00,292.00 507.00,292.00",
  );
});

test("横向箭头几何与描画属性（N=4 首箭头）", () => {
  const node = flowSteps.render(specWith(BASE) as never, makeCtx());
  const path = collect(node, "path")[0]!;
  assert.equal(path.attrs.d, "M 236.40,520.00 L 283.60,520.00");
  assert.equal(path.attrs.fill, "none");
  assert.equal(path.attrs.stroke, "#2f6f4f");
  assert.equal(path.attrs["stroke-width"], 8);
  assert.equal(path.attrs.pathLength, 1);
  assert.equal(path.attrs["stroke-dasharray"], 1);
  assert.equal(path.attrs["stroke-dashoffset"], 0); // tMs=1000 已描完
  assert.equal(
    collect(node, "polygon")[0]!.attrs.points,
    "283.60,520.00 269.60,513.00 269.60,527.00",
  );
});

test("梯次弹入与标签两级节奏（tMs=100，enterMs=200）", () => {
  const node = flowSteps.render(
    specWith(BASE) as never,
    makeCtx({ frame: 2.4 }),
  );
  const rects = collect(node, "rect").slice(1);
  // 盒 0：appear=easeOutCubic(0.5)=0.875、scale=1.4−0.4×0.875=1.05
  assert.ok(Math.abs((rects[0]!.attrs.opacity as number) - 0.875) < 1e-9);
  assert.ok((rects[0]!.attrs.transform as string).includes("scale(1.0500)"));
  // 盒 1 延迟 120ms 未入场：opacity 0、scale 1.4000
  assert.equal(rects[1]!.attrs.opacity, 0);
  assert.ok((rects[1]!.attrs.transform as string).includes("scale(1.4000)"));
  // 标签两级：100 < 0+200 → 全 0
  const labels = collect(node, "text").filter((t) => t.text !== BASE.title);
  assert.deepEqual(
    labels.map((t) => t.attrs.opacity),
    [0, 0, 0, 0],
  );
});

test("箭头描画时窗与三角淡入（enterMs=200 → 首箭头 delay=200）", () => {
  const at = (frame: number) =>
    flowSteps.render(specWith(BASE) as never, makeCtx({ frame }));
  const offsets = [4.8, 7.68, 9.408].map(
    (f) => collect(at(f), "path")[0]!.attrs["stroke-dashoffset"],
  );
  // tMs=200 → p=0；320 → p=0.5；392 → p=0.8
  assert.deepEqual(offsets, [1, 0.5, 0.2]);
  const headOps = [10.56, 12.48, 14.4].map(
    (f) => collect(at(f), "polygon")[0]!.attrs.opacity,
  );
  // 三角窗口 (tMs−440)/160：440 → 0；520 → 0.5；600 → 1
  assert.deepEqual(headOps, [0, 0.5, 1]);
});

test("标签淡入窗口：enterMs 后 300ms 线性到位", () => {
  const at = (frame: number) =>
    collect(
      flowSteps.render(specWith(BASE) as never, makeCtx({ frame })),
      "text",
    )
      .filter((t) => t.text !== BASE.title)
      .map((t) => t.attrs.opacity);
  // (350−200)/300 = 0.5（tMs=8.4/24×1000 浮点容忍 1e-9）
  assert.ok(Math.abs((at(8.4)[0] as number) - 0.5) < 1e-9);
  // 560ms：标签 i 完成 = i×120+200+300 → 仅标签 0 到位（梯次，逐项 1e-9）
  const mid = at(13.44).map((v) => v as number);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(
      Math.abs(mid[i]! - Math.min(1, (560 - i * 120 - 200) / 300)) < 1e-9,
    );
  }
  // 860ms（帧 20.64）：标签 3 窗口收口 → 全部 1
  assert.deepEqual(at(20.64), [1, 1, 1, 1]);
});

test("纯函数：同 spec 同帧双调 deepEqual", () => {
  const s = specWith(BASE) as never;
  assert.deepEqual(
    flowSteps.render(s, makeCtx({ frame: 13 })),
    flowSteps.render(s, makeCtx({ frame: 13 })),
  );
});

test("八步上限几何：slot=720/7、无 NaN、箭头非负长", () => {
  const params = {
    ...BASE,
    steps: Array.from({ length: 8 }, (_, i) => ({ label: `步${i + 1}` })),
  };
  const node = flowSteps.render(specWith(params) as never, makeCtx());
  const rects = collect(node, "rect").slice(1);
  assert.equal(rects.length, 8);
  // boxW = min((720/7)×0.72, 240) = 518.4/7
  for (const r of rects) {
    assert.ok(Math.abs((r.attrs.width as number) - 518.4 / 7) < 1e-9);
    assert.ok(Math.abs((r.attrs.height as number) - 96) < 1e-9);
  }
  // 首末中心 = 140 / 860（等距覆盖全区；浮点表达差异容忍 1e-9）
  assert.ok(
    Math.abs((rects[0]!.attrs.x as number) - (140 - 518.4 / 14)) < 1e-9,
  );
  assert.ok(
    Math.abs((rects[7]!.attrs.x as number) - (860 - 518.4 / 14)) < 1e-9,
  );
  // 7 支箭头全部 x2 > x1（长度非负）
  for (const p of collect(node, "path")) {
    const m = /M ([0-9.]+),520\.00 L ([0-9.]+),520\.00/.exec(
      String(p.attrs.d),
    )!;
    assert.ok(Number(m[2]) > Number(m[1]), p.attrs.d as string);
  }
  assert.ok(!JSON.stringify(node).includes("NaN"));
});
