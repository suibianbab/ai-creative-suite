// P2.5-T3 P2/P3：cover 裁切 objectFit/objectPosition 双画幅数学 + 帧驱动 seek。
import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaClipCss,
  mediaSeekTargetSec,
  shouldSeekVideo,
} from "./media-preview";

test("P2：contain → 50% 50%，focalX 不参与", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "contain", 0.9), {
    objectFit: "contain",
    objectPosition: "50% 50%",
  });
});

test("P2：cover 横溢出（16:9 素材进 9:16 画布）→ focalX 生效", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 0), {
    objectFit: "cover",
    objectPosition: "0.0% 50%",
  });
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 1), {
    objectFit: "cover",
    objectPosition: "100.0% 50%",
  });
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3), {
    objectFit: "cover",
    objectPosition: "33.3% 50%",
  });
});

test("P2：双画幅同一素材——16:9 画布无溢出归一 50%，9:16 画布吃 focalX（数值钉死）", () => {
  assert.deepEqual(
    mediaClipCss(1920, 1080, 640, 360, "cover", 1 / 3).objectPosition,
    "50% 50%",
  );
  assert.deepEqual(
    mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3).objectPosition,
    "33.3% 50%",
  );
});

test("P2：cover 竖溢出（9:16 素材进 16:9 画布）→ X 归一 50%（契约无 focalY）", () => {
  assert.deepEqual(mediaClipCss(1080, 1920, 640, 360, "cover", 0.7), {
    objectFit: "cover",
    objectPosition: "50% 50%",
  });
});

test("P2：同尺寸（无溢出）→ 50% 50%（Review Focus #4）", () => {
  assert.deepEqual(mediaClipCss(640, 360, 640, 360, "cover", 0.2), {
    objectFit: "cover",
    objectPosition: "50% 50%",
  });
});

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
