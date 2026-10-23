import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStyleBible,
  type MediaAsset,
  resolveStyleBibleRef,
  type StyleBibleVersion,
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

test("样片库生成独立、有效的项目；程序化样片引用独立 Style Bible", async () => {
  assert.deepEqual(
    GALLERY_SAMPLES.map((item) => item.id),
    ["stem", "data", "product", "renovation", "appliance"],
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
  for (const id of ["stem", "data", "renovation", "appliance"] as const) {
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

test("家装方案样片：五镜头、挂独立暖木 bible、流程与线描图示齐备", async () => {
  const { project, bible } = await createGallerySample("renovation");
  assert(bible);
  validateVideoProject(project);
  assert.equal(project.shots.length, 5);
  assert.equal(
    project.shots.reduce(
      (ms, shot) => ms + shot.contentVersions[0]!.durationMs,
      0,
    ),
    16_000,
  );
  assert(
    project.shots.every((shot) =>
      Boolean(shot.contentVersions[0]?.narrationText),
    ),
  );
  assert.equal(project.brief.aspectTargets.length, 2);
  const version = await resolveStyleBibleRef(project.styleBibleRef!, bible);
  assert.deepEqual(workingStyleIssues(project, version), []);
  const kinds: string[] = [];
  for (const shot of project.shots) {
    const source = shot.contentVersions[0]?.sceneSource;
    assert.equal(source?.type, "spec");
    if (source?.type === "spec") {
      const scene = validateSceneSpec(source.spec, defaultRegistry);
      if (scene.componentId === "explainer-composition")
        kinds.push(
          (scene.params as { diagram: { kind: string } }).diagram.kind,
        );
    }
  }
  assert.deepEqual(kinds, ["flow", "drawing"]);
});

test("设备操作样片：五镜头、挂独立蓝灰 bible、含维护参数数字镜头", async () => {
  const { project, bible } = await createGallerySample("appliance");
  assert(bible);
  validateVideoProject(project);
  assert.equal(project.shots.length, 5);
  assert.equal(
    project.shots.reduce(
      (ms, shot) => ms + shot.contentVersions[0]!.durationMs,
      0,
    ),
    16_500,
  );
  assert(
    project.shots.every((shot) =>
      Boolean(shot.contentVersions[0]?.narrationText),
    ),
  );
  const version = await resolveStyleBibleRef(project.styleBibleRef!, bible);
  assert.deepEqual(workingStyleIssues(project, version), []);
  const componentIds: string[] = [];
  for (const shot of project.shots) {
    const source = shot.contentVersions[0]?.sceneSource;
    assert.equal(source?.type, "spec");
    if (source?.type === "spec") {
      const scene = validateSceneSpec(source.spec, defaultRegistry);
      componentIds.push(scene.componentId);
    }
  }
  assert.ok(componentIds.includes("number-counter"));
  assert.ok(componentIds.includes("explainer-composition"));
  assert.ok(componentIds.includes("sketch-note"));
});

test("新样片切换深浅 Style Bible 后仍可校验且标题正文对比达标", async () => {
  const contrast = (a: string, b: string) => {
    const l = (hex: string) => {
      const channel = [1, 3, 5].map((offset) => {
        const raw = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
      });
      return channel[0]! * 0.2126 + channel[1]! * 0.7152 + channel[2]! * 0.0722;
    };
    const x = l(a);
    const y = l(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // Self-check: the ratio helper must reject an unreadable pair, otherwise
  // the assertions below prove nothing.
  assert.ok(contrast("#777777", "#777777") < 4.5);
  const dark = {
    background: "#101820",
    foreground: "#f3f5f7",
    secondary: "#102033",
    accent: "#f5b652",
    object: "#42a5a0",
  };
  const light = {
    background: "#ffffff",
    foreground: "#102033",
    secondary: "#f0f5ff",
    accent: "#3268d9",
    object: "#42a5a0",
  };
  for (const id of ["renovation", "appliance"] as const) {
    const { project, bible } = await createGallerySample(id);
    assert(bible);
    for (const palette of [dark, light]) {
      const version: StyleBibleVersion = {
        ...bible.versions[0]!,
        versionId: crypto.randomUUID(),
        palette,
      };
      const changed = structuredClone(bible);
      changed.versions.push(version);
      changed.currentVersionId = version.versionId;
      const restyled = await applyStyleBible(
        project,
        changed,
        version.versionId,
      );
      validateVideoProject(restyled);
      assert.deepEqual(workingStyleIssues(restyled, version), []);
      // The flow shot (index 1) carries title/text/box colors.
      const shot = restyled.shots[1]!;
      const current = shot.contentVersions.find(
        (item) => item.versionId === shot.workingVersionId,
      )!;
      assert.equal(current.sceneSource.type, "spec");
      if (current.sceneSource.type !== "spec") continue;
      const scene = validateSceneSpec(
        current.sceneSource.spec,
        defaultRegistry,
      );
      const params = scene.params as {
        titleColor: string;
        textColor: string;
        boxColor: string;
      };
      assert.ok(
        contrast(params.titleColor, palette.background) >= 4.5,
        `${id} title on ${palette.background}`,
      );
      assert.ok(
        contrast(params.textColor, palette.background) >= 4.5,
        `${id} text on ${palette.background}`,
      );
      assert.ok(
        contrast(params.textColor, params.boxColor) >= 4.5,
        `${id} flow label on box`,
      );
    }
  }
});

test("多元素 STEM 镜头切换深浅 Style Bible 后仍可校验且流程文字有对比", async () => {
  const { project, bible } = await createGallerySample("stem");
  assert(bible);
  const ratio = (a: string, b: string) => {
    const l = (hex: string) => {
      const channel = [1, 3, 5].map((offset) => {
        const raw = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
      });
      return channel[0]! * 0.2126 + channel[1]! * 0.7152 + channel[2]! * 0.0722;
    };
    const x = l(a);
    const y = l(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const palette of [
    {
      background: "#101820",
      foreground: "#f3f5f7",
      secondary: "#102033",
      accent: "#f5b652",
      object: "#42a5a0",
    },
    {
      background: "#ffffff",
      foreground: "#102033",
      secondary: "#f0f5ff",
      accent: "#3268d9",
      object: "#42a5a0",
    },
  ]) {
    const version: StyleBibleVersion = {
      ...bible.versions[0]!,
      versionId: crypto.randomUUID(),
      palette,
    };
    const changed = structuredClone(bible);
    changed.versions.push(version);
    changed.currentVersionId = version.versionId;
    const restyled = await applyStyleBible(project, changed, version.versionId);
    validateVideoProject(restyled);
    assert.deepEqual(workingStyleIssues(restyled, version), []);
    for (const index of [1, 4]) {
      const shot = restyled.shots[index]!;
      const current = shot.contentVersions.find(
        (item) => item.versionId === shot.workingVersionId,
      )!;
      assert.equal(current.sceneSource.type, "spec");
      if (current.sceneSource.type !== "spec") continue;
      const scene = validateSceneSpec(
        current.sceneSource.spec,
        defaultRegistry,
      );
      const params = scene.params as {
        titleColor: string;
        boxColor: string;
        textColor: string;
      };
      assert.ok(ratio(params.titleColor, palette.background) >= 4.5);
      assert.ok(ratio(params.textColor, palette.background) >= 4.5);
      if (index === 1)
        assert.ok(ratio(params.textColor, params.boxColor) >= 4.5);
    }
  }
});
