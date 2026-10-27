// 中文量级记数法展示（P2-2，Codex 复核 2026-10-28）：大数字按用户口语习惯
// 显示为 万/亿 记法——同一数值的另一种写法，不做任何数据换算（1200000 →
// 「120万」；530 原样）。整除性不满足时保留原数字（12345 → 「12345」），
// 避免把用户没说过的近似值显示出去。纯函数，供 bar-chart/number-counter
// 的值文本使用。
export function formatCnCount(value: number): string {
  if (!Number.isFinite(value) || value < 10000) {
    return String(value);
  }
  // 一位小数能整表（1.2亿 / 1.5万）优先于整数判定（120000000 = 1.2亿
  // 而非 12000万——与用户口语一致）。
  const exactOneDecimal = (x: number) =>
    Math.abs(x * 10 - Math.round(x * 10)) < 1e-9;
  const yi = value / 1e8;
  if (Number.isInteger(yi)) return `${yi}亿`;
  if (value >= 1e8 && exactOneDecimal(yi))
    return `${Math.round(yi * 10) / 10}亿`;
  const wan = value / 1e4;
  if (Number.isInteger(wan)) return `${wan}万`;
  if (exactOneDecimal(wan)) return `${Math.round(wan * 10) / 10}万`;
  return String(value);
}
