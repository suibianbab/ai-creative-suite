import assert from "node:assert/strict";
import test from "node:test";
import { fitWrappedText } from "./safe-layout.js";
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
