import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "./types.js";
import { type VideoProject, validateVideoProject } from "./validate.js";

const UUID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001";
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
            createdAt: "2026-10-17T00:00:00.000Z",
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
        events: [
          {
            kind: "submitted",
            versionId,
            at: "2026-10-17T00:00:00.000Z",
            actor: "human",
          },
        ],
      },
    ],
    renderRecords: [],
    deliveries: [],
  };
}

// —— P2.5-T1 媒体资产账本（spec A1-A8）——
const ASSET_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2002";
const ASSET_SHA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 64 个 a

function mediaAsset(overrides: Record<string, unknown> = {}): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "demo.mp4" },
    original: {
      sha256: ASSET_SHA,
      bytes: 123456,
      durationMs: 30000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      storeKey: "aaaaaaaaaaaaaaaa.mp4", // sha256 前 16 位 + 扩展名
    },
    ...overrides,
  } as MediaAsset;
}

test("mediaAssets 非数组（对象）→ 拒绝（A1）", () => {
  const p = baseProject();
  (p as Record<string, unknown>).mediaAssets = { a: mediaAsset() };
  assert.throws(() => validateVideoProject(p), /mediaAssets/);
});

test("mediaAssets assetId 重复 → 拒绝（A2）", () => {
  const p = baseProject();
  p.mediaAssets = [mediaAsset(), mediaAsset()];
  assert.throws(() => validateVideoProject(p), /duplicated/);
});

test("mediaAssets assetId 非 UUID → 拒绝（A2）", () => {
  const p = baseProject();
  p.mediaAssets = [mediaAsset({ assetId: "not-a-uuid" })];
  assert.throws(() => validateVideoProject(p), /assetId must be a UUID/);
});

test("stock-source 缺 license.name → 拒绝（A4）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "wikimedia",
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:X",
        license: { name: "" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /license\.name/);
});

test("stock-source sourceId 非 wikimedia → 拒绝（A4）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "pexels",
        sourcePageUrl: "https://example.com/x",
        license: { name: "CC0" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sourceId/);
});

test("stock-source sourcePageUrl 非 http(s) → 拒绝（A4）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      origin: {
        kind: "stock-source",
        sourceId: "wikimedia",
        sourcePageUrl: "ftp://example.com/x",
        license: { name: "CC0" },
        retrievedAt: "2026-10-19T00:00:00.000Z",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sourcePageUrl/);
});

test("original.sha256 63 位 → 拒绝（A5）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, sha256: "a".repeat(63) },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /sha256/);
});

test("storeKey 前缀与 sha256 不对应 → 拒绝（A7）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, storeKey: "bbbbbbbbbbbbbbbb.mp4" },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /storeKey/);
});

test("storeKey 非法扩展名 .avi → 拒绝（A7）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, storeKey: "aaaaaaaaaaaaaaaa.avi" },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /storeKey/);
});

test("durationMs=199 的源 → 拒绝（A6 下界）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      original: { ...mediaAsset().original, durationMs: 199 },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /durationMs/);
});

test("proxy 负 width → 拒绝（A8）", () => {
  const p = baseProject();
  p.mediaAssets = [
    mediaAsset({
      proxy: {
        sha256: ASSET_SHA,
        bytes: 1,
        width: -1,
        height: 720,
        note: "h264 720p",
      },
    }),
  ];
  assert.throws(() => validateVideoProject(p), /proxy/);
});

test("合法账本（两种 origin、fps=29.97、含 proxy）→ 通过（兼容见证：先绿）", () => {
  const p = baseProject();
  const local = mediaAsset();
  const stock = mediaAsset({
    assetId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2004",
    origin: {
      kind: "stock-source",
      sourceId: "wikimedia",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Clouds",
      license: {
        name: "CC BY-SA 4.0",
        author: "Nesnad",
        usageNote: "署名即可",
      },
      retrievedAt: "2026-10-19T00:00:00.000Z",
    },
    original: {
      ...mediaAsset().original,
      sha256: "b".repeat(64),
      fps: 29.97,
      storeKey: "bbbbbbbbbbbbbbbb.webm",
      codec: "vp9",
    },
    proxy: {
      sha256: "c".repeat(64),
      bytes: 999,
      width: 1280,
      height: 720,
      note: "h264 720p cap",
    },
  });
  p.mediaAssets = [local, stock];
  const out = validateVideoProject(p);
  assert.equal(out.mediaAssets?.length ?? 0, 2);
});

// —— P2.5-T1 media-clip 场景源（spec C1-C6）——
const CLIP_VERSION_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2003";

function withMediaClipShot(
  p: VideoProject,
  sceneOverrides: Record<string, unknown> = {},
  versionOverrides: Record<string, unknown> = {},
): VideoProject {
  p.mediaAssets = [mediaAsset()];
  p.shots.push({
    shotId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2005",
    order: 1,
    locked: false,
    workingVersionId: CLIP_VERSION_ID,
    contentVersions: [
      {
        versionId: CLIP_VERSION_ID,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs: 3000,
        description: "实拍镜头",
        narrationText: "",
        sceneSource: {
          type: "media-clip",
          mediaAssetId: ASSET_ID,
          inMs: 1000,
          outMs: 4000,
          fit: "cover",
          focalX: 0.5,
          audio: "mute",
          ...sceneOverrides,
        },
        provenance: { engineId: "media-import", engineVersion: "0" },
        ...versionOverrides,
      },
    ],
    events: [],
  });
  return p;
}

test("合法 media-clip 镜头 → 通过（C1-C6 正路径）", () => {
  const out = validateVideoProject(withMediaClipShot(baseProject()));
  assert.equal(
    out.shots[1]!.contentVersions[0]!.sceneSource.type,
    "media-clip",
  );
});

test("mediaAssetId 指向不存在资产 → 拒绝（C1）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaClipShot(baseProject(), {
          mediaAssetId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2999",
        }),
      ),
    /mediaAssetId/,
  );
});

test("outMs 超素材时长 → 拒绝（C3）", () => {
  assert.throws(
    () =>
      validateVideoProject(withMediaClipShot(baseProject(), { outMs: 30001 })),
    /出入点越界/,
  );
});

test("outMs−inMs=199 → 拒绝（C3 最短 200ms）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaClipShot(
          baseProject(),
          { inMs: 1000, outMs: 1199 },
          { durationMs: 199 },
        ),
      ),
    /出入点越界/,
  );
});

test("inMs 非整数 → 拒绝（C2）", () => {
  assert.throws(
    () =>
      validateVideoProject(withMediaClipShot(baseProject(), { inMs: 1000.5 })),
    /inMs/,
  );
});

test("版本 durationMs ≠ outMs−inMs → 拒绝（C4 对账）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaClipShot(baseProject(), {}, { durationMs: 2500 }),
      ),
    /durationMs 须等于 outMs−inMs/,
  );
});

test("fit 非法 → 拒绝（C5）", () => {
  assert.throws(
    () =>
      validateVideoProject(withMediaClipShot(baseProject(), { fit: "fill" })),
    /fit/,
  );
});

test("focalX 为 NaN → 拒绝（C6）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaClipShot(baseProject(), { focalX: Number.NaN }),
      ),
    /focalX/,
  );
});

test("focalX=1.5 → 拒绝（C6 上界）", () => {
  assert.throws(
    () =>
      validateVideoProject(withMediaClipShot(baseProject(), { focalX: 1.5 })),
    /focalX/,
  );
});

test("audio 非法 → 拒绝（C5）", () => {
  assert.throws(
    () =>
      validateVideoProject(withMediaClipShot(baseProject(), { audio: "auto" })),
    /audio/,
  );
});

test("两镜头引用同一 assetId → 通过（素材复用合法）", () => {
  const p = withMediaClipShot(baseProject());
  const first = p.shots[1]!;
  p.shots.push({
    ...first,
    shotId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2006",
    order: 2,
    workingVersionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2007",
    contentVersions: [
      {
        ...first.contentVersions[0]!,
        versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2007",
        sceneSource: {
          type: "media-clip",
          mediaAssetId: ASSET_ID,
          inMs: 5000,
          outMs: 8000,
          fit: "cover",
          focalX: 0.5,
          audio: "mute",
        },
        durationMs: 3000,
      },
    ],
  });
  assert.equal(validateVideoProject(p).shots.length, 3);
});

// —— P2.5-T1 RenderRecord.assetDigests（spec R1-R2）——
function withMediaRenderRecord(
  p: VideoProject,
  digests: unknown,
): VideoProject {
  p.mediaAssets = [mediaAsset()];
  p.renderRecords.push({
    renderId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2008",
    versionId: UUID, // 指向 baseProject 首镜头工作版本
    contentDigest: "d".repeat(64),
    engineId: "html-gsap",
    engineVersion: "0",
    rendererVersion: "remotion-4",
    fps: 24,
    width: 1920,
    height: 1080,
    codec: "h264",
    frames: 72,
    fontDigests: {},
    outputAssetRef: "out.mp4",
    assetDigests: digests as Record<string, string>,
  });
  return p;
}

test("assetDigests value 非 64hex → 拒绝（R1）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaRenderRecord(baseProject(), { [ASSET_ID]: "XYZ" }),
      ),
    /assetDigests/,
  );
});

test("assetDigests 键指向账本外资产 → 拒绝（R2）", () => {
  assert.throws(
    () =>
      validateVideoProject(
        withMediaRenderRecord(baseProject(), {
          "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2999": "e".repeat(64),
        }),
      ),
    /assetDigests/,
  );
});

test("合法 assetDigests → 通过（正路径，兼容见证：先绿）", () => {
  const out = validateVideoProject(
    withMediaRenderRecord(baseProject(), { [ASSET_ID]: ASSET_SHA }),
  );
  assert.equal(out.renderRecords[0]!.assetDigests?.[ASSET_ID], ASSET_SHA);
});

// —— P2.5-T1 迁移与兜底固化 ——
test("旧项目（无 mediaAssets 键）原样通过（迁移回归）", () => {
  const p = baseProject();
  const out = validateVideoProject(p);
  assert.equal(out.mediaAssets, undefined);
});

test("未知 sceneSource.type 错误消息包含三类型", () => {
  const p = baseProject();
  p.shots[0]!.contentVersions[0]!.sceneSource = {
    type: "future-thing",
  } as never;
  assert.throws(
    () => validateVideoProject(p),
    /must be "spec" \| "editor-binding" \| "media-clip"/,
  );
});

test("合法项目通过并原样返回", () => {
  const p = baseProject();
  assert.equal(validateVideoProject(p).id, p.id);
});

// —— brief.applications 数据契约（2026-10-18 Codex 复核反馈第三轮）——
// 应用快照一旦落档就是审计记录：导入校验必须查形状——非数组/字段错型在
// 导入时拒绝，而不是等再应用分镜时炸 is not iterable。
function applicationEntry() {
  return {
    sentence: "做一个30秒的STEM解说视频，主题是勾股定理",
    appendedShotCount: 4,
    appendedDurationMs: 30000,
    filmShotCountAfter: 4,
    filmTotalMsAfter: 30000,
    appliedAt: "2026-10-18T00:00:00.000Z",
  };
}

test("brief.applications 非数组（普通对象）→ 拒绝", () => {
  const p = baseProject();
  (p.brief as Record<string, unknown>).applications = {
    entry: applicationEntry(),
  };
  assert.throws(() => validateVideoProject(p), /applications/);
});

test("brief.applications 条目字段错型 → 拒绝", () => {
  const p = baseProject();
  p.brief.applications = [
    { ...applicationEntry(), appendedShotCount: "4" as unknown as number }, // 字符串冒充数字
  ];
  assert.throws(() => validateVideoProject(p), /applications\[0\]/);
});

test("brief.applications appliedAt 非 ISO → 拒绝", () => {
  const p = baseProject();
  p.brief.applications = [
    { ...applicationEntry(), appliedAt: "2026/10/18 00:00" },
  ];
  assert.throws(() => validateVideoProject(p), /appliedAt/);
});

test("brief.applications 合法快照 → 通过", () => {
  const p = baseProject();
  p.brief.applications = [applicationEntry()];
  assert.equal(validateVideoProject(p).brief.applications?.length, 1);
});
test("workingVersionId 指向不存在版本则拒绝", () => {
  const p = baseProject();
  p.shots[0]!.workingVersionId = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1999";
  assert.throws(() => validateVideoProject(p), /working/);
});
test("durationMs 非正整数拒绝", () => {
  const p = baseProject();
  p.shots[0]!.contentVersions[0]!.durationMs = 12.5;
  assert.throws(() => validateVideoProject(p), /durationMs/);
});
test("事件引用不存在的版本拒绝", () => {
  const p = baseProject();
  p.shots[0]!.events.push({
    kind: "approved",
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1999",
    at: "2026-10-17T00:00:00.000Z",
    actor: "human",
  });
  assert.throws(() => validateVideoProject(p), /versionId/);
});
test("approved 事件 actor 不允许 ai", () => {
  const p = baseProject();
  (p.shots[0]!.events[0] as { actor: string }).actor = "ai";
  p.shots[0]!.events.push({
    kind: "approved",
    versionId: UUID,
    at: "2026-10-17T00:00:00.000Z",
    actor: "human",
  });
  // submitted actor=ai 合法；再构造 approved actor=ai
  p.shots[0]!.events[1]! = { ...p.shots[0]!.events[1]!, actor: "ai" } as never;
  assert.throws(() => validateVideoProject(p), /actor/);
});

const RENDER_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2002";
function baseWithRenderRecord(): VideoProject {
  const p = baseProject();
  p.renderRecords.push({
    renderId: RENDER_ID,
    versionId: UUID,
    contentDigest: "a".repeat(64),
    engineId: "scene-registry",
    engineVersion: "1",
    rendererVersion: "4.0.534",
    fps: 24,
    width: 1280,
    height: 720,
    codec: "h264",
    frames: 288,
    fontDigests: { "NotoSansSC-Regular.woff": "b".repeat(64) },
    outputAssetRef: "render/landscape.mp4",
  });
  return p;
}

test("RenderRecord.browser 可选：缺省与字符串合法，空串拒绝（ADR §2.5 无头浏览器版本入记录）", () => {
  // 缺省：旧存储文档（无 browser 字段）仍合法
  assert.equal(baseWithRenderRecord().renderRecords.length, 1);
  assert.equal(validateVideoProject(baseWithRenderRecord()).id, UUID);
  // 非空字符串合法
  const withBrowser = baseWithRenderRecord();
  (withBrowser.renderRecords[0] as { browser?: string }).browser =
    "Chrome 131.0.6778.86";
  assert.equal(validateVideoProject(withBrowser).id, UUID);
  // 空串拒绝
  const empty = baseWithRenderRecord();
  (empty.renderRecords[0] as { browser?: string }).browser = "  ";
  assert.throws(() => validateVideoProject(empty), /browser/);
});

// —— P2-C：跨镜头 ID/顺序在项目层必须全局唯一 ——

const OTHER_SHOT_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b3001";
const OTHER_VERSION_ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b3002";

function withSecondShot(
  project: VideoProject,
  mutate?: (shot: VideoProject["shots"][number]) => void,
): VideoProject {
  const first = project.shots[0]!;
  const second = structuredClone(first);
  second.shotId = OTHER_SHOT_ID;
  second.order = 1;
  second.workingVersionId = OTHER_VERSION_ID;
  second.contentVersions[0]!.versionId = OTHER_VERSION_ID;
  for (const event of second.events)
    if ("versionId" in event) event.versionId = OTHER_VERSION_ID;
  mutate?.(second);
  return { ...project, shots: [first, second] };
}

test("双镜头且全局 shotId/versionId/order 唯一 → 通过", () => {
  const project = withSecondShot(baseProject());
  assert.equal(validateVideoProject(project).shots.length, 2);
});

test("跨镜头 shotId 重复 → 拒绝", () => {
  const project = withSecondShot(baseProject(), (shot) => {
    shot.shotId = UUID;
  });
  assert.throws(() => validateVideoProject(project), /shotId/);
});

test("跨镜头 versionId 重复 → 拒绝（RenderRecord 引用会产生歧义）", () => {
  const project = withSecondShot(baseProject(), (shot) => {
    shot.contentVersions[0]!.versionId = UUID;
    shot.workingVersionId = UUID;
    for (const event of shot.events)
      if ("versionId" in event) event.versionId = UUID;
  });
  assert.throws(() => validateVideoProject(project), /duplicated across shots/);
});

test("跨镜头 order 重复 → 拒绝", () => {
  const project = withSecondShot(baseProject(), (shot) => {
    shot.order = 0;
  });
  assert.throws(() => validateVideoProject(project), /order/);
});

// —— P1 转场（Feature ④ spec R1）：可变编排元数据，schema 层查形状/枚举/范围/重复 ——
test("transitions 合法条目通过并原样返回", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500 }];
  assert.deepEqual(
    validateVideoProject(project).transitions,
    project.transitions,
  );
});

test("transitions 单镜头 boundary 越界 → 拒绝并指路清理", () => {
  const project = baseProject(); // 单镜头：合法 0..-1 为空集
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500 }];
  assert.throws(() => validateVideoProject(project), /boundary 越界/);
});

test("transitions kind/durationMs 非法 → 拒绝", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [
    { boundary: 0, kind: "wipe" as never, durationMs: 500 },
  ];
  assert.throws(() => validateVideoProject(project), /kind 须为 fade/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 99 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 2001 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
  project.transitions = [{ boundary: 0, kind: "fade", durationMs: 500.5 }];
  assert.throws(() => validateVideoProject(project), /durationMs/);
});

test("transitions 同 boundary 重复 → 拒绝", () => {
  const project = withSecondShot(baseProject());
  project.transitions = [
    { boundary: 0, kind: "fade", durationMs: 500 },
    { boundary: 0, kind: "fade", durationMs: 300 },
  ];
  assert.throws(() => validateVideoProject(project), /重复/);
});
