// 补充A（未完成项 3）：跨题材真图 grounding 评测的纯指标模块。
// 输入是「每个 (图, 短语) 目标一条」的评测记录（候选已按服务契约取回并
// 归一化），输出补充A 验收要求的全部口径：
//   · 分题材 top-1 / top-3 命中率（IoU ≥ 阈值，与 annotations.json 同阈值）；
//   · 无正确候选比例（服务端 no-regions 或候选全不命中）；
//   · τ 扫描（0.50–0.95）：各阈值下的自动选中数、误自动选中率、需人工确认次数；
//   · 预先写明的启用门槛：每个题材「目标数 ≥30、该 τ 下实际自动选中 ≥30、
//     误自动选中率 ≤10%」三者同时满足才建议启用（口径对齐 calibrate-tau.mjs
//     数实际 auto 事件而非样本数；auto=0 是证据不足，不是安全），否则维持
//     关闭（仍可经确认环完成编辑）。
// 门槛常量与 calibrate-tau.mjs 的 τ 校准回流一致（MIN_BUCKET_AUTO=30、
// MAX_OVERRIDE_RATE=0.1），两处口径不另立标准。
// 纯函数无 IO：live 侧由 grounding-eval.mjs 取数后调用；口径由
// grounding-metrics.test.mjs 钉死。

// 服务返回的 bounds 是「返回图（最长边 ≤1024）」像素坐标，除以返回宽高
// 得到与标注一致的归一化框；候选按 score 降序（服务端已排序，防御性再排）。
export function normalizeCandidates(response) {
  if (!response || typeof response !== "object") return [];
  const { width, height } = response;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  )
    return [];
  return (Array.isArray(response.candidates) ? response.candidates : [])
    .filter(
      (c) =>
        c &&
        Number.isFinite(c.score) &&
        Array.isArray(c.bounds) &&
        c.bounds.length === 4 &&
        c.bounds.every((v) => Number.isFinite(v)),
    )
    .map((c) => ({
      score: c.score,
      clipScore: Number.isFinite(c.clip_score) ? c.clip_score : null,
      box: [
        c.bounds[0] / width,
        c.bounds[1] / height,
        c.bounds[2] / width,
        c.bounds[3] / height,
      ],
    }))
    .sort((a, b) => b.score - a.score);
}

// 归一化 [x,y,w,h] 框的 IoU。
export function iou(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

// 候选与任一 GT 框的最大 IoU（多实例目标：匹配任意实例即算）。
export function bestIou(candidateBox, gtBoxes) {
  let best = 0;
  for (const gt of gtBoxes) best = Math.max(best, iou(candidateBox, gt));
  return best;
}

export const DEFAULT_TAUS = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];
// 与 calibrate-tau.mjs 相同的证据门槛：样本不足时不启用自动选中。
export const MIN_BUCKET_AUTO = 30;
export const MAX_FALSE_AUTO_RATE = 0.1;

function hitStats(record, threshold) {
  const ranked = record.candidates;
  const top1Hit =
    ranked.length > 0 && bestIou(ranked[0].box, record.gtBoxes) >= threshold;
  const top3Hit = ranked
    .slice(0, 3)
    .some((c) => bestIou(c.box, record.gtBoxes) >= threshold);
  const anyHit = ranked.some(
    (c) => bestIou(c.box, record.gtBoxes) >= threshold,
  );
  return { top1Hit, top3Hit, anyHit, noCandidate: ranked.length === 0 };
}

function emptyDomain() {
  return {
    targets: 0,
    top1Hits: 0,
    top3Hits: 0,
    anyHits: 0,
    noCandidate: 0,
    noCorrect: 0,
  };
}

/**
 * 纯评测函数。
 * @param {Array<{image:string, domain:string, phrase:string,
 *   gtBoxes:number[][], candidates:{score:number, box:number[]}[]}>>} records
 * @param {{hitIoUThreshold?:number, taus?:number[], minBucketAuto?:number,
 *   maxFalseAutoRate?:number}} [options]
 */
export function evaluateGrounding(records, options = {}) {
  const hitIoUThreshold = options.hitIoUThreshold ?? 0.5;
  const taus = options.taus ?? DEFAULT_TAUS;
  const minBucketAuto = options.minBucketAuto ?? MIN_BUCKET_AUTO;
  const maxFalseAutoRate = options.maxFalseAutoRate ?? MAX_FALSE_AUTO_RATE;

  const byDomain = new Map();
  const perTarget = [];
  for (const record of records) {
    const domain = byDomain.get(record.domain) ?? emptyDomain();
    domain.targets += 1;
    const stats = hitStats(record, hitIoUThreshold);
    if (stats.top1Hit) domain.top1Hits += 1;
    if (stats.top3Hit) domain.top3Hits += 1;
    if (stats.anyHit) domain.anyHits += 1;
    if (stats.noCandidate) domain.noCandidate += 1;
    if (!stats.anyHit) domain.noCorrect += 1;
    byDomain.set(record.domain, domain);
    perTarget.push({
      image: record.image,
      domain: record.domain,
      phrase: record.phrase,
      top1Score: record.candidates[0]?.score ?? null,
      top1Iou: record.candidates.length
        ? bestIou(record.candidates[0].box, record.gtBoxes)
        : 0,
      ...stats,
    });
  }

  // τ 扫描：top-1 score ≥ τ 时产品会自动选中该候选；选中但不命中 GT 即
  // 误自动选中（falseAuto）。score < τ 或无候选都需要人工确认环兜底。
  const tauSweep = taus.map((tau) => {
    let autoSelected = 0;
    let falseAuto = 0;
    let confirmNeeded = 0;
    const domainAuto = new Map();
    const domainFalse = new Map();
    for (const record of records) {
      const domain = record.domain;
      domainAuto.set(domain, domainAuto.get(domain) ?? 0);
      domainFalse.set(domain, domainFalse.get(domain) ?? 0);
      const top = record.candidates[0];
      if (top && top.score >= tau) {
        autoSelected += 1;
        domainAuto.set(domain, domainAuto.get(domain) + 1);
        if (bestIou(top.box, record.gtBoxes) < hitIoUThreshold) {
          falseAuto += 1;
          domainFalse.set(domain, domainFalse.get(domain) + 1);
        }
      } else {
        confirmNeeded += 1;
      }
    }
    return {
      tau,
      autoSelected,
      falseAuto,
      falseAutoRate: autoSelected ? falseAuto / autoSelected : null,
      confirmNeeded,
      domainAuto: Object.fromEntries(domainAuto),
      domainFalse: Object.fromEntries(domainFalse),
    };
  });

  // 预先写明的启用门槛（验收条款）：在拟启用的每个 τ 下，每个题材须同时满足
  //   目标数 ≥ minBucketAuto、实际自动选中数 ≥ minBucketAuto、误选率 ≤ maxFalseAutoRate。
  // auto 事件数随 τ 单调不增（score ≥ τ' 的集合是 score ≥ τ 的子集），故某题材
  // 在最宽 τ 下证据不足时更高 τ 只会更少——「零次自动选中」按证据不足处理，
  // 不得当作安全凑出全局 enable（分题材开关须显式引入策略，当前只有全局开关）。
  const domainTargets = Object.fromEntries(
    [...byDomain.entries()].map(([d, v]) => [d, v.targets]),
  );
  const gateDomain = (step, d) => {
    const targets = domainTargets[d] ?? 0;
    const auto = step.domainAuto[d] ?? 0;
    const bad = step.domainFalse[d] ?? 0;
    let status;
    if (targets < minBucketAuto) status = "insufficient-targets";
    else if (auto < minBucketAuto) status = "insufficient-auto";
    else if (bad / auto > maxFalseAutoRate) status = "false-rate-exceeded";
    else status = "pass";
    return {
      targets,
      auto,
      false: bad,
      falseRate: auto ? bad / auto : null,
      status,
    };
  };
  // 每个扫描步都带逐题材门槛状态，报告可复算任何 τ 下的决策依据。
  for (const step of tauSweep)
    step.domainGate = Object.fromEntries(
      [...byDomain.keys()].map((d) => [d, gateDomain(step, d)]),
    );
  const allPass = (step) =>
    byDomain.size > 0 &&
    Object.values(step.domainGate).every((g) => g.status === "pass");
  let suggestedTau = null;
  let suggestedStep = null;
  for (const step of tauSweep) {
    if (allPass(step)) {
      suggestedTau = step.tau;
      suggestedStep = step;
      break;
    }
  }
  // keep-off 的未通过原因：只列「任何 τ 下都不通过」的题材；同一题材在扫描中
  // 可能先后呈现「误选超标」与「证据不足」两种失败（抬 τ 压掉误选后 auto 变少），
  // blocker 须把两个事实一起说清，计数取证据最多的最宽 τ。
  const evidenceStep = tauSweep[0];
  const blockers = [];
  if (suggestedTau === null) {
    for (const d of byDomain.keys()) {
      if (tauSweep.some((step) => step.domainGate[d].status === "pass"))
        continue;
      const statuses = new Set(
        tauSweep.map((step) => step.domainGate[d].status),
      );
      const gate = evidenceStep.domainGate[d];
      if (statuses.has("insufficient-targets")) {
        blockers.push(
          `${d}: 目标数 ${gate.targets} < ${minBucketAuto}（样本不足）`,
        );
      } else if (
        statuses.has("insufficient-auto") &&
        statuses.has("false-rate-exceeded")
      ) {
        blockers.push(
          `${d}: 最宽 τ 误选率 ${(gate.falseRate * 100).toFixed(1)}% > ${maxFalseAutoRate * 100}%，抬 τ 压掉误选后自动选中 < ${minBucketAuto}（证据不足）`,
        );
      } else if (statuses.has("insufficient-auto")) {
        blockers.push(
          `${d}: 自动选中 ${gate.auto} < ${minBucketAuto}（证据不足）`,
        );
      } else {
        const bestRate = Math.min(
          ...tauSweep.map((step) => step.domainGate[d].falseRate ?? 1),
        );
        blockers.push(
          `${d}: 各 τ 误选率 ≥ ${(bestRate * 100).toFixed(1)}% > ${maxFalseAutoRate * 100}%`,
        );
      }
    }
    if (!blockers.length)
      blockers.push(
        byDomain.size === 0
          ? "评测集为空"
          : "无单一 τ 能同时满足全部题材（各题材通过区间不相交）",
      );
  }
  const total = records.length;
  const sum = (key) =>
    [...byDomain.values()].reduce((acc, v) => acc + v[key], 0);
  return {
    hitIoUThreshold,
    total,
    overall: {
      top1Rate: total ? sum("top1Hits") / total : null,
      top3Rate: total ? sum("top3Hits") / total : null,
      noCandidateRate: total ? sum("noCandidate") / total : null,
      noCorrectRate: total ? sum("noCorrect") / total : null,
    },
    byDomain: Object.fromEntries(
      [...byDomain.entries()].map(([domain, v]) => [
        domain,
        {
          ...v,
          top1Rate: v.targets ? v.top1Hits / v.targets : null,
          top3Rate: v.targets ? v.top3Hits / v.targets : null,
          noCandidateRate: v.targets ? v.noCandidate / v.targets : null,
          noCorrectRate: v.targets ? v.noCorrect / v.targets : null,
        },
      ]),
    ),
    tauSweep,
    gate: {
      minBucketAuto,
      maxFalseAutoRate,
      domainTargets,
      suggestedTau,
      // 证据不足（任一题材样本/auto 事件 < 门槛）与「证据充足但误选超标」都维持关闭。
      decision: suggestedTau === null ? "keep-off" : "enable",
      rationale:
        suggestedTau === null
          ? `未达预先写明的启用门槛（各题材目标 ≥${minBucketAuto}、实际自动选中 ≥${minBucketAuto} 且误选率 ≤${maxFalseAutoRate * 100}% 无一 τ 同时满足；${blockers.join("；")}），TAU_AUTO_ENABLED 维持 false；编辑仍经人工确认环完成`
          : `各题材在 τ=${suggestedTau} 下目标 ≥${minBucketAuto}、实际自动选中 ≥${minBucketAuto} 且误自动选中率 ≤${maxFalseAutoRate * 100}%，满足预先写明的启用门槛（扩样本后仍须人工评审）`,
      // keep-off 时的未通过原因（enable 时为空）；逐 τ 计数见 tauSweep[].domainGate。
      blockers,
      // 证据上界（最宽 τ）下每题材的三计数与状态。
      evidence: { tau: evidenceStep.tau, domains: evidenceStep.domainGate },
      // 启用 τ 下每题材的三计数（keep-off 时为 null）。
      suggestedDomains: suggestedStep ? suggestedStep.domainGate : null,
    },
    perTarget,
  };
}
