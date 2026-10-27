import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset, VideoProject } from "./types.js";
import { validateVideoProject } from "./validate.js";

// 任务 1（交接单 2026-10-28）：图片成为正式素材——original.kind 判别，
// 图片无 durationMs/fps/codec/hasAudio；旧视频资产（无 kind）不变。

const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";
const IMG_SHA = "b".repeat(64);

function videoAsset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "demo.mp4" },
    original: {
      sha256: "a".repeat(64),
      bytes: 123456,
      durationMs: 30000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
  } as MediaAsset;
}

function imageAsset(overrides: Record<string, unknown> = {}): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "product.png" },
    original: {
      kind: "image",
      sha256: IMG_SHA,
      bytes: 20480,
      width: 1200,
      height: 900,
      format: "png",
      storeKey: `${IMG_SHA.slice(0, 16)}.png`,
    },
    ...overrides,
  } as MediaAsset;
}

function projectWith(
  assets: MediaAsset[],
  shots: Array<Record<string, unknown>> = [],
): VideoProject {
  return {
    schemaVersion: 1,
    id: "0d0e1f2a-3b4c-4d5e-8f9a-1a2b3c4d5e6f",
    title: "图片项目",
    brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
    mediaAssets: assets,
    shots: shots.map((s, i) => ({
      shotId: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`,
      order: i,
      locked: false,
      workingVersionId: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, "0")}`,
      contentVersions: [
        {
          versionId: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, "0")}`,
          createdAt: "2026-10-28T00:00:00.000Z",
          durationMs: 3000,
          description: "图片镜头",
          narrationText: "旁白",
          sceneSource: s.source,
          provenance: { engineId: "human-edit", engineVersion: "1" },
        },
      ],
      events: [],
    })),
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  } as VideoProject;
}

const IMG_CLIP = {
  mediaAssetId: ASSET_ID,
  inMs: 0,
  outMs: 3000,
  fit: "cover",
  focalX: 0.5,
  audio: "mute",
};

test("图片资产通过校验（kind=image，无视频字段）", () => {
  assert.doesNotThrow(() => validateVideoProject(projectWith([imageAsset()])));
});

test("旧视频资产（无 kind）继续通过——兼容不回归", () => {
  assert.doesNotThrow(() => validateVideoProject(projectWith([videoAsset()])));
});

test("图片资产缺字段/坏 storeKey → 拒绝并点名", () => {
  assert.throws(
    () =>
      validateVideoProject(
        projectWith([
          imageAsset({
            original: {
              ...imageAsset().original,
              storeKey: "xxxxxxxxxxxxxxxx.mp4",
            },
          }),
        ]),
      ),
    /storeKey/,
  );
  assert.throws(
    () =>
      validateVideoProject(
        projectWith([
          imageAsset({
            original: { ...imageAsset().original, format: "gif" },
          }),
        ]),
      ),
    /format/,
  );
  assert.throws(
    () =>
      validateVideoProject(
        projectWith([
          imageAsset({
            original: { ...imageAsset().original, width: 0 },
          }),
        ]),
      ),
    /width/,
  );
});

test("图片资产的 media-clip：inMs 须为 0、audio 须 mute；时长无素材上限", () => {
  // 合法：in=0，out=任意展示时长（≤账本统一上限）。
  assert.doesNotThrow(() =>
    validateVideoProject(
      projectWith(
        [imageAsset()],
        [{ source: { type: "media-clip", ...IMG_CLIP } }],
      ),
    ),
  );
  // inMs>0 对图片无意义 → 拒。
  assert.throws(
    () =>
      validateVideoProject(
        projectWith(
          [imageAsset()],
          [{ source: { type: "media-clip", ...IMG_CLIP, inMs: 500 } }],
        ),
      ),
    /inMs.*0|图片/,
  );
  // 图片无音轨 → keep 拒。
  assert.throws(
    () =>
      validateVideoProject(
        projectWith(
          [imageAsset()],
          [{ source: { type: "media-clip", ...IMG_CLIP, audio: "keep" } }],
        ),
      ),
    /audio|静音/,
  );
});

// 任务 2：media-clip motion 枚举校验。
test("motion 字段：五档合法、未知值拒绝", () => {
  for (const motion of [
    "still",
    "zoom-in",
    "zoom-out",
    "pan-left",
    "pan-right",
  ]) {
    assert.doesNotThrow(() =>
      validateVideoProject(
        projectWith(
          [imageAsset()],
          [{ source: { type: "media-clip", ...IMG_CLIP, motion } }],
        ),
      ),
    );
  }
  assert.throws(
    () =>
      validateVideoProject(
        projectWith(
          [imageAsset()],
          [
            {
              source: {
                type: "media-clip",
                ...IMG_CLIP,
                motion: "shake" as never,
              },
            },
          ],
        ),
      ),
    /motion/,
  );
});
