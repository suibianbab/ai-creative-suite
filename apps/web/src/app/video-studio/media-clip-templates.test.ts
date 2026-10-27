// P2.5-T3 M 表：草稿回填/默认值、行内校验全负路径、整帧与语速软预警。
import assert from "node:assert/strict";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import {
  buildMediaRevisePatch,
  draftMediaFromVersion,
  MEDIA_TEMPLATE_ID,
  type MediaEditDraft,
  mediaDraftForAsset,
  mediaTemplateSelectValue,
} from "./media-clip-templates";

const ASSET_ID = "1f0b13a2-6c63-4d3d-9a52-a70f6a3b2001";

function asset(): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "clip.mp4" },
    original: {
      kind: "video" as const,
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

// 任务 1（2026-10-28）：图片夹具——无时长/帧率/编码/音轨。
// 视频 original 可变窄化（判别联合下直接改字段需要先窄化）。
function videoOriginal(asset: MediaAsset) {
  return asset.original as Extract<MediaAsset["original"], { kind?: "video" }>;
}

function imageAsset(overrides: Record<string, unknown> = {}): MediaAsset {
  return {
    assetId: ASSET_ID,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "product.png" },
    original: {
      kind: "image" as const,
      sha256: "b".repeat(64),
      bytes: 20480,
      width: 1200,
      height: 900,
      format: "png" as const,
      storeKey: "bbbbbbbbbbbbbbbb.png",
    },
    ...overrides,
  } as MediaAsset;
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
    motion: undefined,
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
    motion: "still",
  });
  const short = asset();
  videoOriginal(short).durationMs = 1200;
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

test("M3：audio=keep 需素材有音轨（无音轨 → 行内拒；有音轨 → 放行）", () => {
  const rejected = buildMediaRevisePatch(
    draft({ audio: "keep" }),
    [asset()], // hasAudio: false
    "",
  );
  assert.equal(rejected.patch, null);
  assert.match(rejected.error!, /无音轨/);
  assert.match(rejected.error!, new RegExp(ASSET_ID));

  const withAudio = asset();
  videoOriginal(withAudio).hasAudio = true;
  const accepted = buildMediaRevisePatch(
    draft({ audio: "keep" }),
    [withAudio],
    "",
  );
  assert.equal(accepted.error, null);
  assert.equal(accepted.patch?.mediaClip.audio, "keep");
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

test("M5→N6：旁白语速超片段 → 应用时错误（不再软预警）；短旁白正常", () => {
  const long = buildMediaRevisePatch(draft(), [asset()], "一".repeat(20)); // 400+300×20 ≫ 2000ms
  assert.equal(long.patch, null);
  assert.match(String(long.error), /旁白按语速需|精简旁白/);
  const short = buildMediaRevisePatch(draft(), [asset()], "短句"); // 400+600 < 2000ms
  assert.ok(short.patch);
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

test("M6：media 源未选模板 → 下拉默认停在本族条目（终评 F1 修复）", () => {
  assert.equal(mediaTemplateSelectValue("", true), MEDIA_TEMPLATE_ID);
});

test("M6：已选模板或 spec 源 → 下拉保持所选/所空原值", () => {
  assert.equal(
    mediaTemplateSelectValue("bar-compare-4", true),
    "bar-compare-4",
  );
  assert.equal(mediaTemplateSelectValue("", false), "");
  assert.equal(
    mediaTemplateSelectValue(MEDIA_TEMPLATE_ID, false),
    MEDIA_TEMPLATE_ID,
  );
});

test("M7：mediaDraftForAsset 默认草稿全值（入点 0 / 出点 min(2000, 时长) / cover / focal 50 / mute）", () => {
  assert.deepEqual(mediaDraftForAsset(asset()), {
    assetId: ASSET_ID,
    inMsText: "0",
    outMsText: "2000",
    fit: "cover",
    focalPercentText: "50",
    audio: "mute",
    motion: "still",
  });
});

test("M7：mediaDraftForAsset 短素材 outMsText 取素材时长", () => {
  const short = asset();
  videoOriginal(short).durationMs = 1200;
  assert.equal(mediaDraftForAsset(short).outMsText, "1200");
});

// N6（2026-10-27）：绑定动作处的旁白预算对齐——种子出点按旁白语速需求
// 扩到 max(2000, 400+300×字)（素材够长时），应用时跨度不足 fail-fast
// （不再拖到出片 500）。
test("N6：媒体草稿种子按旁白预算扩出点", () => {
  const a = asset();
  // 8 字旁白 → 400+2400=2800ms；素材 5000ms 够长 → 种子出点 2800。
  const seeded = mediaDraftForAsset(a, "八个字的旁白文本");
  assert.equal(seeded.outMsText, "2800");
  // 短旁白维持 2000 下限。
  assert.equal(mediaDraftForAsset(a, "两字").outMsText, "2000");
  // 素材不够长 → 取素材全长。
  const short = { ...a, original: { ...a.original, durationMs: 2300 } };
  assert.equal(mediaDraftForAsset(short, "八个字的旁白文本").outMsText, "2300");
});

test("N6：应用时片段跨度低于旁白预算 → 可操作错误（不落版本）", () => {
  const built = buildMediaRevisePatch(
    draft({ inMsText: "0", outMsText: "2000" }),
    [asset()],
    "八个字的旁白文本",
  );
  assert.equal(built.patch, null);
  assert.match(String(built.error), /2800|旁白/);
  assert.match(String(built.error), /把出点扩到|精简旁白/);
  // 跨度足够 → 正常出 patch。
  const ok = buildMediaRevisePatch(
    draft({ inMsText: "0", outMsText: "2800" }),
    [asset()],
    "八个字的旁白文本",
  );
  assert.ok(ok.patch);
});
