import assert from "node:assert/strict";
import test from "node:test";
import { quantizeTimeline, ZeroFrameShotError } from "./quantize.js";

test("30×1100ms 在 24fps 总长恰为 792 帧（33.0s），30fps 恰为 990 帧", () => {
  const durations = Array.from({ length: 30 }, () => 1100);
  assert.equal(quantizeTimeline(durations, 24).totalFrames, 792);
  assert.equal(quantizeTimeline(durations, 30).totalFrames, 990);
  const q = quantizeTimeline(durations, 24);
  // 边界取整的真实分布：792 = 18×26 + 12×27。
  // 逐镜头取整（每镜 round(26.4)=26）会得到 780 帧且不含 27 帧镜头——两个断言都排除该失败路径
  assert.equal(q.shots.filter((s) => s.frames === 27).length, 12);
  assert.equal(q.shots.filter((s) => s.frames === 26).length, 18);
});
test("每个切点距理想位置 ≤ 半帧", () => {
  const durations = [1100, 900, 2500, 400];
  const q = quantizeTimeline(durations, 24);
  let acc = 0;
  q.shots.forEach((s, i) => {
    acc += durations[i]!;
    assert.ok(
      Math.abs(s.startFrame + s.frames - (acc * 24) / 1000) <= 0.5 + 1e-9,
    );
  });
});
test("三个 1ms 镜头在 24fps 下抛 ZeroFrameShotError", () => {
  assert.throws(() => quantizeTimeline([1, 1, 1], 24), ZeroFrameShotError);
});
test("1100ms×30 在 24fps 下任意镜头不为 0 帧", () => {
  const q = quantizeTimeline(
    Array.from({ length: 30 }, () => 1100),
    24,
  );
  assert.ok(q.shots.every((s) => s.frames >= 1));
});
