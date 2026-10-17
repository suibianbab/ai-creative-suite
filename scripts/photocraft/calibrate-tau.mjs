// M4 τ 校准回流（通用语言指令方案 §7 线上回流 + §10 τ_auto 校准）。
// 数据源：dev-bridge 的 POST /v1/telemetry sink 写出的 JSONL
// （.tools/photocraft-serve-qa/telemetry.jsonl，本机 dev 拓扑，gitignored）。
// 汇总口径：
//   · 按解析器分桶（sequence / express / model / gap-target）的确认环点击率、
//     撤销率、应用率——双轨遥测对比（本地快轨 vs 模型轨）；
//   · τ_auto 自动选中（open-vocab 环 outcome=auto）被人工推翻（outcome=override）
//     的比率按 top-1 置信度分桶 → 给出 TAU_AUTO 调整建议；
//   · 滑杆交接的参数修改幅度（|定稿值 − 计划初值|）分布。
// 本脚本只产出证据与建议：TAU_AUTO 仍是 page.tsx 的硬编码常量，按方案 §10
// 月度人工评审后调整（换模型/调阈值必跑 qa 注册表里的钉死评测）。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LANES = ["sequence", "express", "model", "gap-target"];
const RINGS = ["target-review", "open-vocab", "explain"];
const TAU_CURRENT = 0.75;
// 置信度分桶（含下界、不含上界；最后一桶闭区间到 1.00）。
const BUCKETS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
const KNOWN_EVENTS = new Set([
  "interpret",
  "ring-open",
  "ring-outcome",
  "slider",
  "undo",
  "apply",
]);
// 建议门槛：单桶至少 30 次 auto 且推翻率 ≤ 10% 才够证据抬 τ。
const MIN_BUCKET_AUTO = 30;
const MAX_OVERRIDE_RATE = 0.1;

function bucketLabel(score) {
  for (let i = 0; i < BUCKETS.length - 1; i += 1) {
    const low = BUCKETS[i];
    const high = BUCKETS[i + 1];
    if (score >= low && (score < high || (high === 1 && score <= 1)))
      return `${low.toFixed(2)}–${high.toFixed(2)}`;
  }
  return null;
}

function emptyLane() {
  return {
    interprets: 0,
    interpretOutcomes: {},
    ringOpens: 0,
    ringOutcomes: 0,
    ringConfirms: 0,
    undos: 0,
    applies: 0,
  };
}

/**
 * 纯聚合函数：输入 telemetry JSONL 行数组，输出汇总报告对象。
 * 导出供 node --test 钉死口径（scripts/photocraft/test_calibrate_tau.mjs）。
 */
export function aggregateTelemetry(lines) {
  const lanes = Object.fromEntries(LANES.map((lane) => [lane, emptyLane()]));
  const rings = Object.fromEntries(
    RINGS.map((ring) => [ring, { opens: 0, outcomes: {} }]),
  );
  const tau = Object.fromEntries(
    BUCKETS.slice(0, -1).map((low, i) => [
      `${low.toFixed(2)}–${BUCKETS[i + 1].toFixed(2)}`,
      { auto: 0, override: 0 },
    ]),
  );
  const slider = {
    saves: 0,
    discards: 0,
    params: {}, // "BrightnessContrast.brightness" -> { count, sumAbs, maxAbs }
  };
  let skipped = 0;
  let total = 0;
  for (const line of lines) {
    const text = String(line).trim();
    if (!text) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      skipped += 1;
      continue;
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.event !== "string"
    ) {
      skipped += 1;
      continue;
    }
    if (!KNOWN_EVENTS.has(entry.event)) {
      skipped += 1;
      continue;
    }
    total += 1;
    const lane = LANES.includes(entry.lane) ? entry.lane : null;
    if (entry.event === "interpret" && lane) {
      const bucket = lanes[lane];
      bucket.interprets += 1;
      const outcome = String(entry.outcome ?? "unknown");
      bucket.interpretOutcomes[outcome] =
        (bucket.interpretOutcomes[outcome] ?? 0) + 1;
    } else if (entry.event === "ring-open" && RINGS.includes(entry.ring)) {
      rings[entry.ring].opens += 1;
      if (lane) lanes[lane].ringOpens += 1;
    } else if (entry.event === "ring-outcome" && RINGS.includes(entry.ring)) {
      const outcome = String(entry.outcome ?? "unknown");
      rings[entry.ring].outcomes[outcome] =
        (rings[entry.ring].outcomes[outcome] ?? 0) + 1;
      if (lane) {
        const bucket = lanes[lane];
        bucket.ringOutcomes += 1;
        if (["confirm", "auto"].includes(outcome)) bucket.ringConfirms += 1;
      }
      if (entry.ring === "open-vocab") {
        const label =
          typeof entry.topScore === "number"
            ? bucketLabel(entry.topScore)
            : null;
        if (label && tau[label]) {
          if (outcome === "auto") tau[label].auto += 1;
          if (outcome === "override") tau[label].override += 1;
        }
      }
    } else if (entry.event === "slider") {
      if (entry.outcome === "save") slider.saves += 1;
      else if (entry.outcome === "discard") slider.discards += 1;
      if (typeof entry.deltas === "string" && entry.deltas) {
        let deltas = null;
        try {
          deltas = JSON.parse(entry.deltas);
        } catch {
          deltas = null;
        }
        if (deltas && typeof deltas === "object") {
          const kind = String(entry.kind ?? "unknown");
          for (const [param, delta] of Object.entries(deltas)) {
            if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
            const key = `${kind}.${param}`;
            const bucket =
              slider.params[key] ??
              (slider.params[key] = { count: 0, sumAbs: 0, maxAbs: 0 });
            bucket.count += 1;
            bucket.sumAbs += Math.abs(delta);
            bucket.maxAbs = Math.max(bucket.maxAbs, Math.abs(delta));
          }
        }
      }
    } else if (entry.event === "undo" && lane) {
      lanes[lane].undos += 1;
    } else if (entry.event === "apply" && lane) {
      lanes[lane].applies += 1;
    }
  }
  // τ 建议：从当前 τ 所在桶起，找满足证据门槛的最低桶；不满足则维持现值。
  let suggested = null;
  for (const label of Object.keys(tau)) {
    const low = Number(label.split("–")[0]);
    if (low < TAU_CURRENT) continue;
    const { auto, override } = tau[label];
    if (auto >= MIN_BUCKET_AUTO && override / auto <= MAX_OVERRIDE_RATE) {
      suggested = low;
      break;
    }
  }
  return {
    total,
    skipped,
    lanes,
    rings,
    tau,
    slider,
    tauCurrent: TAU_CURRENT,
    tauSuggested: suggested,
    tauEvidenceSufficient: suggested !== null,
  };
}

function pct(numerator, denominator) {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function renderReport(report) {
  const lines = [];
  lines.push("M4 τ 校准回流报告（数据源：dev-bridge /v1/telemetry JSONL）");
  lines.push(
    `事件 ${report.total} 条（跳过坏行 ${report.skipped}）；TAU_AUTO 现值 ${report.tauCurrent}`,
  );
  lines.push("");
  lines.push("── 按解析器分桶（双轨遥测对比）──");
  lines.push(
    "解析道      解析    环打开  环互动  环确认率   撤销   应用   放弃率(计划→未应用)",
  );
  for (const lane of LANES) {
    const bucket = report.lanes[lane];
    const plans =
      (bucket.interpretOutcomes.plan ?? 0) +
      (bucket.interpretOutcomes["explain-confirm"] ?? 0);
    const abandoned = Math.max(0, plans - bucket.applies);
    lines.push(
      `${lane.padEnd(10)} ${String(bucket.interprets).padStart(5)}  ${String(bucket.ringOpens).padStart(5)}  ${String(bucket.ringOutcomes).padStart(5)}  ${pct(bucket.ringConfirms, bucket.ringOutcomes).padStart(7)}  ${String(bucket.undos).padStart(5)}  ${String(bucket.applies).padStart(5)}  ${pct(abandoned, plans).padStart(7)}`,
    );
  }
  lines.push("");
  lines.push("── 提议-确认环分型 ──");
  for (const ring of RINGS) {
    const bucket = report.rings[ring];
    const outcomes = Object.entries(bucket.outcomes)
      .map(([outcome, count]) => `${outcome}×${count}`)
      .join(" ");
    lines.push(
      `${ring}: 打开 ${bucket.opens} 次${outcomes ? `；${outcomes}` : ""}`,
    );
  }
  lines.push("");
  lines.push("── τ_auto 自动选中按 top-1 置信度分桶 ──");
  lines.push("置信度桶     auto  override  推翻率");
  for (const [label, bucket] of Object.entries(report.tau)) {
    const rate = bucket.auto ? (bucket.override / bucket.auto).toFixed(3) : "—";
    lines.push(
      `${label.padEnd(10)} ${String(bucket.auto).padStart(5)}  ${String(bucket.override).padStart(8)}  ${rate.padStart(6)}`,
    );
  }
  lines.push(
    report.tauEvidenceSufficient
      ? `建议：TAU_AUTO ${report.tauCurrent} → ${report.tauSuggested}（该桶 ≥${MIN_BUCKET_AUTO} 次 auto 且推翻率 ≤${MAX_OVERRIDE_RATE * 100}%；按方案 §10 月度评审后改 page.tsx 并跑钉死评测）`
      : `建议：维持 TAU_AUTO ${report.tauCurrent}（无置信度桶同时满足 ≥${MIN_BUCKET_AUTO} 次 auto 且推翻率 ≤${MAX_OVERRIDE_RATE * 100}%——样本不足时不抬阈值）`,
  );
  lines.push("");
  lines.push("── 滑杆修改幅度（|定稿 − 计划初值|）──");
  lines.push(
    `会话：定稿 ${report.slider.saves}、放弃 ${report.slider.discards}`,
  );
  for (const [key, bucket] of Object.entries(report.slider.params)) {
    lines.push(
      `${key}: n=${bucket.count} 平均 |Δ|=${(bucket.sumAbs / bucket.count).toFixed(1)} 最大 |Δ|=${bucket.maxAbs}`,
    );
  }
  if (!Object.keys(report.slider.params).length)
    lines.push("（暂无滑杆会话数据）");
  return lines.join("\n");
}

const args = process.argv.slice(2);
const fileFlag = args.indexOf("--file");
const defaultFiles = [
  join(root, ".tools/photocraft-serve-qa/telemetry.jsonl"),
  join(root, ".tools/photocraft-serve-qa/telemetry.jsonl.1"),
];
const files = fileFlag >= 0 ? [resolve(args[fileFlag + 1])] : defaultFiles;

const lines = files.flatMap((path) => {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
});
const report = aggregateTelemetry(lines);
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (!lines.some((line) => line.trim())) {
    console.log(
      "telemetry.jsonl 尚无数据：在 dev 拓扑里走几轮 提议-确认环/滑杆/撤销 后再跑本脚本（事件由 page.tsx 埋点写入）。",
    );
  }
  console.log(renderReport(report));
}
