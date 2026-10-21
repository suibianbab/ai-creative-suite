import assert from "node:assert/strict";
import test from "node:test";
import {
  addCandidateVersion,
  reviseWorkingVersion,
  rollbackWorkingVersion,
  ShotLockedError,
  setLocked,
} from "./operations.js";
import type { MediaAsset, ThreeSceneSpec, VideoProject } from "./types.js";

const UUID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001";
const UUID2 = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002";
const DELIVERY = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1003";
const at = "2026-10-17T00:00:00.000Z";

function baseProject(): VideoProject {
  const versionId = UUID;
  return {
    schemaVersion: 1,
    id: UUID,
    title: "p0",
    savedVersion: 1,
    brief: {
      sentence: "做一个12秒的文字动画，标题是云制作",
      aspectTargets: ["landscape", "portrait"],
    },
    shots: [
      {
        shotId: UUID,
        order: 0,
        locked: false,
        workingVersionId: versionId,
        contentVersions: [
          {
            versionId,
            createdAt: at,
            durationMs: 12000,
            description: "文字动画",
            narrationText: "",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "text-animation",
                componentVersion: 1,
                durationMs: 12000,
                seed: 1,
                background: "#ffffff",
                params: { title: "云制作" },
              },
            },
            provenance: { engineId: "html-gsap", engineVersion: "0" },
          },
        ],
        events: [{ kind: "submitted", versionId, at, actor: "human" }],
      },
    ],
    renderRecords: [],
    deliveries: [],
  };
}

test("锁定镜头拒绝 AI 重生成", () => {
  const p = setLocked(baseProject(), baseProject().shots[0]!.shotId, true, at);
  const v2 = { ...p.shots[0]!.contentVersions[0]!, versionId: UUID2 };
  assert.throws(
    () => addCandidateVersion(p, p.shots[0]!.shotId, v2, at),
    ShotLockedError,
  );
});

test("回滚 working 版本保留历史且旧 delivery 不变", () => {
  let p = baseProject();
  const v2 = { ...p.shots[0]!.contentVersions[0]!, versionId: UUID2 };
  p = addCandidateVersion(p, p.shots[0]!.shotId, v2, at);
  p = {
    ...p,
    deliveries: [
      {
        deliveryId: DELIVERY,
        at,
        versionIds: [p.shots[0]!.contentVersions[0]!.versionId],
        renderIds: [],
        frameMap: [288],
      },
    ],
  };
  const rolled = rollbackWorkingVersion(
    p,
    p.shots[0]!.shotId,
    p.shots[0]!.contentVersions[0]!.versionId,
    at,
  );
  assert.equal(
    rolled.shots[0]!.workingVersionId,
    rolled.shots[0]!.contentVersions[0]!.versionId,
  );
  assert.equal(rolled.deliveries.length, 1);
  assert.equal(rolled.shots[0]!.contentVersions.length, 2); // 历史不丢
});

// —— 分镜编辑器：人工修订路径（ADR 0003 §1.3）——

const T0 = "2026-10-18T00:00:00.000Z";
const T = "2026-10-18T01:00:00.000Z";

// baseProject 的版本 narrationText 为空串；这里给一个非空初值便于断言继承/覆盖。
function editableProject(): VideoProject {
  const p = baseProject();
  const shot = p.shots[0]!;
  return {
    ...p,
    shots: [
      {
        ...shot,
        contentVersions: [
          { ...shot.contentVersions[0]!, narrationText: "旧旁白。" },
        ],
      },
    ],
  };
}

// 本地小助手：查 shot 的 workingVersionId 对应版本（断言 working 内容用）。
function workingOf(p: VideoProject, shotId: string) {
  const shot = p.shots.find((s) => s.shotId === shotId)!;
  return shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  )!;
}

test("reviseWorkingVersion：显式说明逐字落库，空/超长拒绝", () => {
  const p = editableProject();
  const shotId = p.shots[0]!.shotId;
  const next = reviseWorkingVersion(
    p,
    shotId,
    { description: "新说明" },
    UUID2,
    T,
  );
  assert.equal(workingOf(next, shotId).description, "新说明");
  const atLimit = reviseWorkingVersion(
    p,
    shotId,
    { description: "字".repeat(200) },
    UUID2,
    T,
  );
  assert.equal(workingOf(atLimit, shotId).description.length, 200);
  assert.throws(
    () => reviseWorkingVersion(p, shotId, { description: "  " }, UUID2, T),
    /镜头说明须为 1\.\.200 字符/,
  );
  assert.throws(
    () =>
      reviseWorkingVersion(
        p,
        shotId,
        { description: "字".repeat(201) },
        UUID2,
        T,
      ),
    /镜头说明须为 1\.\.200 字符/,
  );
  // 不传 description 时维持原「（人工修订）」后缀口径（上一条测试已覆盖）
});

test("reviseWorkingVersion 追加 human 版本并前移指针", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "新旁白。" },
    UUID2,
    T,
  );
  const shot = next.shots[0]!;
  assert.equal(shot.contentVersions.length, 2);
  assert.equal(shot.workingVersionId, UUID2);
  const v2 = shot.contentVersions[1]!;
  assert.equal(v2.narrationText, "新旁白。");
  assert.equal(v2.durationMs, shot.contentVersions[0]!.durationMs); // 未 patch spec → 继承
  assert.equal(v2.provenance.engineId, "human-edit");
  assert.equal(v2.provenance.parentVersionId, UUID);
  assert.deepEqual(shot.events.at(-1), {
    kind: "submitted",
    versionId: UUID2,
    at: T,
    actor: "human",
  });
  assert.ok(v2.description.includes("人工修订"));
  assert.ok(v2.description.length <= 200);
  // 入参不动
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion 锁定镜头允许且追加 audit 事件", () => {
  const p = setLocked(
    editableProject(),
    editableProject().shots[0]!.shotId,
    true,
    T0,
  );
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "锁定下改。" },
    UUID2,
    T,
  );
  const events = next.shots[0]!.events;
  assert.deepEqual(events.at(-2), {
    kind: "submitted",
    versionId: UUID2,
    at: T,
    actor: "human",
  });
  assert.deepEqual(events.at(-1), {
    kind: "audit",
    note: "人工修订（锁定镜头）",
    at: T,
    actor: "human",
  });
});

test("reviseWorkingVersion spec patch 同步 durationMs 与 sceneSource", () => {
  const p = editableProject();
  const spec = {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: "1",
    durationMs: 3000,
    seed: 1,
    background: "#ffffff",
    params: {},
  };
  const next = reviseWorkingVersion(p, p.shots[0]!.shotId, { spec }, UUID2, T);
  const v2 = next.shots[0]!.contentVersions[1]!;
  assert.equal(v2.durationMs, 3000);
  assert.deepEqual(v2.sceneSource, { type: "spec", spec });
  // 未给 narrationText → 继承 working 版本
  assert.equal(v2.narrationText, "旧旁白。");
});

test("reviseWorkingVersion 未知镜头抛错且入参不变", () => {
  const p = editableProject();
  assert.throws(
    () =>
      reviseWorkingVersion(p, "no-such-shot", { narrationText: "x" }, UUID2, T),
    /不存在/,
  );
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion 空旁白合法", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "" },
    UUID2,
    T,
  );
  assert.equal(next.shots[0]!.contentVersions[1]!.narrationText, "");
});

// —— P2.5-T3：mediaClip patch 通道（spec §2.1 R1/R2）——

const T3AT = "2026-10-19T00:00:00.000Z";
const UUID3 = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1004";
const UUID4 = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1005";
const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";

function mediaAsset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: T3AT,
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64),
      bytes: 100,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      fps: 24,
      codec: "h264",
      hasAudio: false,
      storeKey: "aaaaaaaaaaaaaaaa.mp4",
    },
  };
}

const CLIP = {
  mediaAssetId: ASSET_ID,
  inMs: 500,
  outMs: 2500,
  fit: "cover" as const,
  focalX: 0.5,
  audio: "mute" as const,
};

test("mediaClip patch：落 media-clip sceneSource，durationMs=outMs−inMs，human provenance，narration 覆盖继承", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { mediaClip: CLIP, narrationText: "旁白" },
    UUID3,
    T3AT,
  );
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.versionId, UUID3);
  assert.equal(version.durationMs, 2000); // op 计算，不是调用方给的
  assert.deepEqual(version.sceneSource, { type: "media-clip", ...CLIP });
  assert.equal(version.narrationText, "旁白");
  assert.equal(version.provenance.engineId, "human-edit");
  assert.equal(
    version.provenance.parentVersionId,
    p.shots[0]!.workingVersionId,
  );
  assert.equal(next.shots[0]!.workingVersionId, UUID3);
  assert.equal(next.mediaAssets?.length, 1); // op 不动账本
});

test("mediaClip patch：锁定镜头允许且追加 audit 事件（沿 spec 路径语义）", () => {
  let p: VideoProject = { ...baseProject(), mediaAssets: [mediaAsset()] };
  p = setLocked(p, p.shots[0]!.shotId, true, T3AT);
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { mediaClip: CLIP },
    UUID3,
    T3AT,
  );
  const events = next.shots[0]!.events;
  assert.equal(events.at(-1)!.kind, "audit");
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.sceneSource.type, "media-clip"); // 锁定路径也落媒体源
  assert.equal(version.durationMs, 2000);
});

test("spec 与 mediaClip 同时给出 → 大声抛（互斥）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () =>
      reviseWorkingVersion(
        p,
        p.shots[0]!.shotId,
        { mediaClip: CLIP, spec: { durationMs: 1000 } },
        UUID3,
        T3AT,
      ),
    /互斥/,
  );
});

test("narration-only patch 落在 media 版本上 → sceneSource 与 durationMs 原样保留（不得丢媒体源）", () => {
  let p: VideoProject = { ...baseProject(), mediaAssets: [mediaAsset()] };
  p = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { mediaClip: CLIP },
    UUID3,
    T3AT,
  );
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "只改旁白" },
    UUID4,
    T3AT,
  );
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.sceneSource.type, "media-clip");
  assert.equal(version.durationMs, 2000);
  assert.equal(version.narrationText, "只改旁白");
});

test("mediaClip：资产不在账本 → validate 拦（R2 后盾，C1）", () => {
  const p = baseProject(); // 无 mediaAssets
  assert.throws(
    () =>
      reviseWorkingVersion(
        p,
        p.shots[0]!.shotId,
        { mediaClip: CLIP },
        UUID3,
        T3AT,
      ),
    /mediaAssets 账本/,
  );
});

test("mediaClip：出点越界（outMs > 素材时长）→ validate 拦（C1 越界门）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () =>
      reviseWorkingVersion(
        p,
        p.shots[0]!.shotId,
        { mediaClip: { ...CLIP, inMs: 4900, outMs: 5100 } },
        UUID3,
        T3AT,
      ),
    /出入点越界/,
  );
});

test("mediaClip：出点−入点不足 200ms → validate 拦（C1 下限门）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  assert.throws(
    () =>
      reviseWorkingVersion(
        p,
        p.shots[0]!.shotId,
        { mediaClip: { ...CLIP, inMs: 1000, outMs: 1050 } },
        UUID3,
        T3AT,
      ),
    /出入点越界/,
  );
});

// —— P3-B：threeScene patch 通道（Ruling 11）——

const THREE_SPEC: ThreeSceneSpec = {
  specVersion: 1,
  componentId: "orbit3d",
  componentVersion: 1,
  durationMs: 5000,
  seed: 7,
  background: "#101820",
  params: {
    shape: "box",
    color: "#4f9dff",
    accent: "#e8b04b",
    spinPerFrame: 0.02,
    tilt: 0.35,
    zoom: 1,
  },
};

test("reviseWorkingVersion：threeScene 落 three 场景源并同步 durationMs", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { threeScene: THREE_SPEC, narrationText: "3D 旁白" },
    UUID3,
    T3AT,
  );
  const version = next.shots[0]!.contentVersions.at(-1)!;
  assert.equal(version.durationMs, 5000);
  assert.deepEqual(version.sceneSource, { type: "three", spec: THREE_SPEC });
  assert.equal(version.narrationText, "3D 旁白");
  assert.equal(version.provenance.engineId, "human-edit");
  assert.equal(
    version.provenance.parentVersionId,
    p.shots[0]!.workingVersionId,
  );
});

test("reviseWorkingVersion：threeScene 与 spec / mediaClip 互斥（三种组合都抛）", () => {
  const p = { ...baseProject(), mediaAssets: [mediaAsset()] };
  const combos = [
    { threeScene: THREE_SPEC, spec: { durationMs: 1000 } },
    { threeScene: THREE_SPEC, mediaClip: CLIP },
    { spec: { durationMs: 1000 }, mediaClip: CLIP },
  ];
  for (const patch of combos) {
    assert.throws(
      () => reviseWorkingVersion(p, p.shots[0]!.shotId, patch, UUID3, T3AT),
      /互斥/,
    );
  }
});

test("reviseWorkingVersion：threeScene 修订后 workingVersionId 前移到新版本", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { threeScene: THREE_SPEC },
    UUID3,
    T3AT,
  );
  assert.equal(next.shots[0]!.workingVersionId, UUID3);
  assert.equal(next.shots[0]!.contentVersions.at(-1)!.versionId, UUID3);
  // 入参不动
  assert.equal(p.shots[0]!.workingVersionId, UUID);
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});
