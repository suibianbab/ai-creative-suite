import assert from "node:assert/strict";
import test from "node:test";
import {
  isMediaMotion,
  type MediaMotion,
  mediaMotionTransform,
} from "./media-motion.js";

// 任务 2（2026-10-28）：图片基础运动——五档受控变换，纯函数确定性。
test("mediaMotionTransform：五档变换端点与钳制", () => {
  // 静止/缺省恒 none。
  assert.equal(mediaMotionTransform(undefined, 0.5), "none");
  assert.equal(mediaMotionTransform("still", 0.5), "none");
  // 推近 1 → 1.12；拉远 1.12 → 1。
  assert.equal(mediaMotionTransform("zoom-in", 0), "scale(1.0000)");
  assert.equal(mediaMotionTransform("zoom-in", 1), "scale(1.1200)");
  assert.equal(mediaMotionTransform("zoom-out", 0), "scale(1.1200)");
  assert.equal(mediaMotionTransform("zoom-out", 1), "scale(1.0000)");
  // 平移：左移从 +6% 到 -6%，右移反向。P1-3：超采 1.12（单侧余量 6%
  // 恰好覆盖端点位移，原 1.06 只有余 3% 会露黑边）。
  assert.equal(
    mediaMotionTransform("pan-left", 0),
    "scale(1.12) translateX(6.00%)",
  );
  assert.equal(
    mediaMotionTransform("pan-left", 1),
    "scale(1.12) translateX(-6.00%)",
  );
  assert.equal(
    mediaMotionTransform("pan-right", 0),
    "scale(1.12) translateX(-6.00%)",
  );
  // 中点位移为 0（对称），任意进度下单侧余量 ≥ 位移：scale 1.12 → 6% ≥ 6%。
  assert.equal(
    mediaMotionTransform("pan-left", 0.5),
    "scale(1.12) translateX(0.00%)",
  );
  // 进度钳制到 [0,1]。
  assert.equal(
    mediaMotionTransform("zoom-in", -0.5),
    mediaMotionTransform("zoom-in", 0),
  );
  assert.equal(
    mediaMotionTransform("zoom-in", 2),
    mediaMotionTransform("zoom-in", 1),
  );
});

test("isMediaMotion：枚举判定", () => {
  const valid: MediaMotion[] = [
    "still",
    "zoom-in",
    "zoom-out",
    "pan-left",
    "pan-right",
  ];
  for (const m of valid) assert.ok(isMediaMotion(m));
  assert.ok(!isMediaMotion("shake"));
  assert.ok(!isMediaMotion(undefined));
});
