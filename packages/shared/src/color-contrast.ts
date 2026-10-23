// WCAG relative luminance and contrast for opaque #rrggbb colors.
// Scene rendering and Style Bible use the same decision at the 4.5:1 boundary.
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableTextColor(
  candidate: string,
  boxColor: string,
  fallback?: string,
): string {
  if (contrastRatio(candidate, boxColor) >= 4.5) return candidate;
  if (fallback && contrastRatio(fallback, boxColor) >= 4.5) return fallback;
  // Compare actual black/white contrast; equivalent to the WCAG crossover
  // near L=0.1791 without a rounded magic threshold.
  return contrastRatio("#000000", boxColor) >=
    contrastRatio("#ffffff", boxColor)
    ? "#000000"
    : "#ffffff";
}
