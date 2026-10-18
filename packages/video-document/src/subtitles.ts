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
    if (isCueBreakChar(unit.text) || chars >= SUBTITLE_MAX_CUE_CHARS) flush();
  }
  flush();
  return cues;
}

export function buildSubtitleCues(input: {
  narrationText: string;
  words?: SubtitleWordTiming[];
  spanMs?: number;
}): SubtitleCue[] {
  const text = input.narrationText.trim();
  if (text.length === 0) return [];
  const words = (input.words ?? []).filter(
    (word) =>
      typeof word.beginMs === "number" &&
      typeof word.endMs === "number" &&
      Number.isFinite(word.beginMs) &&
      word.endMs > word.beginMs,
  );
  if (words.length > 0) {
    return groupIntoCues(
      words.map((word) => ({
        text: word.text,
        startMs: word.beginMs,
        endMs: word.endMs,
      })),
    );
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
