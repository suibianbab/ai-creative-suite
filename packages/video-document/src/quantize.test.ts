import assert from "node:assert/strict";
import test from "node:test";
import {
  mapGlobalFrame,
  quantizeTimeline,
  ZeroFrameShotError,
} from "./quantize.js";

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

test("mapGlobalFrame：边界帧归后一镜头起点，超尾帧钳到最后镜头末帧", () => {
  // [1600,1600,1600]ms@24 → 边界 [0,38,77,115]，spans [38,39,38]
  const t = quantizeTimeline([1600, 1600, 1600], 24);
  assert.deepEqual(
    t.shots.map((s) => s.frames),
    [38, 39, 38],
  );
  assert.deepEqual(mapGlobalFrame(t, 0), { shotIndex: 0, localFrame: 0 });
  // 38 是镜头 1 的 startFrame：归镜头 1 的第 0 帧，不属镜头 0
  assert.deepEqual(mapGlobalFrame(t, 38), { shotIndex: 1, localFrame: 0 });
  assert.deepEqual(mapGlobalFrame(t, 76), { shotIndex: 1, localFrame: 38 });
  assert.deepEqual(mapGlobalFrame(t, 77), { shotIndex: 2, localFrame: 0 });
  // 超尾帧钳到 totalFrames-1=114 → 镜头 2 的第 37 帧
  assert.deepEqual(mapGlobalFrame(t, 200), { shotIndex: 2, localFrame: 37 });
  assert.deepEqual(mapGlobalFrame(t, -5), { shotIndex: 0, localFrame: 0 });
});

test("mapGlobalFrame：空 timeline 或非法帧抛错", () => {
  assert.throws(() => mapGlobalFrame({ shots: [], totalFrames: 0 }, 0), /空/);
  assert.throws(
    () => mapGlobalFrame(quantizeTimeline([1000], 24), Number.NaN),
    /整数/,
  );
});
