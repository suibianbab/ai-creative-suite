// 补充A grounding 指标口径钉死测试（node --test）。IoU/归一化/top-K 命中、
// 多实例匹配、无正确候选、τ 扫描与预先写明的启用门槛都必须可复算——
// 特别是「样本不足 → 维持关闭」与「样本足但误选超标 → 抬 τ 或维持关闭」。

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TAUS,
  evaluateGrounding,
  iou,
  normalizeCandidates,
} from "./grounding-metrics.mjs";

test("iou: identical, disjoint and known overlap", () => {
  assert.equal(iou([0.1, 0.1, 0.4, 0.4], [0.1, 0.1, 0.4, 0.4]), 1);
  assert.equal(iou([0, 0, 0.2, 0.2], [0.5, 0.5, 0.2, 0.2]), 0);
  // 交集 0.0625 / 并集 0.4375 = 1/7
  assert.ok(
    Math.abs(iou([0, 0, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]) - 1 / 7) < 1e-9,
  );
});

test("normalizeCandidates: 归一化 bounds、按 score 降序、过滤坏候选、no-regions 为空", () => {
  const ranked = normalizeCandidates({
    width: 1024,
    height: 768,
    candidates: [
      { score: 0.4, clip_score: 0.7, bounds: [512, 384, 256, 192] },
      { score: 0.9, bounds: [0, 0, 512, 384] },
      { score: 0.8, bounds: [1, 1, 1] }, // 坏长度
      { score: Number.NaN, bounds: [0, 0, 10, 10] }, // 坏分数
    ],
  });
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked[0], {
    score: 0.9,
    clipScore: null,
    box: [0, 0, 0.5, 0.5],
  });
  assert.deepEqual(ranked[1].box, [0.5, 0.5, 0.25, 0.25]);
  assert.equal(ranked[1].clipScore, 0.7);
  assert.deepEqual(
    normalizeCandidates({ candidates: [], reason: "no-regions" }),
    [],
  );
  assert.deepEqual(normalizeCandidates(null), []);
});

// 合成集：flower 3 目标（top1 命中 / 高分误选 / 无候选），building 2 目标
// （低分命中第二实例 / 高分误选）。
function syntheticRecords() {
  return [
    {
      image: "a.jpg",
      domain: "flower",
      phrase: "向日葵",
      gtBoxes: [[0.1, 0.1, 0.4, 0.4]],
      candidates: [
        { score: 0.9, box: [0.1, 0.1, 0.4, 0.4] },
        { score: 0.5, box: [0.8, 0.8, 0.1, 0.1] },
      ],
    },
    {
      image: "b.jpg",
      domain: "flower",
      phrase: "绿叶",
      gtBoxes: [[0.2, 0.2, 0.3, 0.3]],
      candidates: [{ score: 0.55, box: [0.7, 0.7, 0.2, 0.2] }],
    },
    {
      image: "c.jpg",
      domain: "flower",
      phrase: "花蕊",
      gtBoxes: [[0.4, 0.4, 0.1, 0.1]],
      candidates: [],
    },
    {
      image: "d.jpg",
      domain: "building",
      phrase: "椅子",
      // 多实例：top-1 恰好匹配第二实例框
      gtBoxes: [
        [0.1, 0.1, 0.2, 0.2],
        [0.6, 0.6, 0.2, 0.2],
      ],
      candidates: [{ score: 0.4, box: [0.6, 0.6, 0.2, 0.2] }],
    },
    {
      image: "e.jpg",
      domain: "building",
      phrase: "房屋",
      gtBoxes: [[0, 0, 1, 0.72]],
      candidates: [{ score: 0.8, box: [0, 0, 0.2, 0.2] }],
    },
  ];
}

test("evaluateGrounding: 分题材命中率、无候选、无正确候选", () => {
  const report = evaluateGrounding(syntheticRecords());
  assert.equal(report.total, 5);
  assert.equal(report.byDomain.flower.targets, 3);
  assert.equal(report.byDomain.flower.top1Hits, 1);
  assert.ok(Math.abs(report.byDomain.flower.top1Rate - 1 / 3) < 1e-9);
  assert.equal(report.byDomain.flower.noCandidate, 1);
  // flower 无正确候选 = 高分误选 + 无候选 = 2
  assert.equal(report.byDomain.flower.noCorrect, 2);
  // building：低分命中（多实例第二框）+ 高分误选
  assert.equal(report.byDomain.building.top1Hits, 1);
  assert.equal(report.byDomain.building.noCorrect, 1);
  assert.equal(report.byDomain.building.noCandidate, 0);
  assert.ok(Math.abs(report.overall.top1Rate - 0.4) < 1e-9);
  assert.ok(Math.abs(report.overall.noCorrectRate - 0.6) < 1e-9);
  // IoU 恰等于阈值（0.5）按命中计（>=）
  const boundary = evaluateGrounding([
    {
      image: "x.jpg",
      domain: "pet",
      phrase: "猫",
      gtBoxes: [[0, 0, 1, 1]],
      candidates: [{ score: 0.9, box: [0.5, 0, 0.5, 1] }],
    },
  ]);
  assert.equal(boundary.byDomain.pet.top1Hits, 1);
});

test("evaluateGrounding: τ 扫描的自动选中/误选/确认计数", () => {
  const report = evaluateGrounding(syntheticRecords());
  const at = (tau) => report.tauSweep.find((s) => s.tau === tau);
  // τ=0.5：r1/r2/r5 自动选中（score ≥0.5），其中 r2/r5 误选 → 2/3
  const t05 = at(0.5);
  assert.equal(t05.autoSelected, 3);
  assert.equal(t05.falseAuto, 2);
  assert.ok(Math.abs(t05.falseAutoRate - 2 / 3) < 1e-9);
  assert.equal(t05.confirmNeeded, 2);
  assert.equal(t05.domainAuto.flower, 2);
  assert.equal(t05.domainFalse.flower, 1);
  // τ=0.75：r1(0.9)/r5(0.8) 选中，r5 误选 → 0.5；r2/r3/r4 需确认
  const t075 = at(0.75);
  assert.equal(t075.autoSelected, 2);
  assert.equal(t075.falseAuto, 1);
  assert.equal(t075.confirmNeeded, 3);
  // τ=0.95：无人达标 → 全部走确认环，误选率无定义
  const t095 = at(0.95);
  assert.equal(t095.autoSelected, 0);
  assert.equal(t095.falseAutoRate, null);
  assert.equal(t095.confirmNeeded, 5);
  // 默认扫描表覆盖 0.50–0.95
  assert.equal(DEFAULT_TAUS[0], 0.5);
  assert.equal(DEFAULT_TAUS[DEFAULT_TAUS.length - 1], 0.95);
});

test("gate: 样本不足 → 维持关闭（合成集每域 <30）", () => {
  const report = evaluateGrounding(syntheticRecords());
  assert.equal(report.gate.decision, "keep-off");
  assert.equal(report.gate.suggestedTau, null);
  assert.match(report.gate.rationale, /维持 false/);
});

test("gate: 样本足且误选达标 → 给出满足门槛的最低 τ", () => {
  const records = [];
  for (let i = 0; i < 30; i += 1) {
    records.push({
      image: `f${i}.jpg`,
      domain: "flower",
      phrase: "花",
      gtBoxes: [[0.1, 0.1, 0.5, 0.5]],
      candidates: [{ score: 0.9, box: [0.1, 0.1, 0.5, 0.5] }],
    });
    records.push({
      image: `b${i}.jpg`,
      domain: "building",
      phrase: "屋顶",
      gtBoxes: [[0.2, 0.2, 0.4, 0.4]],
      candidates: [{ score: 0.9, box: [0.2, 0.2, 0.4, 0.4] }],
    });
  }
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "enable");
  assert.equal(report.gate.suggestedTau, 0.5);
});

test("gate: 样本足但抬 τ 后 auto 事件不足 30 → 维持关闭（不得用「零/少自动选中」凑 enable）", () => {
  const records = [];
  for (let i = 0; i < 30; i += 1) {
    records.push({
      image: `f${i}.jpg`,
      domain: "flower",
      phrase: "花",
      gtBoxes: [[0.1, 0.1, 0.5, 0.5]],
      candidates: [{ score: 0.9, box: [0.1, 0.1, 0.5, 0.5] }],
    });
    records.push({
      image: `b${i}.jpg`,
      domain: "building",
      phrase: "屋顶",
      gtBoxes: [[0.2, 0.2, 0.4, 0.4]],
      // 前 5 张高分误选（0.55 ≥ τ=0.5 但框不命中），其余高分正确。
      // τ=0.5：building 30 auto、5 误选 = 16.7% > 10% 不通过；
      // τ≥0.6：误选样本落到确认侧后 building 只剩 25 次 auto < 30 → 证据不足。
      candidates:
        i < 5
          ? [{ score: 0.55, box: [0.7, 0.7, 0.2, 0.2] }]
          : [{ score: 0.9, box: [0.2, 0.2, 0.4, 0.4] }],
    });
  }
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "keep-off");
  assert.equal(report.gate.suggestedTau, null);
  // blocker 须同时说清「误选超标」与「抬 τ 后证据不足」两个事实
  assert.ok(
    report.gate.blockers.some(
      (b) =>
        b.includes("building") &&
        b.includes("误选率") &&
        b.includes("证据不足"),
    ),
  );
  const t06 = report.tauSweep.find((s) => s.tau === 0.6);
  assert.equal(t06.domainGate.building.status, "insufficient-auto");
});

test("gate: 样本足、误选超标可被 τ 抬过且 auto 仍 ≥30 → 在该 τ 启用", () => {
  const records = [
    ...bulkDomain("flower", { total: 30, correct: 30 }),
    ...bulkDomain("building", { total: 30, correct: 30 }),
  ];
  // building 追加 4 个低分误选：τ=0.5 时 34 auto、4 误选 ≈ 11.8% > 10% 不通过；
  // τ=0.6 时剩 30 auto、0 误选 → 通过，最低启用 τ=0.6
  for (let j = 0; j < 4; j += 1)
    records.push({
      image: `bad${j}.jpg`,
      domain: "building",
      phrase: "屋顶",
      gtBoxes: [[0.2, 0.2, 0.4, 0.4]],
      candidates: [{ score: 0.55, box: [0.7, 0.7, 0.2, 0.2] }],
    });
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "enable");
  assert.equal(report.gate.suggestedTau, 0.6);
  assert.equal(report.gate.suggestedDomains.building.auto, 30);
  assert.equal(report.gate.suggestedDomains.flower.status, "pass");
});

test("gate: 样本足但高分误选贯穿所有 τ → 维持关闭", () => {
  const records = [];
  for (let i = 0; i < 30; i += 1) {
    records.push({
      image: `f${i}.jpg`,
      domain: "flower",
      phrase: "花",
      gtBoxes: [[0.1, 0.1, 0.5, 0.5]],
      candidates: [{ score: 0.95, box: [0.1, 0.1, 0.5, 0.5] }],
    });
    records.push({
      image: `b${i}.jpg`,
      domain: "building",
      phrase: "屋顶",
      gtBoxes: [[0.2, 0.2, 0.4, 0.4]],
      candidates: [{ score: 0.95, box: [0.7, 0.7, 0.2, 0.2] }],
    });
  }
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "keep-off");
  assert.equal(report.gate.suggestedTau, null);
  assert.ok(report.gate.blockers.some((b) => b.includes("误选率")));
});

// ---- codex 第四轮 A 验收：0/30、1/30、29/30、30/30、多题材一域不足 ----

function bulkDomain(domain, { total, correct }) {
  const records = [];
  for (let i = 0; i < total; i += 1) {
    const hit = i < correct;
    records.push({
      image: `${domain}${i}.jpg`,
      domain,
      phrase: "目标",
      gtBoxes: [[0.2, 0.2, 0.4, 0.4]],
      candidates: [
        {
          score: hit ? 0.9 : 0.3,
          box: hit ? [0.2, 0.2, 0.4, 0.4] : [0.7, 0.7, 0.2, 0.2],
        },
      ],
    });
  }
  return records;
}

test("gate: 0/30 auto（全部低于最低 τ）→ 维持关闭（回归：旧口径会误判安全并启用 τ=0.5）", () => {
  const report = evaluateGrounding(
    bulkDomain("flower", { total: 30, correct: 0 }),
  );
  assert.equal(report.gate.decision, "keep-off");
  assert.equal(report.gate.suggestedTau, null);
  assert.ok(report.gate.blockers.some((b) => b.includes("自动选中 0")));
  assert.equal(
    report.tauSweep[0].domainGate.flower.status,
    "insufficient-auto",
  );
});

test("gate: 1/30 auto → 维持关闭（证据不足）", () => {
  const report = evaluateGrounding(
    bulkDomain("flower", { total: 30, correct: 1 }),
  );
  assert.equal(report.gate.decision, "keep-off");
  assert.ok(report.gate.blockers.some((b) => b.includes("自动选中 1")));
});

test("gate: 29/30 auto → 维持关闭（差一例也不足 30）", () => {
  const report = evaluateGrounding(
    bulkDomain("flower", { total: 30, correct: 29 }),
  );
  assert.equal(report.gate.decision, "keep-off");
  assert.ok(report.gate.blockers.some((b) => b.includes("自动选中 29")));
});

test("gate: 多题材一域样本不足（29 目标全命中）→ 维持关闭", () => {
  const records = [
    ...bulkDomain("flower", { total: 30, correct: 30 }),
    ...bulkDomain("building", { total: 29, correct: 29 }),
  ];
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "keep-off");
  assert.ok(report.gate.blockers.some((b) => b.includes("目标数 29")));
  assert.equal(report.gate.domainTargets.building, 29);
});

test("gate: 多题材一域 auto 不足（30 目标仅 28 auto）→ 维持关闭", () => {
  const records = [
    ...bulkDomain("flower", { total: 30, correct: 30 }),
    ...bulkDomain("building", { total: 30, correct: 28 }),
  ];
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "keep-off");
  assert.ok(report.gate.blockers.some((b) => b.includes("自动选中 28")));
});

test("gate: 30/30 auto 且全对 → enable（沿用既有用例口径）", () => {
  const records = [
    ...bulkDomain("flower", { total: 30, correct: 30 }),
    ...bulkDomain("building", { total: 30, correct: 30 }),
  ];
  const report = evaluateGrounding(records);
  assert.equal(report.gate.decision, "enable");
  assert.equal(report.gate.suggestedTau, 0.5);
  assert.deepEqual(report.gate.blockers, []);
});
