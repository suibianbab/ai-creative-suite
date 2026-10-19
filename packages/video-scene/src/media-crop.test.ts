// P2.5-T4 B2：裁切数学单源在 video-scene（web 预览 + remotion-engine 出片共用）。
// 前 5 例自 apps/web media-preview.test.ts 迁移（值不变），末例钉出片双画幅。
import assert from "node:assert/strict";
import test from "node:test";
import { mediaClipCss } from "./media-crop.js";

test("contain：同比居中，focal 无效恒 50% 50%", () => {
  assert.deepEqual(mediaClipCss(1920, 1080, 360, 640, "contain", 0.9), {
    objectFit: "contain",
    objectPosition: "50% 50%",
  });
});

test("cover 横溢出：focal 定水平位（1/3 → 33.3%）", () => {
  const css = mediaClipCss(1920, 1080, 360, 640, "cover", 1 / 3);
  assert.equal(css.objectFit, "cover");
  assert.equal(css.objectPosition, "33.3% 50%");
});

test("cover 出片双画幅钉死：1280×720 焦点钳缘（0/1 不出画）、720×1280 竖溢出裁横", () => {
  // 2400×1080 源进 1280×720：scale=720/1080=0.667，宽 2400×0.667=1600>1280.5 → 横溢出
  assert.equal(
    mediaClipCss(2400, 1080, 1280, 720, "cover", 0).objectPosition,
    "0.0% 50%",
  );
  assert.equal(
    mediaClipCss(2400, 1080, 1280, 720, "cover", 1).objectPosition,
    "100.0% 50%",
  );
  // 1920×1080 源进 720×1280：scale=1280/1080≈1.185，宽 2276>720.5 → 横溢出，focal 0.25
  assert.equal(
    mediaClipCss(1920, 1080, 720, 1280, "cover", 0.25).objectPosition,
    "25.0% 50%",
  );
});

test("cover 无横溢出：同比与竖溢出都归 50%（focal 无效但恒定，C6 先例）", () => {
  // 1920×1080 进 1280×720 同比：无溢出
  assert.equal(
    mediaClipCss(1920, 1080, 1280, 720, "cover", 0.3).objectPosition,
    "50% 50%",
  );
  // 1080×1920 竖源进 1280×720：竖溢出横不溢出
  assert.equal(
    mediaClipCss(1080, 1920, 1280, 720, "cover", 0.7).objectPosition,
    "50% 50%",
  );
});

test("同尺寸：cover 归一无偏移", () => {
  assert.deepEqual(mediaClipCss(1280, 720, 1280, 720, "cover", 0.1), {
    objectFit: "cover",
    objectPosition: "50% 50%",
  });
});
