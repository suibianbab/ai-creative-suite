// P2.5-T3 U 表：账本追加（不 mutate/重复拒）、预览 src（proxy 优先）、标签。
import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import { appendMediaAsset, assetLabel, mediaSrcUrl } from "./media-assets";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001",
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64),
      bytes: 100,
      durationMs: 5200,
      width: 1920,
      height: 1080,
      fps: 24,
      codec: "h264",
      hasAudio: false,
      storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
    ...overrides,
  };
}

test("U1：undefined 账本 → [asset]；既有账本追加返回新数组（不 mutate）", () => {
  const first = asset();
  assert.deepEqual(appendMediaAsset(undefined, first), [first]);
  const second = asset({ assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2002" });
  const before: MediaAsset[] = [first];
  const after = appendMediaAsset(before, second);
  assert.equal(after.length, 2);
  assert.equal(before.length, 1, "入参数组不得被修改");
});

test("U1：重复 assetId → 大声抛（防御；T2 randomUUID 正常不撞）", () => {
  const first = asset();
  assert.throws(() => appendMediaAsset([first], first), /已在账本/);
});

test("U2：有 proxy → ?variant=proxy；无 proxy → 直连 original", () => {
  assert.equal(mediaSrcUrl(asset()), "/api/media/file/aaaaaaaaaaaaaaaa.mp4");
  const withProxy = asset({
    proxy: { sha256: "b".repeat(64), bytes: 50, width: 1280, height: 720, note: "ffmpeg" },
  });
  assert.equal(
    mediaSrcUrl(withProxy),
    "/api/media/file/aaaaaaaaaaaaaaaa.mp4?variant=proxy",
  );
});

test("U3：标签含文件名/画幅/时长一位小数/本地上传", () => {
  assert.equal(
    assetLabel(asset(), [asset()]),
    "「clip.mp4」 1920×1080 · 5.2s · 本地上传",
  );
});

test("U3：同 storeKey 多条 → 追注（同内容已在册）（R3：各自成条不去重）", () => {
  const a = asset();
  const b = asset({
    assetId: "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2002",
    origin: { kind: "local-upload", fileName: "again.mp4" },
  });
  assert.equal(
    assetLabel(b, [a, b]),
    "「again.mp4」 1920×1080 · 5.2s · 本地上传（同内容已在册）",
  );
  assert.equal(
    assetLabel(a, [a]),
    "「clip.mp4」 1920×1080 · 5.2s · 本地上传",
    "单条不注",
  );
});
