// P2.5-T6（spec §2.3 U5）：下载成功直接应用的单事务纯逻辑。
// 基线必须是调用方手里的最新文档；账本追加与镜头修订一次 save 落盘；
// 下载期间其他镜头的编辑保留，目标镜头被删则只入库并提示。
import assert from "node:assert/strict";
import test from "node:test";
import {
  type ContentVersion,
  type MediaAsset,
  type Shot,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";
import {
  applyStockAsset,
  type ImportStockDeps,
  importStockForShot,
} from "./stock-apply";

const PROJECT_ID = "eeeeeeee-1111-4111-8111-111111111111";
const SHOT_A = "aaaaaaaa-2222-4222-8222-222222222222";
const SHOT_B = "bbbbbbbb-2222-4222-8222-222222222222";
const MISSING_SHOT = "ffffffff-2222-4222-8222-222222222222";
const V_A = "aaaaaaaa-3333-4333-8333-333333333333";
const V_B = "bbbbbbbb-3333-4333-8333-333333333333";
const V_B2 = "cccccccc-3333-4333-8333-333333333333";
const NEW_VERSION = "dddddddd-3333-4333-8333-333333333333";
const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";
const PAGE_TITLE = "File:Water cycle.webm";
const DERIVATIVE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/x/Water_cycle.webm.720p.mp4";
const AT = "2026-10-20T00:00:00.000Z";

function stockAsset(
  overrides: Partial<
    Extract<MediaAsset["original"], { kind?: "video" }>
  > = {},
): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: AT,
    origin: {
      kind: "stock-source",
      sourceId: "wikimedia",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Water_cycle.webm",
      license: { name: "CC BY-SA 4.0", author: "示例作者" },
      retrievedAt: AT,
    },
    original: {
      kind: "video" as const,
      sha256: "a".repeat(64),
      bytes: 100,
      durationMs: 5000,
      width: 1280,
      height: 720,
      fps: 24,
      codec: "h264",
      hasAudio: false,
      storeKey: "aaaaaaaaaaaaaaaa.mp4",
      ...overrides,
    },
  };
}

function version(
  versionId: string,
  narrationText: string,
  durationMs = 2000,
): ContentVersion {
  return {
    versionId,
    createdAt: AT,
    durationMs,
    description: "测试镜头",
    narrationText,
    sceneSource: { type: "spec", spec: { specVersion: 1, durationMs } },
    provenance: { engineId: "test", engineVersion: "1" },
  };
}

function shot(
  shotId: string,
  order: number,
  versions: ContentVersion[],
  workingVersionId = versions[versions.length - 1]!.versionId,
): Shot {
  return {
    shotId,
    order,
    locked: false,
    workingVersionId,
    contentVersions: versions,
    events: versions.map((v) => ({
      kind: "submitted" as const,
      versionId: v.versionId,
      at: AT,
      actor: "ai" as const,
    })),
  };
}

function project(shots: Shot[], mediaAssets?: MediaAsset[]): VideoProject {
  return {
    schemaVersion: 1,
    id: PROJECT_ID,
    title: "测试项目",
    brief: { sentence: "", aspectTargets: ["landscape"] },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    ...(mediaAssets === undefined ? {} : { mediaAssets }),
  };
}

function fakeDeps(): {
  deps: ImportStockDeps;
  calls: { requestImport: Array<[string, string]>; save: VideoProject[] };
} {
  const calls = {
    requestImport: [] as Array<[string, string]>,
    save: [] as VideoProject[],
  };
  return {
    calls,
    deps: {
      requestImport: async (pageTitle, derivativeUrl) => {
        calls.requestImport.push([pageTitle, derivativeUrl]);
        return stockAsset();
      },
      save: async (document) => {
        calls.save.push(document);
        return document;
      },
      newVersionId: () => NEW_VERSION,
    },
  };
}

test("U5 成功：追加账本 + 默认媒体工作版本 + 旁白沿用，save 恰好一次", async () => {
  const latest = project([shot(SHOT_A, 0, [version(V_A, "第一镜旁白。")])]);
  const { deps, calls } = fakeDeps();

  const result = await importStockForShot(
    latest,
    SHOT_A,
    PAGE_TITLE,
    DERIVATIVE_URL,
    deps,
  );

  assert.deepEqual(calls.requestImport, [[PAGE_TITLE, DERIVATIVE_URL]]);
  assert.equal(calls.save.length, 1, "账本 + 修订必须一次 save 落盘");
  assert.equal(calls.save[0], result.document, "返回的是已保存文档");
  assert.equal(result.message, "素材已下载并应用（镜头 1）");

  const saved = result.document;
  assert.deepEqual(saved.mediaAssets, [stockAsset()]);
  const shotA = saved.shots.find((s) => s.shotId === SHOT_A)!;
  assert.equal(shotA.workingVersionId, NEW_VERSION);
  assert.equal(shotA.contentVersions.length, 2);
  const working = shotA.contentVersions[1]!;
  assert.equal(working.versionId, NEW_VERSION);
  assert.equal(working.narrationText, "第一镜旁白。", "旁白沿用工作版本原值");
  assert.deepEqual(working.sceneSource, {
    type: "media-clip",
    mediaAssetId: ASSET_ID,
    inMs: 0,
    // N6：种子出点按旁白预算扩（6 字 → 400+300×6=2200ms）。
    outMs: 2200,
    fit: "cover",
    focalX: 0.5,
    audio: "mute",
  });
  assert.equal(working.durationMs, 2200, "durationMs = outMs − inMs");
  validateVideoProject(saved);

  assert.equal(latest.mediaAssets, undefined, "入参文档不得被修改");
  assert.equal(latest.shots[0]!.contentVersions.length, 1);
});

test("U5 以最新文档为基线：下载期间其他镜头的修订被保留", async () => {
  const baseB = shot(SHOT_B, 1, [version(V_B, "第二镜旁白。")]);
  const revisedB: Shot = {
    ...baseB,
    contentVersions: [
      ...baseB.contentVersions,
      version(V_B2, "下载期间改过的旁白。", 2500),
    ],
    events: [
      ...baseB.events,
      { kind: "submitted", versionId: V_B2, at: AT, actor: "human" },
    ],
    workingVersionId: V_B2,
  };
  const latest = project([
    shot(SHOT_A, 0, [version(V_A, "第一镜旁白。")]),
    revisedB,
  ]);
  const { deps, calls } = fakeDeps();

  const result = await importStockForShot(
    latest,
    SHOT_A,
    PAGE_TITLE,
    DERIVATIVE_URL,
    deps,
  );

  const returnedB = result.document.shots.find((s) => s.shotId === SHOT_B)!;
  assert.deepEqual(returnedB, latest.shots[1], "其他镜头保持最新文档原样");
  assert.equal(returnedB.workingVersionId, V_B2);
  assert.equal(calls.save.length, 1);
  validateVideoProject(result.document);
});

test("U5 镜头已不存在：只追加账本，applied:false，消息逐字", async () => {
  const latest = project([shot(SHOT_A, 0, [version(V_A, "第一镜旁白。")])]);

  const applied = applyStockAsset(
    latest,
    MISSING_SHOT,
    stockAsset(),
    NEW_VERSION,
  );
  assert.equal(applied.applied, false);
  assert.equal(applied.message, "素材已入库；原镜头已不存在，请在镜头卡中选择");
  assert.deepEqual(applied.document.mediaAssets, [stockAsset()]);
  assert.deepEqual(applied.document.shots, latest.shots, "不得强行重建镜头");

  const { deps, calls } = fakeDeps();
  const result = await importStockForShot(
    latest,
    MISSING_SHOT,
    PAGE_TITLE,
    DERIVATIVE_URL,
    deps,
  );
  assert.equal(calls.save.length, 1, "镜头不在也必须把账本持久化");
  assert.equal(result.message, "素材已入库；原镜头已不存在，请在镜头卡中选择");
  assert.deepEqual(result.document.mediaAssets, [stockAsset()]);
});

test("U5 save 抛错：importStockForShot 拒绝且不返回文档", async () => {
  let imports = 0;
  let saves = 0;
  const deps: ImportStockDeps = {
    requestImport: async () => {
      imports += 1;
      return stockAsset();
    },
    save: async () => {
      saves += 1;
      throw new Error("保存失败：网络中断");
    },
    newVersionId: () => NEW_VERSION,
  };

  await assert.rejects(
    importStockForShot(
      project([shot(SHOT_A, 0, [version(V_A, "第一镜旁白。")])]),
      SHOT_A,
      PAGE_TITLE,
      DERIVATIVE_URL,
      deps,
    ),
    /保存失败：网络中断/,
  );
  assert.equal(imports, 1);
  assert.equal(saves, 1);
});
