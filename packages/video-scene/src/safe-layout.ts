import type { FrameContext } from "./registry.js";
import { emUnits } from "./text-width.js";

export function isPortrait(ctx: FrameContext): boolean {
  return ctx.height > ctx.width;
}

// Keep titles, values and labels clear of device crops and player controls.
export function safeFrame(ctx: FrameContext) {
  return {
    left: ctx.width * 0.1,
    right: ctx.width * 0.9,
    top: ctx.height * 0.1,
    bottom: ctx.height * 0.9,
    width: ctx.width * 0.8,
    // emUnits is an estimate; reserve another 10% for actual font glyph widths.
    textWidth: ctx.width * 0.72,
    height: ctx.height * 0.8,
  };
}

function wrapAtSize(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    if (char === "\n") {
      lines.push(line.trim());
      line = "";
      continue;
    }
    const next = line + char;
    if (line && emUnits(next) * size > maxWidth) {
      lines.push(line.trim());
      line = char.trimStart();
    } else {
      line = next;
    }
  }
  if (line || lines.length === 0) lines.push(line.trim());
  return lines;
}

export function fitWrappedText(
  text: string,
  preferredSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; fontSize: number } {
  if (maxLines === 2 && !text.includes("\n")) {
    const singleSize = Math.min(preferredSize, maxWidth / (emUnits(text) || 1));
    if (singleSize >= preferredSize * 0.9) {
      return { lines: [text], fontSize: singleSize };
    }
    const chars = Array.from(text);
    const closePunctuation = /^[，。！？：；、,.!?;:]$/u;
    const openPunctuation = /^[（《“(\[\{]$/u;
    let best: { lines: string[]; fontSize: number; score: number } | undefined;
    for (let split = 1; split < chars.length; split++) {
      const left = chars.slice(0, split).join("").trimEnd();
      const right = chars.slice(split).join("").trimStart();
      if (!left || !right) continue;
      if (
        closePunctuation.test(Array.from(right)[0]!) ||
        openPunctuation.test(Array.from(left).at(-1)!)
      )
        continue;
      const leftWidth = emUnits(left);
      const rightWidth = emUnits(right);
      const size = Math.min(
        preferredSize,
        maxWidth / Math.max(leftWidth, rightWidth),
      );
      const punctuationBonus = closePunctuation.test(Array.from(left).at(-1)!)
        ? preferredSize * 0.12
        : 0;
      const score =
        size +
        punctuationBonus -
        Math.abs(leftWidth - rightWidth) * size * 0.005;
      if (!best || score > best.score) {
        best = { lines: [left, right], fontSize: size, score };
      }
    }
    if (best) return { lines: best.lines, fontSize: best.fontSize };
  }
  let fontSize = preferredSize;
  let lines = wrapAtSize(text, fontSize, maxWidth);
  while (lines.length > maxLines && fontSize > 1) {
    fontSize *= 0.95;
    lines = wrapAtSize(text, fontSize, maxWidth);
  }
  return { lines, fontSize };
}
