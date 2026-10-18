import assert from "node:assert/strict";
import test from "node:test";
import { emUnits, fitFontSize } from "./text-width.js";

test("emUnits：CJK 按 1em、拉丁/数字/空格按 0.6em、空串为 0", () => {
  assert.equal(emUnits(""), 0);
  assert.equal(emUnits("标题"), 2);
  // 0.6 是二进制不可精确表示：按 ε 容差断言（行为口径 3 × 0.6）
  assert.ok(Math.abs(emUnits("abc") - 1.8) < 1e-12);
  assert.ok(Math.abs(emUnits("第1年") - 2.6) < 1e-12); // 2 CJK + 1 digit
});

test("fitFontSize：行宽超限时等比缩小，未超时保持 base，空文本返回 base", () => {
  assert.equal(fitFontSize(200, "标题", 840), 200); // 2em×200=400 ≤ 840
  assert.equal(fitFontSize(200, "十个字长的标题文本哦", 840), 84); // 10em → 840/10
  assert.equal(fitFontSize(120, "", 840), 120);
});
