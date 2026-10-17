// M4 τ 校准回流口径钉死测试（node --test）。坏行跳过、分桶计数、推翻率、
// τ 建议门槛（≥30 次 auto 且推翻率 ≤10%）与滑杆幅度聚合都必须可复算。

import assert from "node:assert/strict";
import test from "node:test";
import { aggregateTelemetry } from "./calibrate-tau.mjs";

const lines = [
  // express 双轨：解析 → 环确认 → 应用
  JSON.stringify({
    event: "interpret",
    lane: "express",
    outcome: "plan",
    instruction: "把主体换成红色",
  }),
  JSON.stringify({
    event: "ring-open",
    ring: "target-review",
    lane: "express",
  }),
  JSON.stringify({
    event: "ring-outcome",
    ring: "target-review",
    lane: "express",
    outcome: "confirm",
  }),
  JSON.stringify({ event: "apply", lane: "express", grade: "ready", steps: 1 }),
  // model 轨：解释确认环被推翻（撤销计划）
  JSON.stringify({
    event: "interpret",
    lane: "model",
    outcome: "explain-confirm",
    instruction: "稍微增加一点图片的对比度",
  }),
  JSON.stringify({ event: "ring-open", ring: "explain", lane: "model" }),
  JSON.stringify({
    event: "ring-outcome",
    ring: "explain",
    lane: "model",
    outcome: "reject",
  }),
  // gap-target：开放词汇环 auto 后被人工换候选（override，τ 校准负样本）
  JSON.stringify({
    event: "interpret",
    lane: "gap-target",
    outcome: "gap",
    phrase: "屋顶",
  }),
  JSON.stringify({
    event: "ring-open",
    ring: "open-vocab",
    lane: "gap-target",
    mode: "target",
    count: 3,
    topScore: 0.82,
  }),
  JSON.stringify({
    event: "ring-outcome",
    ring: "open-vocab",
    lane: "gap-target",
    mode: "target",
    outcome: "auto",
    ordinal: 0,
    score: 0.82,
    topScore: 0.82,
    tauAuto: 0.75,
    auto: true,
  }),
  JSON.stringify({
    event: "ring-outcome",
    ring: "open-vocab",
    lane: "gap-target",
    mode: "target",
    outcome: "override",
    ordinal: 1,
    prevOrdinal: 0,
    score: 0.64,
    topScore: 0.82,
    tauAuto: 0.75,
    auto: false,
  }),
  // 滑杆：定稿 +8、放弃 ±0（无修改）
  JSON.stringify({
    event: "slider",
    lane: "express",
    outcome: "save",
    kind: "BrightnessContrast",
    deltas: '{"brightness":8,"contrast":-3}',
  }),
  JSON.stringify({
    event: "slider",
    lane: "model",
    outcome: "discard",
    kind: "HueSaturation",
    deltas: '{"saturation":0}',
  }),
  // 撤销
  JSON.stringify({ event: "undo", lane: "express", kind: "mask-refine" }),
  // 坏行：非 JSON 与未知事件类型计入 skipped；未知解析道静默不进桶；空行忽略
  "not-json",
  JSON.stringify({ event: "nonsense", lane: "express" }),
  JSON.stringify({ event: "interpret", lane: "martian", outcome: "plan" }),
  "",
];

test("aggregateTelemetry buckets lanes, rings, tau and slider deltas", () => {
  const report = aggregateTelemetry(lines);
  assert.equal(report.skipped, 2);
  assert.equal(report.lanes.express.interprets, 1);
  assert.equal(report.lanes.express.ringConfirms, 1);
  assert.equal(report.lanes.express.applies, 1);
  assert.equal(report.lanes.express.undos, 1);
  assert.equal(report.lanes.model.interpretOutcomes["explain-confirm"], 1);
  assert.equal(report.lanes.model.applies, 0);
  assert.equal(report.lanes["gap-target"].interprets, 1);
  assert.equal(report.rings.explain.outcomes.reject, 1);
  assert.equal(report.rings["open-vocab"].opens, 1);
  // 0.82 落在 0.80–0.85 桶：1 auto + 1 override
  assert.equal(report.tau["0.80–0.85"].auto, 1);
  assert.equal(report.tau["0.80–0.85"].override, 1);
  assert.equal(report.slider.saves, 1);
  assert.equal(report.slider.discards, 1);
  assert.equal(report.slider.params["BrightnessContrast.brightness"].count, 1);
  assert.equal(report.slider.params["BrightnessContrast.brightness"].maxAbs, 8);
  assert.equal(report.slider.params["HueSaturation.saturation"].count, 1);
  assert.equal(report.slider.params["HueSaturation.saturation"].maxAbs, 0);
  // 样本远不足 → 不抬 τ
  assert.equal(report.tauSuggested, null);
  assert.equal(report.tauEvidenceSufficient, false);
});

test("tau suggestion requires bucket evidence and low override rate", () => {
  // 0.75–0.80 桶 30 次 auto 0 推翻；0.80–0.85 桶 30 次 auto 6 推翻（20% > 10%）。
  const strong = [];
  for (let i = 0; i < 30; i += 1)
    strong.push(
      JSON.stringify({
        event: "ring-outcome",
        ring: "open-vocab",
        lane: "gap-target",
        outcome: "auto",
        topScore: 0.76,
      }),
    );
  const weak = [];
  for (let i = 0; i < 30; i += 1)
    weak.push(
      JSON.stringify({
        event: "ring-outcome",
        ring: "open-vocab",
        lane: "gap-target",
        outcome: "auto",
        topScore: 0.82,
      }),
    );
  for (let i = 0; i < 6; i += 1)
    weak.push(
      JSON.stringify({
        event: "ring-outcome",
        ring: "open-vocab",
        lane: "gap-target",
        outcome: "override",
        topScore: 0.82,
      }),
    );
  const strongReport = aggregateTelemetry(strong);
  assert.equal(strongReport.tauSuggested, 0.75);
  const weakReport = aggregateTelemetry(weak);
  assert.equal(weakReport.tauSuggested, null);
});

test("score below the calibrated floor and above 1.0 fall outside buckets", () => {
  const report = aggregateTelemetry([
    JSON.stringify({
      event: "ring-outcome",
      ring: "open-vocab",
      lane: "gap-target",
      outcome: "auto",
      topScore: 0.6,
    }),
    JSON.stringify({
      event: "ring-outcome",
      ring: "open-vocab",
      lane: "gap-target",
      outcome: "auto",
      topScore: 0.99,
    }),
  ]);
  assert.equal(report.tau["0.70–0.75"].auto, 0);
  assert.equal(report.tau["0.95–1.00"].auto, 1);
  assert.equal(report.tauSuggested, null);
});
