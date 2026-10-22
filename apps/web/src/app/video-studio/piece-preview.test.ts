import assert from "node:assert/strict";
import test from "node:test";
import { mapGlobalFrame, quantizeTimeline } from "@acs/video-document";
import {
  advanceGlobalFrame,
  shotCanvasContext,
  singleShotSpanFrames,
} from "./piece-preview.js";

// 整片预览的纯推进逻辑：rAF 的 dt 折算帧增量后调用，跨镜头边界推进正确、
// 到尾回零循环、负增量钳零——播放循环永不越界（评审关注 #3）。
test("advanceGlobalFrame：跨边界推进、到尾回零、负增量钳零", () => {
  // [1600,1600,1600]ms@24 → spans [38,39,38]，total 115
  const total = 115;
  assert.equal(advanceGlobalFrame(0, 40, total), 40);
  assert.equal(advanceGlobalFrame(76, 5, total), 81);
  assert.equal(advanceGlobalFrame(113, 5, total), 0, "到尾回零循环");
  assert.equal(advanceGlobalFrame(50, -60, total), 0, "负增量钳零");
  assert.equal(advanceGlobalFrame(0, 0, total), 0);
});

test("advanceGlobalFrame + mapGlobalFrame：推进后全局帧正确归属镜头与本地帧", () => {
  const timeline = quantizeTimeline([1600, 1600, 1600], 24);
  // 从 0 推进 40 帧 → 全局 40 → 镜头 1（38..76）的第 2 帧
  const frame = advanceGlobalFrame(0, 40, timeline.totalFrames);
  assert.equal(frame, 40);
  assert.deepEqual(mapGlobalFrame(timeline, frame), {
    shotIndex: 1,
    localFrame: 2,
  });
  // 从 76 推进 1 帧越过镜头 1/2 边界 → 镜头 2 第 0 帧
  const crossed = advanceGlobalFrame(76, 1, timeline.totalFrames);
  assert.deepEqual(mapGlobalFrame(timeline, crossed), {
    shotIndex: 2,
    localFrame: 0,
  });
});

test("advanceGlobalFrame：totalFrames 非法时抛错", () => {
  assert.throws(() => advanceGlobalFrame(0, 1, 0), /totalFrames/);
});

// 终评 Important#1 回归：整片预览的镜头画布必须按 24fps + 量化 span 帧数取上下文。
// 旧行为（30fps / ceil(durationMs×fps/1000) 重算）会把 1600ms 首镜头画成 48 帧
// 30fps——动画慢 20% 且末 20% 帧永不显示，与出片结果不符。
test("shotCanvasContext：24fps + 量化 span 帧数（非 30fps/非 ceil 重算）", () => {
  // [1600,1600,1600]ms@24 → spans [38,39,38]
  const timeline = quantizeTimeline([1600, 1600, 1600], 24);
  const first = shotCanvasContext({
    durationMs: 1600,
    frames: timeline.shots[0]!.frames,
  });
  assert.equal(first.fps, 24, "必须与出片同帧率");
  assert.equal(
    first.durationFrames,
    38,
    "用量化 span 帧数（ceil 重算会得 39）",
  );
  const second = shotCanvasContext({
    durationMs: 1600,
    frames: timeline.shots[1]!.frames,
  });
  assert.equal(second.durationFrames, 39);
});

// 双画幅预览（2026-10-23 brief §三A）：单镜预览也必须用出片同口径的
// 24fps 量化帧数（与 remotion root.tsx sceneCalculateMetadata 同推导），
// 不再沿用 30fps/ceil——否则单镜所见与整片/出片不一致。
test("singleShotSpanFrames：单镜量化帧数与整片/出片同口径", () => {
  assert.equal(singleShotSpanFrames(1600), 38, "量化（ceil 会得 39）");
  assert.equal(singleShotSpanFrames(1000), 24);
  assert.equal(singleShotSpanFrames(1500), 36);
  assert.equal(singleShotSpanFrames(200), 5, "200ms → round(4.8)=5");
});

test("singleShotSpanFrames：非法时长沿 quantizeTimeline 的抛错口径", () => {
  assert.throws(() => singleShotSpanFrames(0), /frames|正整数/);
  assert.throws(() => singleShotSpanFrames(-100), /frames|正整数/);
});
