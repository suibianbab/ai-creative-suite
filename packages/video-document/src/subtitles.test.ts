// 字幕 cue 构建（spec R2）：有时间戳走字级精确，无时间戳按字符均匀近似；
// 停顿标点切句、≤10 字合并、时序单调、半开区间活跃判定。
import assert from "node:assert/strict";
import test from "node:test";
import { activeSubtitleCue, buildSubtitleCues } from "./subtitles.js";

const WORDS = "水循环，要点、一。".split("").map((text, i) => ({
  text,
  beginMs: 360 + i * 260,
  endMs: 360 + i * 260 + 200,
}));

test("字级时间戳：停顿标点（含顿号）各切一条 cue，时间取首末字", () => {
  const cues = buildSubtitleCues({
    narrationText: "水循环，要点、一。",
    words: WORDS,
  });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["水循环，", "要点、", "一。"],
  );
  assert.equal(cues[0]!.startMs, WORDS[0]!.beginMs);
  assert.equal(cues[0]!.endMs, WORDS[3]!.endMs);
  assert.equal(cues[1]!.startMs, WORDS[4]!.beginMs);
  assert.equal(cues[1]!.endMs, WORDS[6]!.endMs);
  assert.equal(cues[2]!.startMs, WORDS[7]!.beginMs);
  assert.equal(cues[2]!.endMs, WORDS[8]!.endMs);
});

test("无标点超 10 字：按上限断开（10+1）", () => {
  const text = "一二三四五六七八九十甲";
  const words = text
    .split("")
    .map((t, i) => ({ text: t, beginMs: i * 250, endMs: i * 250 + 200 }));
  const cues = buildSubtitleCues({ narrationText: text, words });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["一二三四五六七八九十", "甲"],
  );
});

test("words 为空数组且给 spanMs → 均匀分布（近似路径）", () => {
  const cues = buildSubtitleCues({
    narrationText: "水循环。",
    words: [],
    spanMs: 1600,
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.text, "水循环。");
  assert.equal(cues[0]!.startMs, 0);
  assert.equal(cues[0]!.endMs, 1600);
});

test("均匀分布多 cue：时序单调不重叠且 Σ 覆盖 span", () => {
  const text = "一二三，四五六。";
  const cues = buildSubtitleCues({ narrationText: text, spanMs: 2400 });
  assert.deepEqual(
    cues.map((c) => c.text),
    ["一二三，", "四五六。"],
  );
  assert.equal(cues[0]!.startMs, 0);
  assert.ok(cues[0]!.endMs <= cues[1]!.startMs);
  assert.equal(cues[cues.length - 1]!.endMs, 2400);
});

test("空白旁白 → 无 cue；无 words 无 spanMs → 无 cue", () => {
  assert.deepEqual(buildSubtitleCues({ narrationText: "  " }), []);
  assert.deepEqual(
    buildSubtitleCues({ narrationText: "水循环。", words: [] }),
    [],
  );
});

test("非法时间戳字（begin≥end）被剔除后全废则回退均匀", () => {
  const bad = "水循环。".split("").map((text) => ({
    text,
    beginMs: 500,
    endMs: 400,
  }));
  const cues = buildSubtitleCues({
    narrationText: "水循环。",
    words: bad,
    spanMs: 1200,
  });
  assert.equal(cues.length, 1); // 回退均匀
  assert.equal(cues[0]!.endMs, 1200);
});

test("activeSubtitleCue：半开区间，t=endMs 时下一条/无", () => {
  const cues = [
    { text: "甲", startMs: 0, endMs: 500 },
    { text: "乙", startMs: 500, endMs: 900 },
  ];
  assert.equal(activeSubtitleCue(cues, 499)!.text, "甲");
  assert.equal(activeSubtitleCue(cues, 500)!.text, "乙");
  assert.equal(activeSubtitleCue(cues, 900), undefined);
});
