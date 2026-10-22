import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type MediaAsset,
  resolveStyleBibleRef,
  validateVideoProject,
  workingStyleIssues,
} from "@acs/video-document";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import { createGallerySample, GALLERY_SAMPLES } from "./sample-gallery";

const exampleAsset: MediaAsset = {
  assetId: "c9d74ed0-23e7-4745-92c9-35b6ec2e60bf",
  createdAt: "2026-10-22T00:00:00.000Z",
  origin: { kind: "local-upload", fileName: "p4-hat-product.mp4" },
  original: {
    sha256: "a".repeat(64),
    bytes: 99759,
    durationMs: 3000,
    width: 1280,
    height: 720,
    fps: 24,
    codec: "h264",
    hasAudio: false,
    storeKey: `${"a".repeat(16)}.mp4`,
  },
};

test("三个样片生成独立、有效的项目；程序化样片引用独立 Style Bible", async () => {
  assert.deepEqual(
    GALLERY_SAMPLES.map((item) => item.id),
    ["stem", "data", "product"],
  );
  const first = await createGallerySample("stem");
  const second = await createGallerySample("stem");
  assert.notEqual(first.project.id, second.project.id);
  assert.equal(first.project.shots.length, 7);
  assert.equal(
    first.project.shots.reduce(
      (ms, shot) => ms + shot.contentVersions[0]!.durationMs,
      0,
    ),
    26_000,
  );
  assert(
    first.project.shots.every((shot) =>
      Boolean(shot.contentVersions[0]?.narrationText),
    ),
  );
  assert.equal(first.project.brief.aspectTargets.length, 2);
  for (const id of ["stem", "data"] as const) {
    const { project, bible } = await createGallerySample(id);
    assert(bible);
    validateVideoProject(project);
    const version = await resolveStyleBibleRef(project.styleBibleRef!, bible);
    assert.deepEqual(workingStyleIssues(project, version), []);
    for (const shot of project.shots) {
      const source = shot.contentVersions[0]?.sceneSource;
      assert.equal(source?.type, "spec");
      if (source?.type === "spec")
        validateSceneSpec(source.spec, defaultRegistry);
    }
  }
});

test("产品样片必须有真实素材，两个商品镜头引用同一不可变资产", async () => {
  await assert.rejects(() => createGallerySample("product"), /示例素材/);
  const { project, bible } = await createGallerySample("product", exampleAsset);
  assert.equal(bible, null);
  validateVideoProject(project);
  assert.equal(project.shots.length, 5);
  assert.equal(project.mediaAssets?.length, 1);
  for (const index of [1, 2]) {
    const source = project.shots[index]?.contentVersions[0]?.sceneSource;
    assert.equal(source?.type, "media-clip");
    if (source?.type === "media-clip")
      assert.equal(source.mediaAssetId, exampleAsset.assetId);
  }
});
