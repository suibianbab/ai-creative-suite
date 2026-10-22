import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_DIMENSIONS, EXPORT_FPS } from "./aspect.js";

test("出片帧率固定 24fps（整片量化与预览共用）", () => {
  assert.equal(EXPORT_FPS, 24);
});

test("出片画幅尺寸：横版 1280×720、竖版 720×1280", () => {
  assert.deepEqual(EXPORT_DIMENSIONS.landscape, [1280, 720]);
  assert.deepEqual(EXPORT_DIMENSIONS.portrait, [720, 1280]);
});

test("画幅键恰好是 landscape/portrait（与 AspectTarget 对齐）", () => {
  assert.deepEqual(Object.keys(EXPORT_DIMENSIONS).sort(), [
    "landscape",
    "portrait",
  ]);
});
