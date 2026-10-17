import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "./random.js";

test("同 seed 产生完全一致的序列，且值 ∈ [0,1)", () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  const seqA = Array.from({ length: 100 }, () => a());
  const seqB = Array.from({ length: 100 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});
test("不同 seed 序列不同", () => {
  const a = seededRandom(7);
  const c = seededRandom(8);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqC = Array.from({ length: 8 }, () => c());
  assert.notDeepEqual(seqA, seqC);
});
