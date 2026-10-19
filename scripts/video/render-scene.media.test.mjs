// P2.5-T4 G1-G7 纯装配逻辑单测（不跑 Remotion、零网络）：fs/hash/探针全注入。
// fixture 沿 render-scene.narration.test.mjs 风格：内联最小 project + mediaAssets。
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHasAudioTrack,
  buildManifestMedia,
  buildShotAssetDigests,
  buildTimelineShotMedia,
  collectMediaShots,
  isBlackTail,
  mediaTrimBefore,
  parseTailYavg,
  verifyMediaAssets,
} from "./render-scene.media.mjs";

const FPS = 24;

function mediaAsset(assetId, over = {}) {
  return {
    assetId,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      sha256: "a".repeat(64),
      bytes: 1000,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      // storeKey 须为 16 位 hex（形状门会核）——asset-N 映射成合法 hex 键
      storeKey:
        `${"0".repeat(16)}${assetId.replace(/[^0-9]/g, "")}`.slice(-16) +
        ".mp4",
      ...over,
    },
  };
}

function mediaShot(
  shotId,
  versionId,
  mediaAssetId,
  inMs,
  outMs,
  audio = "mute",
) {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs: outMs - inMs, // C4：durationMs = 出点−入点
        description: "",
        narrationText: "",
        sceneSource: {
          type: "media-clip",
          mediaAssetId,
          inMs,
          outMs,
          fit: "cover",
          focalX: 0.5,
          audio,
        },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

function specShot(shotId, versionId, durationMs) {
  return {
    shotId,
    order: 1,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs,
        description: "",
        narrationText: "",
        sceneSource: { type: "spec", spec: { componentId: "x" } },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

const project = (shots) => ({
  schemaVersion: 1,
  id: "p1",
  title: "t",
  brief: { sentence: "s", aspectTargets: ["landscape"] },
  shots,
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

// ── G1 collectMediaShots ─────────────────────────────────────────────

test("G1 装配：media 镜头成 entry（带资产快照），spec 镜头跳过，账本缺失大声报", () => {
  const proj = project([
    specShot("s1", "v1", 2000),
    mediaShot("s2", "v2", "asset-2", 1000, 3000, "keep"),
  ]);
  const { entries, problems } = collectMediaShots(proj, [
    mediaAsset("asset-2"),
  ]);
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].shotIndex, 1);
  assert.equal(entries[0].shotId, "s2");
  assert.equal(entries[0].versionId, "v2");
  assert.equal(entries[0].media.mediaAssetId, "asset-2");
  assert.equal(entries[0].media.inMs, 1000);
  assert.equal(entries[0].asset.storeKey, "0000000000000002.mp4");
  assert.equal(entries[0].asset.sha256, "a".repeat(64));

  const missing = collectMediaShots(
    project([mediaShot("s2", "v2", "ghost", 0, 2000)]),
    [mediaAsset("asset-2")],
  );
  assert.equal(missing.entries.length, 0);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0], /素材不在账本：ghost/);
});

test("G1 装配：出点超素材时长拒（手改 JSON 的越界兜底）", () => {
  const { problems } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 0, 6000)]),
    [mediaAsset("asset-2")], // durationMs 5000
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /片段出点 6000ms 超素材时长 5000ms/);
});

// ── B5 trimBefore ────────────────────────────────────────────────────

test("B5 trimBefore：半进位边界（×.488 下取、×.512 上取、整帧精确）", () => {
  assert.equal(mediaTrimBefore(1500, FPS), 36); // 整帧 36.0
  assert.equal(mediaTrimBefore(1562, FPS), 37); // 37.488 → 37
  assert.equal(mediaTrimBefore(1563, FPS), 38); // 37.512 → 38
  assert.equal(mediaTrimBefore(0, FPS), 0);
});

// ── G2 props 装配 ────────────────────────────────────────────────────

test("G2 props：media 键位首序 + 两画幅无差（无合成宽高入 props）+ trimBefore 内嵌", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 1000, 3000, "keep")]),
    [mediaAsset("asset-2")],
  );
  const shot = {
    ...buildTimelineShotMedia(
      entries[0],
      "http://127.0.0.1:7/original/x.mp4",
      FPS,
    ),
    startFrame: 24,
    frames: 48,
  };
  assert.equal(
    JSON.stringify(shot),
    '{"media":{"src":"http://127.0.0.1:7/original/x.mp4","assetWidth":1920,"assetHeight":1080,"inMs":1000,"outMs":3000,"fit":"cover","focalX":0.5,"audio":"keep","trimBefore":24},"startFrame":24,"frames":48}',
  );
});

// ── G3 仓核验 ────────────────────────────────────────────────────────

test("G3 核验：存在性缺失与 sha 漂移都大声报（含 storeKey 与仓根指路），通过则零问题", async () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 0, 2000)]),
    [mediaAsset("asset-2")],
  );
  const ok = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => true,
    hashFile: async () => "a".repeat(64),
  });
  assert.deepEqual(ok, []);

  const gone = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => false,
    hashFile: async () => "a".repeat(64),
  });
  assert.match(gone[0], /媒体文件缺失：0000000000000002\.mp4/);
  assert.match(gone[0], /ACS_MEDIA_STORE=D:\/store/); // 仓根原串进文案指路

  const drifted = await verifyMediaAssets(entries, {
    storeRoot: "D:/store",
    existsSync: () => true,
    hashFile: async () => "b".repeat(64),
  });
  assert.match(drifted[0], /素材摘要不符/);
  assert.match(drifted[0], /账本 a{12}… 实测 b{12}…/);
});

test("G3 核验：storeKey 形状异常（账本被手改）也拒绝，不触 fs", async () => {
  const good = collectMediaShots(
    project([mediaShot("s2", "v2", "asset-2", 0, 2000)]),
    [mediaAsset("asset-2")],
  ).entries[0];
  const bad = {
    ...good,
    asset: { ...good.asset, storeKey: "../escape.mp4" },
  };
  const problems = await verifyMediaAssets([bad], {
    storeRoot: "D:/store",
    existsSync: () => {
      throw new Error("不该触 fs");
    },
    hashFile: async () => "a".repeat(64),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /storeKey 形状非法/);
});

// ── G4 aac 四象限 ────────────────────────────────────────────────────

test("G4 音轨判定四象限：仅旁白/仅 keep/keep+旁白/mute 无旁白", () => {
  const keep = collectMediaShots(
    project([mediaShot("s2", "v2", "a", 0, 2000, "keep")]),
    [mediaAsset("a")],
  ).entries;
  const mute = collectMediaShots(
    project([mediaShot("s3", "v3", "a", 0, 2000, "mute")]),
    [mediaAsset("a")],
  ).entries;
  assert.equal(buildHasAudioTrack([{}], mute), true); // 仅旁白
  assert.equal(buildHasAudioTrack([], keep), true); // 仅媒体 keep
  assert.equal(buildHasAudioTrack([{}], keep), true); // 双有
  assert.equal(buildHasAudioTrack([], mute), false); // 全无
});

// ── B6/G5 末帧黑帧 ───────────────────────────────────────────────────

test("G5 末帧 YAVG 解析：多行取末值、无匹配 null、16 黑 17 非黑", () => {
  const text =
    "[Parsed_metadata…] yuvavg inactive\nframe:0 pts:0\nYMIN=0 YMAX=255 YAVG=17.5\nYAVG=16.0\n";
  assert.equal(parseTailYavg(text), 16.0);
  assert.equal(parseTailYavg("ffmpeg 挂了没有任何统计行"), null);
  assert.equal(isBlackTail(16), true);
  assert.equal(isBlackTail(16.0), true);
  assert.equal(isBlackTail(17), false);
  assert.equal(isBlackTail(null), false); // 解析失败不误判黑，交调用方大声处理
});

// ── G6/G7 证据 ───────────────────────────────────────────────────────

test("G6 manifest.media：逐镜头证据（sha256+trimBefore+frames 取自帧图 span）", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s1", "v1", "asset-1", 1000, 3000, "keep")]),
    [mediaAsset("asset-1")],
  );
  const timeline = {
    shots: [{ shotIndex: 0, startFrame: 0, frames: 48 }],
    totalFrames: 48,
  };
  assert.deepEqual(buildManifestMedia(entries, timeline, FPS), [
    {
      shotIndex: 0,
      versionId: "v1",
      mediaAssetId: "asset-1",
      storeKey: "0000000000000001.mp4",
      sha256: "a".repeat(64),
      inMs: 1000,
      outMs: 3000,
      trimBefore: 24,
      frames: 48,
      audio: "keep",
    },
  ]);
});

test("G7 RenderRecord assetDigests：key=mediaAssetId、value=素材 original sha256", () => {
  const { entries } = collectMediaShots(
    project([mediaShot("s1", "v1", "asset-1", 0, 2000)]),
    [mediaAsset("asset-1")],
  );
  assert.deepEqual(buildShotAssetDigests(entries[0]), {
    "asset-1": "a".repeat(64),
  });
});
