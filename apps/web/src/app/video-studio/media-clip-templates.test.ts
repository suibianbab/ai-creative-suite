// P2.5-T3 M 表：草稿回填/默认值、行内校验全负路径、整帧与语速软预警。
import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import {
  buildMediaRevisePatch,
  draftMediaFromVersion,
  type MediaEditDraft,
} from "./media-clip-templates";

const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";

function asset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
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

function draft(overrides: Partial<MediaEditDraft> = {}): MediaEditDraft {
  return {
    assetId: ASSET_ID,
    inMsText: "500",
    outMsText: "2500",
    fit: "cover",
    focalPercentText: "50",
    audio: "mute",
    ...overrides,
  };
}

const MEDIA_WORKING = {
  sceneSource: {
    type: "media-clip" as const,
    mediaAssetId: ASSET_ID,
    inMs: 500,
    outMs: 2500,
    fit: "cover" as const,
    focalX: 0.33,
    audio: "keep" as const,
  },
  durationMs: 2000,
};

test("M2：media 工作版本 → 草稿回填（focal 取整为百分数）", () => {
  const { draft: d, error } = draftMediaFromVersion(MEDIA_WORKING, [asset()]);
  assert.equal(error, null);
  assert.deepEqual(d, {
    assetId: ASSET_ID,
    inMsText: "500",
    outMsText: "2500",
    fit: "cover",
    focalPercentText: "33",
    audio: "keep",
  });
});

test("M2：非 media 版本 + 有账本 → 默认草稿（outMs=min(2000, 时长)）；无账本 → 指路错误", () => {
  const specWorking = {
    sceneSource: { type: "spec" as const, spec: {} },
    durationMs: 2000,
  };
  const { draft: d } = draftMediaFromVersion(specWorking, [asset()]);
  assert.deepEqual(d, {
    assetId: ASSET_ID,
    inMsText: "0",
    outMsText: "2000",
    fit: "cover",
    focalPercentText: "50",
    audio: "mute",
  });
  const short = asset();
  short.original.durationMs = 1200;
  assert.equal(
    draftMediaFromVersion(specWorking, [short]).draft?.outMsText,
    "1200",
  );
  const empty = draftMediaFromVersion(undefined, []);
  assert.equal(empty.draft, null);
  assert.match(empty.error!, /尚无媒体素材/);
});

test("M3：正路径——focal 33 → focalX 0.33，patch 无 durationMs（op 算），narration 带上", () => {
  const { patch, error, warnings } = buildMediaRevisePatch(
    draft({ focalPercentText: "33" }),
    [asset()],
    "旁白文本",
  );
  assert.equal(error, null);
  assert.deepEqual(patch, {
    narrationText: "旁白文本",
    mediaClip: {
      mediaAssetId: ASSET_ID,
      inMs: 500,
      outMs: 2500,
      fit: "cover",
      focalX: 0.33,
      audio: "mute",
    },
  });
  assert.deepEqual(warnings, []);
});

test("M3：素材不在账本 → 拒，不静默换首条（Review Focus #2）", () => {
  const { patch, error } = buildMediaRevisePatch(
    draft({ assetId: "gone" }),
    [asset()],
    "",
  );
  assert.equal(patch, null);
  assert.match(error!, /素材不存在或已移除：gone/);
});

test("M3：入出点文本非法（全角/小数/负号/空/科学计数）→ regex 拒", () => {
  for (const bad of ["１００", "1.5", "-100", "", "1e3"]) {
    assert.match(
      buildMediaRevisePatch(draft({ inMsText: bad }), [asset()], "").error!,
      /整数毫秒/,
      bad,
    );
    assert.match(
      buildMediaRevisePatch(draft({ outMsText: bad }), [asset()], "").error!,
      /整数毫秒/,
      bad,
    );
  }
});

test("M3：focal 全角拒、前导零合法=50、越界 101 拒（Review Focus #3）", () => {
  assert.match(
    buildMediaRevisePatch(draft({ focalPercentText: "５０" }), [asset()], "")
      .error!,
    /0\.\.100 整数/,
  );
  const legal = buildMediaRevisePatch(
    draft({ focalPercentText: "0050" }),
    [asset()],
    "",
  );
  assert.equal(legal.patch!.mediaClip.focalX, 0.5);
  assert.match(
    buildMediaRevisePatch(draft({ focalPercentText: "101" }), [asset()], "")
      .error!,
    /0\.\.100 整数/,
  );
});

test("M3：出点 < 入点+200 / 出点 > 素材时长 → 中文指路拒", () => {
  assert.match(
    buildMediaRevisePatch(draft({ outMsText: "600" }), [asset()], "").error!,
    /出点越界/,
  );
  assert.match(
    buildMediaRevisePatch(draft({ outMsText: "5001" }), [asset()], "").error!,
    /出点越界.*素材时长 5000ms.*入=500 出=5001/,
  );
});

test("M4：非整帧 → 软预警不阻塞；整帧 → 无预警", () => {
  const off = buildMediaRevisePatch(draft({ inMsText: "10" }), [asset()], ""); // 10*24=240 非 1000 倍数
  assert.ok(off.patch, "非整帧是预警不是错误");
  assert.equal(off.warnings.length, 1);
  assert.match(off.warnings[0]!, /非整帧/);
  const on = buildMediaRevisePatch(
    draft({ inMsText: "1000", outMsText: "3000" }),
    [asset()],
    "",
  ); // 24/72 帧整
  assert.deepEqual(on.warnings, []);
});

test("M5：旁白语速超片段 → 软预警；短旁白无预警", () => {
  const long = buildMediaRevisePatch(draft(), [asset()], "一".repeat(20)); // 400+300×20 ≫ 2000ms
  assert.ok(long.warnings.some((w) => /超出片段/.test(w)));
  const short = buildMediaRevisePatch(draft(), [asset()], "短句"); // 400+600 < 2000ms
  assert.ok(!short.warnings.some((w) => /超出片段/.test(w)));
});

test("M3：fit/audio 非法枚举兜底拒", () => {
  assert.match(
    buildMediaRevisePatch(draft({ fit: "fill" as never }), [asset()], "")
      .error!,
    /cover 或 contain/,
  );
  assert.match(
    buildMediaRevisePatch(draft({ audio: "loud" as never }), [asset()], "")
      .error!,
    /mute 或 keep/,
  );
});
