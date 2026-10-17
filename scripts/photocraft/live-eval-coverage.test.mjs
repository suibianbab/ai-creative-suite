// R2（codex 第二轮复审 2026-10-16）：live-eval 覆盖汇总模块单测。
// 回归钉住历史 bug：lanes 存在 Map 里时，旧汇总用 Object.entries(Map)（对
// Map 恒返回 []）导致 coverage 分母归零。summarizeCoverage 必须按 Map 条目
// 汇总，且任何自检失败抛错而不是生成错误报告。
import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageMismatches,
  summarizeCoverage,
} from "./live-eval-coverage.mjs";

function sampleLanes() {
  return new Map([
    ["engine:express（预置计划）", { total: 115, pass: 115 }],
    ["engine:model（预置计划）", { total: 13, pass: 12 }],
    ["engine:sequence", { total: 17, pass: 16 }],
    ["parser:gap", { total: 50, pass: 50 }],
    ["parser:model-reject", { total: 10, pass: 10 }],
    ["parser:sequence-reject", { total: 7, pass: 7 }],
  ]);
}

test("summarizes engine/parser totals from Map entries (regression: Object.entries(Map) is always [])", () => {
  const summary = summarizeCoverage(sampleLanes());
  assert.equal(summary.engineTotal, 115 + 13 + 17);
  assert.equal(summary.parserTotal, 50 + 10 + 7);
  assert.deepEqual(summary.lanes, Object.fromEntries(sampleLanes()));
});

test("empty or partial Maps summarize to the remaining layer without inventing counts", () => {
  assert.deepEqual(summarizeCoverage(new Map()), {
    lanes: {},
    engineTotal: 0,
    parserTotal: 0,
  });
  const onlyParser = summarizeCoverage(
    new Map([["parser:gap", { total: 50, pass: 50 }]]),
  );
  assert.equal(onlyParser.engineTotal, 0);
  assert.equal(onlyParser.parserTotal, 50);
});

test("rejects inconsistent lane counters and non-Map input", () => {
  assert.throws(
    () =>
      summarizeCoverage(new Map([["engine:sequence", { total: 3, pass: 4 }]])),
    /计数非法/,
  );
  assert.throws(
    () =>
      summarizeCoverage(
        new Map([["engine:sequence", { total: 1.5, pass: 0 }]]),
      ),
    /计数非法/,
  );
  assert.throws(
    () => summarizeCoverage({ "engine:sequence": { total: 3, pass: 3 } }),
    /必须是 Map/,
  );
});

test("flags unclassified lane names instead of silently dropping them from totals", () => {
  assert.throws(
    () =>
      summarizeCoverage(
        new Map([
          ["engine:sequence", { total: 3, pass: 3 }],
          ["cloud:round-trip", { total: 2, pass: 2 }],
        ]),
      ),
    /未分类 lane「cloud:round-trip」/,
  );
});

test("coverageMismatches reconciles lane totals with the filtered eval-set counts", () => {
  const summary = summarizeCoverage(sampleLanes());
  assert.deepEqual(
    coverageMismatches(summary, { engine: 145, parser: 67 }),
    [],
  );
  const mismatches = coverageMismatches(summary, { engine: 140, parser: 67 });
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0], /engine 层计数 145 ≠ 过滤后评测集应执行 140 条/);
  const both = coverageMismatches(summary, { engine: 140, parser: 60 });
  assert.equal(both.length, 2);
  assert.match(both[1], /parser 层计数 67 ≠ 过滤后评测集应执行 60 条/);
});
