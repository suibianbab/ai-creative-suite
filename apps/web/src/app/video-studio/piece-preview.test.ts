import assert from "node:assert/strict";
import test from "node:test";
import { mapGlobalFrame, quantizeTimeline } from "@acs/video-document";
import { advanceGlobalFrame } from "./piece-preview.js";

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
