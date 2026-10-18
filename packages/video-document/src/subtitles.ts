// 字幕 cue 构建（spec R1/R2）：字幕是 narrationText × 字级时间戳的派生投影，
// 不入 VideoProject schema。导出路径（CLI）给 words 精确时间戳；浏览器预览
// 只给 spanMs 走字符均匀分布（近似，UI 标注）。
export type SubtitleCue = { text: string; startMs: number; endMs: number };
export type SubtitleWordTiming = {
  text: string;
  beginMs: number;
  endMs: number;
};

export const SUBTITLE_MAX_CUE_CHARS = 10;
const PAUSE_MARKS = new Set(["，", "！", "？", "；", "、", "。"]);

function isCueBreakChar(text: string): boolean {
  return PAUSE_MARKS.has(text);
}

// 单元是否以停顿标点收口（多字符单元看末字——原始字符映射后单元可含
// 空格/多字，切分语义以最后一个字符为准）。
function unitBreaks(unit: { text: string }): boolean {
  return unit.text.length > 0 && isCueBreakChar(unit.text.at(-1)!);
}

// 连续字累积成 cue：遇停顿标点收口；不遇则 ≤SUBTITLE_MAX_CUE_CHARS 断开。
function groupIntoCues(
  units: { text: string; startMs: number; endMs: number }[],
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let buffer: { text: string; startMs: number; endMs: number }[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    cues.push({
      text: buffer.map((unit) => unit.text).join(""),
      startMs: buffer[0]!.startMs,
      endMs: buffer[buffer.length - 1]!.endMs,
    });
    buffer = [];
  };
  for (const unit of units) {
    buffer.push(unit);
    const chars = buffer.reduce((n, item) => n + [...item.text].length, 0);
    if (unitBreaks(unit) || chars >= SUBTITLE_MAX_CUE_CHARS) flush();
  }
  flush();
  return cues;
}

// 字级 token 的时间戳投影到原始旁白字符（spec R2：cue 文本取原始字符，
// 不用 word.text 拼接）。TTS 会规范化文本——实测「要点 1。」的 token 是
// 「、」「一」（数字变汉字、多出顿号）。逐字对齐：相等即配对；空白归入
// 当前单元不耗 token；不等时在有限前瞻内找下一个相等锚点，锚点前的两段
// 区间把原文按 token 数比例分摊；完全无锚点返回 null（调用方按 token 时间
// 包络均匀分布原文——文本保真优先，时间退而近似）。
const ANCHOR_WINDOW = 6;

export function mapNarrationTextToWords(
  text: string,
  words: SubtitleWordTiming[],
): { text: string; startMs: number; endMs: number }[] | null {
  const chars = [...text];
  const alloc = words.map(() => "");
  let i = 0;
  let j = 0;
  while (j < words.length) {
    if (i >= chars.length) break;
    const token = words[j]!.text;
    const slice = chars.slice(i, i + token.length).join("");
    if (token.length > 0 && slice === token) {
      alloc[j] += token;
      i += token.length;
      j += 1;
      continue;
    }
    if (/\s/.test(chars[i]!)) {
      alloc[j] += chars[i]!;
      i += 1;
      continue;
    }
    let anchor: { di: number; dj: number } | null = null;
    search: for (let cost = 2; cost <= ANCHOR_WINDOW * 2; cost += 1) {
      for (let di = 1; di < cost && di <= ANCHOR_WINDOW; di += 1) {
        const dj = cost - di;
        if (dj < 1 || dj > ANCHOR_WINDOW) continue;
        const ahead = words[j + dj];
        if (!ahead || ahead.text.length === 0) continue;
        if (i + di >= chars.length) continue;
        const aheadSlice = chars
          .slice(i + di, i + di + ahead.text.length)
          .join("");
        if (aheadSlice === ahead.text) {
          anchor = { di, dj };
          break search;
        }
      }
    }
    if (!anchor) return null;
    const region = chars.slice(i, i + anchor.di);
    for (let k = 0; k < anchor.dj; k += 1) {
      const start = Math.floor((region.length * k) / anchor.dj);
      const end = Math.floor((region.length * (k + 1)) / anchor.dj);
      alloc[j + k] += region.slice(start, end).join("");
    }
    i += anchor.di;
    j += anchor.dj;
  }
  if (j === 0) return null; // 首字即无锚点：包络均匀
  if (i < chars.length) {
    alloc[words.length - 1] += chars.slice(i).join(""); // 尾部残字挂末 token
  }
  return words.map((word, index) => ({
    text: alloc[index] ?? "",
    startMs: word.beginMs,
    endMs: word.endMs,
  }));
}

export function isValidWordTiming(word: SubtitleWordTiming): boolean {
  return (
    typeof word.beginMs === "number" &&
    typeof word.endMs === "number" &&
    Number.isFinite(word.beginMs) &&
    word.endMs > word.beginMs
  );
}

export function buildSubtitleCues(input: {
  narrationText: string;
  words?: SubtitleWordTiming[];
  spanMs?: number;
}): SubtitleCue[] {
  const text = input.narrationText.trim();
  if (text.length === 0) return [];
  const words = (input.words ?? []).filter(isValidWordTiming);
  if (words.length > 0) {
    const mapped = mapNarrationTextToWords(text, words);
    if (mapped) return groupIntoCues(mapped);
    // 锚点全失（重度规范化）：原文按 token 时间包络均匀分布——文本保真
    const startMs = words[0]!.beginMs;
    const endMs = words[words.length - 1]!.endMs;
    const chars = [...text];
    const units = chars.map((char, index) => ({
      text: char,
      startMs: Math.round(startMs + ((endMs - startMs) * index) / chars.length),
      endMs: Math.round(
        startMs + ((endMs - startMs) * (index + 1)) / chars.length,
      ),
    }));
    return groupIntoCues(units);
  }
  if (input.spanMs === undefined) return [];
  // 均匀近似：字符均分 span，累计取整保证末条 endMs == spanMs。
  const chars = [...text];
  const units = chars.map((char, index) => ({
    text: char,
    startMs: Math.round((input.spanMs! * index) / chars.length),
    endMs: Math.round((input.spanMs! * (index + 1)) / chars.length),
  }));
  return groupIntoCues(units);
}

export function activeSubtitleCue(
  cues: SubtitleCue[],
  localMs: number,
): SubtitleCue | undefined {
  return cues.find((cue) => localMs >= cue.startMs && localMs < cue.endMs);
}
