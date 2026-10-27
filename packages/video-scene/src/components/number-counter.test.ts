import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../random.js";
import type { FrameContext } from "../registry.js";
import type { SceneSpec } from "../spec.js";
import type { SvgNode } from "../svg.js";
import { emUnits } from "../text-width.js";
import { numberCounter } from "./number-counter.js";

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
    componentId: "number-counter",
    componentVersion: 1,
    durationMs: 12000,
    seed: 7,
    background: "#ffffff",
    params,
  };
}

const BASE = {
  title: "一次通过率",
  value: 98.6,
  prefix: "",
  suffix: "%",
  decimals: 1,
  countMs: 1500,
  numberColor: "#1b2c29",
  accentColor: "#d9822b",
};

function collect(node: SvgNode, tag: string): SvgNode[] {
  if (node.tag === tag) return [node];
  return (node.children ?? []).flatMap((child) => collect(child, tag));
}

function numberText(node: SvgNode): SvgNode {
  return collect(node, "text").find((t) => t.text!.includes("%"))!;
}

test("t=0 文本 = prefix + (0).toFixed(decimals) + suffix；t≥countMs 定格 value", () => {
  const spec = specWith({ ...BASE });
  const start = numberText(numberCounter.render(spec, makeCtx({ frame: 0 })));
  assert.equal(start.text, "0.0%");
  const done = numberText(
    numberCounter.render(spec, makeCtx({ frame: 24 * 3 })),
  );
  assert.equal(done.text, "98.6%");
});

test("滚动中途数值单调不减且介于两端之间", () => {
  const spec = specWith({ ...BASE });
  let prev = 0;
  for (let frame = 0; frame <= 24 * 2; frame += 4) {
    const node = numberCounter.render(spec, makeCtx({ frame }));
    const current = Number(numberText(node).text!.replace("%", ""));
    assert.ok(current >= prev - 1e-9, `frame ${frame}: ${current} < ${prev}`);
    assert.ok(current <= 98.6 + 1e-9);
    prev = current;
  }
});

test("整数模式 decimals=0 无小数点", () => {
  const node = numberCounter.render(
    specWith({ ...BASE, value: 250000, suffix: "+", decimals: 0 }),
    makeCtx({ frame: 24 * 3 }),
  );
  const text = collect(node, "text").find((t) => t.text!.includes("+"))!.text;
  assert.equal(text, "250000+");
});

test("长文本字号自适应：prefix+长数字+suffix 钳制到 ≤200 且行宽 ≤840", () => {
  const node = numberCounter.render(
    specWith({
      ...BASE,
      value: 123456789012,
      prefix: "累计",
      suffix: "件作品",
    }),
    makeCtx({ frame: 24 * 3 }),
  );
  const text = collect(node, "text").find((t) => t.text!.includes("件作品"))!;
  const size = text.attrs["font-size"] as number;
  assert.ok(size < 200, `长文本应缩小: ${size}`);
  // text = "累计123456789012.0件作品"（decimals=1 带 .0）：
  // emUnits = 5 CJK + 14×0.6（12 数字 + "." + "0"）= 13.4 → 840/13.4
  assert.ok(Math.abs(size - 840 / 13.4) < 1e-9);
});

test("竖版长数字和标题落在安全区，数字仍逐帧计数", () => {
  const spec = specWith({
    ...BASE,
    title: "四季度销量增长的关键数据",
    value: 123456789012,
    prefix: "累计",
    suffix: "件",
    decimals: 0,
  });
  const ctx = makeCtx({ width: 720, height: 1280, frame: 72 });
  const node = numberCounter.render(spec, ctx);
  assert.equal(collect(node, "svg").length, 0);
  const labels = collect(node, "text");
  assert.ok(labels[0]!.text!.includes("123456789012"));
  for (const label of labels) {
    const size = label.attrs["font-size"] as number;
    assert.ok(emUnits(label.text!) * size <= 576 + 1e-6);
    assert.ok((label.attrs.y as number) >= 128);
    assert.ok((label.attrs.y as number) <= 1152);
  }
});

test("accent 下划线随 countMs 生长：t=0 宽 0，末帧宽 320 且居中", () => {
  const spec = specWith({ ...BASE });
  const nestedAt = (frame: number) =>
    collect(numberCounter.render(spec, makeCtx({ frame })), "svg")[0]!;
  const at0 = collect(nestedAt(0), "rect").find(
    (r) => r.attrs.fill === "#d9822b",
  )!;
  assert.equal(at0.attrs.width, 0);
  const done = collect(nestedAt(24 * 3), "rect").find(
    (r) => r.attrs.fill === "#d9822b",
  )!;
  assert.equal(done.attrs.width, 320);
  assert.equal(done.attrs.x, 500 - 160);
});

test("标题存在且在数字下方（y=660）", () => {
  const node = numberCounter.render(
    specWith({ ...BASE }),
    makeCtx({ frame: 0 }),
  );
  const title = collect(node, "text").find((t) => t.text === "一次通过率")!;
  assert.equal(title.attrs.y, 660);
});

test("同 (spec, ctx) 两次渲染深度相等（纯函数）", () => {
  const spec = specWith({ ...BASE });
  assert.deepEqual(
    numberCounter.render(spec, makeCtx({ frame: 12 })),
    numberCounter.render(spec, makeCtx({ frame: 12 })),
  );
});

test("params 校验：value 负/超界、decimals 越界、prefix/suffix 超 6、countMs 越界、颜色拒绝", () => {
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, value: -1 }),
    /value/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, value: 1e13 }),
    /value/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, decimals: 3 }),
    /decimals/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, decimals: -1 }),
    /decimals/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, prefix: "七个字符的前缀" }),
    /prefix/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, suffix: "一二三四五六七" }),
    /suffix/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, countMs: 199 }),
    /countMs/,
  );
  assert.throws(
    () => numberCounter.validateParams({ ...BASE, numberColor: "red" }),
    /numberColor/,
  );
});

// P2-2（Codex 复核 2026-10-28）：cnUnits opt-in——≥1e4 按万/亿记法显示，
// 缺省不传保持原数字（既有模板口径不变）。
test("cnUnits=true：大数字按万/亿记法；缺省原样", () => {
  const textOf = (node: SvgNode): string => {
    const found = collect(node, "text").find((t) => t.text!.includes("吨"));
    if (!found) throw new Error("数字文本节点未找到");
    return found.text!;
  };
  const withUnits = numberCounter.render(
    specWith({
      ...BASE,
      value: 800000,
      suffix: "吨",
      decimals: 0,
      cnUnits: true,
    }),
    makeCtx({ frame: 24 * 3 }),
  );
  const text = textOf(withUnits);
  if (!text.includes("80万")) throw new Error(`期望 80万 记法: ${text}`);
  const without = numberCounter.render(
    specWith({ ...BASE, value: 800000, suffix: "吨", decimals: 0 }),
    makeCtx({ frame: 24 * 3 }),
  );
  if (!textOf(without).includes("800000"))
    throw new Error("缺省 cnUnits 应保持原数字");
});
