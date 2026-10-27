import assert from "node:assert/strict";
import test from "node:test";
import { formatCnCount } from "./cn-number-format.js";

// P2-2（Codex 复核 2026-10-28）：大数字按用户口语的万/亿记法展示——
// 同一数值的另一写法，零数据换算；整除性不满足时保留原数字。
test("formatCnCount：万/亿 记法与原样回落", () => {
  assert.equal(formatCnCount(530), "530");
  assert.equal(formatCnCount(9999), "9999");
  assert.equal(formatCnCount(1200000), "120万");
  assert.equal(formatCnCount(3500000), "350万");
  assert.equal(formatCnCount(800000), "80万");
  assert.equal(formatCnCount(15000), "1.5万");
  assert.equal(formatCnCount(120000000), "1.2亿");
  assert.equal(formatCnCount(200000000), "2亿");
  // 不整除 → 原数字（不显示用户没说过的近似记法）。
  assert.equal(formatCnCount(12345), "12345");
  assert.equal(formatCnCount(123456), "123456");
});
