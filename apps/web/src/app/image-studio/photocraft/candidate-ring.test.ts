// 补充A（codex 审核 2026-10-16）单测：自动选中的门槛语义。候选分数是本批
// 候选内的 CLIP 相对排名（softmax 归一），不是正确率——所以默认关闭自动
// 选中，统一走一次人工确认；分数判定的对象是服务端排序后的 top-1（第一位）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  ringOutcome,
  shouldAutoSelectCandidate,
  TAU_AUTO,
  TAU_AUTO_ENABLED,
} from "./candidate-ring";

const candidate = (score: number) => ({ label: `part-${score}`, score });

test("shouldAutoSelectCandidate top-1 分数低于阈值不自动选中", () => {
  assert.equal(
    shouldAutoSelectCandidate("target", [candidate(0.74)], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    false,
  );
});

test("shouldAutoSelectCandidate top-1 分数达到阈值（≥）才自动选中", () => {
  assert.equal(
    shouldAutoSelectCandidate("target", [candidate(0.75)], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    true,
  );
  assert.equal(
    shouldAutoSelectCandidate("target", [candidate(0.9)], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    true,
  );
});

test("shouldAutoSelectCandidate 只看服务端排序的 top-1（第一位）", () => {
  // 排序契约由 parts-candidates 服务保证（分数降序）；环内不重新排序，
  // 第二位再高也不能越过第一位触发自动选中。
  assert.equal(
    shouldAutoSelectCandidate("target", [candidate(0.3), candidate(0.82)], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    false,
  );
});

test("shouldAutoSelectCandidate protect 环永不自动选中", () => {
  // 保护框选错的代价是静默漏保护，任何分数都不放行。
  assert.equal(
    shouldAutoSelectCandidate("protect", [candidate(0.99)], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    false,
  );
});

test("shouldAutoSelectCandidate 自动选中默认关闭（TAU_AUTO_ENABLED=false）", () => {
  assert.equal(TAU_AUTO_ENABLED, false);
  assert.equal(shouldAutoSelectCandidate("target", [candidate(0.99)]), false);
});

test("shouldAutoSelectCandidate 空候选不自动选中", () => {
  assert.equal(
    shouldAutoSelectCandidate("target", [], {
      tauAuto: TAU_AUTO,
      enabled: true,
    }),
    false,
  );
});

test("ringOutcome 区分 auto / override / confirm", () => {
  // 自动选中后直接落地 → auto。
  assert.equal(ringOutcome(true, true, 0, 0), "auto");
  // top-1 曾被自动选中、随后人工换成后面的候选 → override（τ 定得过低的
  // 直接证据，τ 校准回流里最要紧的负样本）。
  assert.equal(ringOutcome(false, true, 0, 2), "override");
  // 无自动选中、人工点选/确认 → confirm。
  assert.equal(ringOutcome(false, false, null, 1), "confirm");
  assert.equal(ringOutcome(false, undefined, null, 0), "confirm");
});
