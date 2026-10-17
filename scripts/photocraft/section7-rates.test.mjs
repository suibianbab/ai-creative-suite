// section7-rates.mjs 单测：钉住「未测量」表示与承诺判定的边界（第八轮）。
// 运行：node --test scripts/photocraft/section7-rates.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import {
  fraction,
  meetsAtLeast,
  percentText,
  sumLaneTotals,
} from "./section7-rates.mjs";

test("fraction：正常分数保留 4 位小数", () => {
  assert.deepEqual(fraction(10, 11), { passed: 10, total: 11, rate: 0.9091 });
  assert.deepEqual(fraction(9, 12), { passed: 9, total: 12, rate: 0.75 });
});

test("fraction：零与负分母 → rate=null（未测量，不冒充 0）", () => {
  assert.equal(fraction(0, 0).rate, null);
  assert.equal(fraction(3, 0).rate, null);
  assert.equal(fraction(3, -2).rate, null);
});

test("fraction：非有限输入 → rate=null", () => {
  assert.equal(fraction(Number.NaN, 10).rate, null);
  assert.equal(fraction(1, Number.NaN).rate, null);
  assert.equal(fraction(Number.POSITIVE_INFINITY, 10).rate, null);
  assert.equal(fraction(null, 10).rate, null);
  assert.equal(fraction(undefined, 10).rate, null);
});

test("fraction：分子 0 分母正 → rate=0（真零，与未测量区分）", () => {
  assert.deepEqual(fraction(0, 12), { passed: 0, total: 12, rate: 0 });
});

test("sumLaneTotals：跨 lane 求和", () => {
  assert.deepEqual(
    sumLaneTotals({
      "engine:express": { total: 115, pass: 115 },
      "parser:gap": { total: 50, pass: 50 },
      "parser:model-reject": { total: 10, pass: 10 },
    }),
    { total: 175, pass: 175 },
  );
  assert.deepEqual(sumLaneTotals({}), { total: 0, pass: 0 });
  assert.deepEqual(sumLaneTotals(null), { total: 0, pass: 0 });
  // lane 缺字段按 0 计，不抛错
  assert.deepEqual(sumLaneTotals({ a: { total: 2 } }), { total: 2, pass: 0 });
});

test("meetsAtLeast：阈值比较", () => {
  assert.equal(meetsAtLeast(1, 1), true);
  assert.equal(meetsAtLeast(0.9, 0.9), true);
  assert.equal(meetsAtLeast(0.8999, 0.9), false);
  assert.equal(meetsAtLeast(0.9, 1), false);
});

test("meetsAtLeast：null/非有限 → null（未测量不判达标与否）", () => {
  assert.equal(meetsAtLeast(null, 0.9), null);
  assert.equal(meetsAtLeast(undefined, 0.9), null);
  assert.equal(meetsAtLeast(Number.NaN, 0.9), null);
  assert.equal(meetsAtLeast(0.9, Number.NaN), null);
});

test("percentText：null → 未测量；正常 → 百分比", () => {
  assert.equal(percentText(null), "未测量");
  assert.equal(percentText(undefined), "未测量");
  assert.equal(percentText(0.9091), "90.91%");
  assert.equal(percentText(1), "100.00%");
  assert.equal(percentText(0), "0.00%");
});
