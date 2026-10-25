import assert from "node:assert/strict";
import test from "node:test";
import { validateParams } from "./compare-split.js";

const validate = validateParams as (v: unknown) => {
  enterMs: number;
  sequence: string;
};
const base: Record<string, unknown> = {
  title: "对比",
  metricLabel: "指标",
  beforeLabel: "前",
  beforeValue: "1",
  beforeNote: "旧",
  afterLabel: "后",
  afterValue: "2",
  afterNote: "新",
  deltaText: "1→2",
  deltaPositive: true,
};

// —— Codex P1-2 / P2-3 / P2-5 回归 ——
test("Codex P1-2：显式越界 enterMs 拒绝，undefined 用缺省", () => {
  assert.equal(validate(base).enterMs, 1200);
  assert.equal(validate({ ...base, enterMs: 3000 }).enterMs, 3000);
  assert.throws(() => validate({ ...base, enterMs: 0 }), /enterMs/);
  assert.throws(() => validate({ ...base, enterMs: 6000 }), /enterMs/);
  assert.throws(() => validate({ ...base, enterMs: Number.NaN }), /enterMs/);
});

test("Codex P2-3：sequence 缺省 stagger、合法 sync，非法拒绝", () => {
  assert.equal(validate(base).sequence, "stagger");
  assert.equal(validate({ ...base, sequence: "sync" }).sequence, "sync");
  assert.throws(() => validate({ ...base, sequence: "random" }), /sequence/);
});
