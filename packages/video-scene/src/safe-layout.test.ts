import assert from "node:assert/strict";
import test from "node:test";
import { fitWrappedText, safeFrame, safeFrameRect } from "./safe-layout.js";
import { emUnits } from "./text-width.js";

test("长标题逐行留在安全宽度内，且不丢字", () => {
  const text = "季度销量增长趋势与市场表现的完整观察";
  const layout = fitWrappedText(text, 72, 576, 2);
  assert.equal(layout.lines.length, 2);
  assert.equal(layout.lines.join(""), text);
  for (const line of layout.lines) {
    assert.ok(emUnits(line) * layout.fontSize <= 576 + 1e-6);
  }
});

test("双行标题优先在居中的标点后换行，不留行首标点", () => {
  const text = "增长趋势清晰可见，继续观察下一季度表现";
  const layout = fitWrappedText(text, 72, 576, 2);
  assert.equal(layout.lines.length, 2);
  assert.ok(layout.lines[0]!.endsWith("，"));
  assert.equal(layout.lines.join(""), text);
});

test("safeFrameRect：横竖版 10% 内缩矩形（预览辅助线与组件同口径）", () => {
  assert.deepEqual(safeFrameRect(1280, 720), {
    x: 128,
    y: 72,
    width: 1024,
    height: 576,
  });
  assert.deepEqual(safeFrameRect(720, 1280), {
    x: 72,
    y: 128,
    width: 576,
    height: 1024,
  });
});

test("safeFrameRect 与 safeFrame 共用同一 10% 安全区推导", () => {
  const ctx = {
    frame: 0,
    fps: 24,
    durationFrames: 24,
    width: 720,
    height: 1280,
    random: () => 0,
  };
  const frame = safeFrame(ctx);
  const rect = safeFrameRect(ctx.width, ctx.height);
  assert.equal(rect.x, frame.left);
  assert.equal(rect.y, frame.top);
  assert.equal(rect.width, frame.width);
  assert.equal(rect.height, frame.height);
});
