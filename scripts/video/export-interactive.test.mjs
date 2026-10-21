// P3-A 交互交付（Task 3）：导出管线的纯函数单测（不写盘，CLI 主路径另跑）。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateVideoProject } from "./delivery.mjs";
import { buildInteractiveExport } from "./export-interactive.mjs";

const FIXTURE = new URL(
  "./fixtures/interactive-sample.video-project.json",
  import.meta.url,
);

function fixture() {
  return validateVideoProject(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

// 最小媒体资产账本：让改造后的第 2 镜头先通过文档校验，再撞上「仅 spec」门禁。
function mediaClipProject() {
  const project = structuredClone(fixture());
  const assetId = "88888888-8888-4888-8888-888888888888";
  const shot = project.shots[1];
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  version.sceneSource = {
    type: "media-clip",
    mediaAssetId: assetId,
    inMs: 0,
    outMs: 3100,
    fit: "cover",
    focalX: 0.5,
    audio: "mute",
  };
  project.mediaAssets = [
    {
      assetId,
      createdAt: "2026-10-21T00:00:00.000Z",
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
        storeKey: `${"a".repeat(16)}.mp4`,
      },
    },
  ];
  return validateVideoProject(project);
}

test("夹具导出：3 步、正整数 frameMap、sha256(html) 摘要与 data-total", () => {
  const { html, versionIds, frameMap, digest } = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  assert.equal(versionIds.length, 3);
  assert.deepEqual(frameMap, [24, 37, 24]);
  for (const frames of frameMap)
    assert.ok(Number.isInteger(frames) && frames >= 1);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, createHash("sha256").update(html, "utf8").digest("hex"));
  assert.ok(html.includes('data-total="3"'));
});

test("确定性：同输入两次导出 html 逐字节一致", () => {
  const first = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  const second = buildInteractiveExport({
    project: fixture(),
    fps: 12,
    aspect: "landscape",
  });
  assert.equal(first.html, second.html);
  assert.equal(first.digest, second.digest);
});

test("非 spec 镜头整次拒绝：指名镜头 2 与 media-clip", () => {
  assert.throws(
    () =>
      buildInteractiveExport({
        project: mediaClipProject(),
        fps: 12,
        aspect: "landscape",
      }),
    (error) => {
      assert.match(error.message, /镜头 2/);
      assert.match(error.message, /media-clip/);
      return true;
    },
  );
});

test("参数门禁：fps 不整除与画幅枚举", () => {
  assert.throws(
    () =>
      buildInteractiveExport({
        project: fixture(),
        fps: 5,
        aspect: "landscape",
      }),
    /不整除/,
  );
  assert.throws(
    () =>
      buildInteractiveExport({
        project: fixture(),
        fps: 12,
        aspect: "square",
      }),
    /landscape\/portrait/,
  );
});
