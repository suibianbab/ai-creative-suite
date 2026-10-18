import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { loadingDots } from "./loading-dots.js";

function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "加载中",
  label: "请稍候",
  dots: 3,
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  cycleMs: 500,
};

function specWith(params: unknown) {
  return {
    componentId: "loading-dots",
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

test("校验表：非法 params 逐条拒绝，合法返回原引用", () => {
  const cases: Array<[unknown, string]> = [
    ["nope", "loading-dots params 必须是对象"],
    [
      { ...BASE, title: "a".repeat(41) },
      "loading-dots params.title 必须是 ≤40 个字符",
    ],
    [{ ...BASE, label: "" }, "loading-dots params.label 必须是 1..12 个字符"],
    [
      { ...BASE, label: "一二三四五六七八九十甲乙丙" },
      "loading-dots params.label 必须是 1..12 个字符",
    ],
    [{ ...BASE, dots: 2 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [{ ...BASE, dots: 7 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [{ ...BASE, dots: 3.5 }, "loading-dots params.dots 必须是 3..6 的整数"],
    [
      { ...BASE, cycleMs: 399 },
      "loading-dots params.cycleMs 必须是 400..2000 的整数",
    ],
    [
      { ...BASE, cycleMs: 2001 },
      "loading-dots params.cycleMs 必须是 400..2000 的整数",
    ],
    [
      { ...BASE, inkColor: "#fff" },
      "loading-dots params.inkColor 必须是 #rrggbb",
    ],
    [
      { ...BASE, accentColor: "red" },
      "loading-dots params.accentColor 必须是 #rrggbb",
    ],
  ];
  for (const [params, message] of cases) {
    assert.throws(() => loadingDots.validateParams(params), { message });
  }
  const ok = { ...BASE };
  assert.equal(loadingDots.validateParams(ok), ok);
});

test("横排几何：N=3 圆心 408/500/592，相位 0.25 峰值跳起 90、负半周贴地", () => {
  // frame 3 @24fps → tMs 125；cycle 500 → dot0 相位 0.25（正弦峰值 lift=1）、
  // dot1/dot2 相位 0.5833/0.9167（负半周 → max(0,·)=0 贴地）
  const node = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 3 }),
  );
  const circles = collect(node, "circle");
  assert.equal(circles.length, 3);
  assert.deepEqual(
    circles.map((c) => c.attrs?.cx),
    [408, 500, 592],
  );
  assert.deepEqual(
    circles.map((c) => c.attrs?.cy),
    [430, 520, 520],
  );
  assert.equal(circles[0]?.attrs?.r, 28);
  assert.equal(circles[0]?.attrs?.fill, "#e05a2b");
});

test("不透明度随相位：峰值 1、贴地 0.35", () => {
  const node = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 3 }),
  );
  const circles = collect(node, "circle");
  assert.equal(circles[0]?.attrs?.opacity, 1);
  assert.equal(circles[1]?.attrs?.opacity, 0.35);
  assert.equal(circles[2]?.attrs?.opacity, 0.35);
});

test("标题 300ms 淡入：frame 0 全透明、tMs=300 全显", () => {
  const at = (frame: number) => {
    const node = loadingDots.render(
      specWith(BASE) as never,
      makeCtx({ frame }),
    );
    return collect(node, "text").find((t) => t.text === "加载中")?.attrs
      ?.opacity;
  };
  assert.equal(at(0), 0);
  assert.equal(at(7.2), 1);
});

test("状态文案：(500,700) 居中，合法 12 字不触发缩排（600/12em=50 > 36）", () => {
  // fitFontSize(36, label, 600) = min(36, 600/emUnits)——12 全角字 em=12 →
  // 600/12=50 > 36 → 钳在上限 36（合法 label 恒不缩排，缩排只由上限决定）
  const full = { ...BASE, label: "一二三四五六七八九十甲乙" };
  const node = loadingDots.render(
    specWith(full) as never,
    makeCtx({ frame: 3 }),
  );
  const label = collect(node, "text").find((t) => t.text === full.label);
  assert.equal(label?.attrs?.x, 500);
  assert.equal(label?.attrs?.y, 700);
  assert.equal(label?.attrs?.["font-size"], 36);
});

test("循环相位：dot0 在 tMs 625（一个整周期后）重回峰值", () => {
  // 625/500 = 1.25 → %1 = 0.25 → lift=1（循环成立，非一次性动画）
  const node = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 15 }),
  );
  const circles = collect(node, "circle");
  assert.equal(circles[0]?.attrs?.cy, 430);
});

test("label 按码点计数：emoji 2 码点合法且渲染不劈半", () => {
  const emoji = { ...BASE, label: "😀😀" };
  assert.equal(loadingDots.validateParams(emoji), emoji);
  const node = loadingDots.render(
    specWith(emoji) as never,
    makeCtx({ frame: 3 }),
  );
  const label = collect(node, "text").find((t) => t.text === "😀😀");
  assert.ok(label);
});

test("结构：背景 rect 首子元素 + svg viewBox 0 0 1000 1000", () => {
  const node = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 3 }),
  );
  const root = node.children ?? [];
  assert.equal(root[0]?.tag, "rect");
  assert.equal(root[0]?.attrs?.fill, "#ffffff");
  assert.equal(root[1]?.tag, "svg");
  assert.equal(root[1]?.attrs?.viewBox, "0 0 1000 1000");
});

test("帧确定性：同 spec 同帧双调 deepEqual（分数帧）", () => {
  const a = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 17.28 }),
  );
  const b = loadingDots.render(
    specWith(BASE) as never,
    makeCtx({ frame: 17.28 }),
  );
  assert.deepEqual(a, b);
});
