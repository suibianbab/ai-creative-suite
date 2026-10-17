// §7 指标纯函数（第八轮）：把「实测分数 vs 承诺阈值」的算术与判定从报告
// 装配脚本里抽出来单测。全部函数不碰 fs/网络——section7-metrics.mjs 负责
// 读报告，这里只做数值口径：
//   fraction：分母 0/非有限 → rate=null（「未测量」的唯一表示，永不输出 0）；
//   meetsAtLeast：null rate → null（未测量不判达标也不判未达标）；
//   sumLaneTotals：live-eval lanes 的 {total,pass} 求和。
// 修复必须带回归测试：section7-rates.test.mjs 钉住这些边界。

/** 分数：分子/分母 + rate（4 位小数）。分母非正或任一非有限 → rate=null。 */
export function fraction(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    return { passed: 0, total: 0, rate: null };
  return {
    passed: numerator,
    total: denominator,
    rate: Number((numerator / denominator).toFixed(4)),
  };
}

/** lanes 求和：{laneName: {total, pass}} → {total, pass}。空对象 → total 0。 */
export function sumLaneTotals(lanes) {
  let total = 0;
  let pass = 0;
  for (const lane of Object.values(lanes ?? {})) {
    total += lane.total ?? 0;
    pass += lane.pass ?? 0;
  }
  return { total, pass };
}

/** 承诺判定：rate ≥ threshold？null（未测量）原样透传，不冒充达标/未达标。 */
export function meetsAtLeast(rate, threshold) {
  if (rate === null || rate === undefined) return null;
  if (!Number.isFinite(rate) || !Number.isFinite(threshold)) return null;
  return rate >= threshold;
}

/** 百分比展示（表内用）：null → "未测量"，否则 "90.91%"。 */
export function percentText(rate) {
  if (rate === null || rate === undefined) return "未测量";
  return `${(rate * 100).toFixed(2)}%`;
}
