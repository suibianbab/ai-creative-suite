// P2.5-T3 P3 + T4 B2：seek 节流纯逻辑（mediaClipCss 已南迁 video-scene，
// 断言随实现迁至 packages/video-scene/src/media-crop.test.ts）。
import assert from "node:assert/strict";
import test from "node:test";
import { mediaSeekTargetSec, shouldSeekVideo } from "./media-preview";

test("P3：seek 目标 = (inMs + 本地帧/24×1000)/1000", () => {
  assert.equal(mediaSeekTargetSec(500, 24), 1.5);
  assert.equal(mediaSeekTargetSec(0, 12), 0.5);
});

test("P3：seek 节流——差 <80ms 不重设，≥80ms 重设（边界含等号）", () => {
  assert.equal(shouldSeekVideo(0.5, 0.55), false);
  // 0.08 无精确二进制表示，用同一字面量经阈值参数钉「恰等于阈值 → 重设」
  assert.equal(shouldSeekVideo(0, 0.08, 0.08), true);
  assert.equal(shouldSeekVideo(0, 0.079, 0.08), false);
  assert.equal(shouldSeekVideo(0.5, 0.6), true);
});
