// 文本度量纯函数（设计空间与画布像素空间通用，单位由调用方决定）。
// 从 text-animation 提取（P2-①），图表组件与文字组件共用同一 em 口径。

// 估算一行文本的 em 宽：CJK/全角类字符按 1em，其余（拉丁/数字/空格）按 0.6em。
export function emUnits(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! >= 0x2e80 ? 1 : 0.6;
  }
  return width;
}

// 字号钳制：base 是期望字号；若文本行会超出 maxWidth（调用方已乘安全系数），
// 等比缩到限内。空文本不渲染字形，直接返回 base。
export function fitFontSize(
  base: number,
  text: string,
  maxWidth: number,
): number {
  const em = emUnits(text);
  if (em === 0) return base;
  return Math.min(base, maxWidth / em);
}
