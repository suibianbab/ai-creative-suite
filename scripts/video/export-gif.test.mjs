// D4 导出扩充：GIF 派生交付纯逻辑单测（ffmpeg/ffprobe 只在 CLI 主路径，不进单测）。
// 装配规则：renderRecords 尾部同 outputAssetRef 连续块 = 该画幅最近一次整片渲染
// 的逐镜头记录；frameMap 精确整数（fps 整除 24）；DeliveryRecord 经 appendDelivery
// 落档（追加 + savedVersion+1 + 重校验拦截脏引用）。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendDelivery,
  buildGifFilter,
  findRenderBlock,
  GIF_FPS_CHOICES,
  gifFrameMap,
  RENDER_FPS,
} from "./export-gif.mjs";

const T = "2026-10-18T00:00:00.000Z";

function version(versionId, durationMs) {
  return {
    versionId,
    createdAt: T,
    durationMs,
    description: "占位",
    narrationText: "占位。",
    sceneSource: {
      type: "spec",
      spec: {
        componentId: "text-animation",
        componentVersion: 1,
        seed: 1,
        durationMs,
        background: "#ffffff",
        params: {},
      },
    },
    provenance: { engineId: "planner-rules", engineVersion: "1" },
  };
}

function project() {
  const v1 = randomUUID();
  const v2 = randomUUID();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: "GIF 单测项目",
    brief: { sentence: "占位", aspectTargets: ["landscape", "portrait"] },
    shots: [
      {
        shotId: randomUUID(),
        order: 0,
        locked: false,
        workingVersionId: v1,
        contentVersions: [version(v1, 2000)],
        events: [{ at: T, kind: "submitted", actor: "human", versionId: v1 }],
      },
      {
        shotId: randomUUID(),
        order: 1,
        locked: false,
        workingVersionId: v2,
        contentVersions: [version(v2, 3000)],
        events: [{ at: T, kind: "submitted", actor: "human", versionId: v2 }],
      },
    ],
    renderRecords: [],
    deliveries: [],
    savedVersion: 3,
  };
}

function record(aspect, ref, versionId, frames) {
  const [width, height] = aspect === "landscape" ? [1280, 720] : [720, 1280];
  return {
    renderId: randomUUID(),
    versionId,
    contentDigest: "0".repeat(64),
    engineId: "remotion",
    engineVersion: "1",
    rendererVersion: "4.0.534",
    browser: "Chrome 155",
    fps: RENDER_FPS,
    width,
    height,
    codec: "h264",
    frames,
    fontDigests: {},
    outputAssetRef: ref,
  };
}

test("findRenderBlock 取同画幅尾块（跨画幅穿插后）", () => {
  const p = project();
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  p.renderRecords = [
    record("landscape", "r1/landscape.mp4", a, 48),
    record("landscape", "r1/landscape.mp4", b, 72),
    record("portrait", "r1/portrait.mp4", a, 48),
    record("portrait", "r1/portrait.mp4", b, 72),
    record("landscape", "r2/landscape.mp4", a, 48),
    record("landscape", "r2/landscape.mp4", b, 72),
  ];
  const block = findRenderBlock(p, "landscape");
  assert.equal(block.records.length, 2);
  assert.ok(block.outputAssetRef.startsWith("r2/"));
  assert.deepEqual(
    block.records.map((r) => r.frames),
    [48, 72],
  );
  const portrait = findRenderBlock(p, "portrait");
  assert.ok(portrait.outputAssetRef.startsWith("r1/"));
});

test("findRenderBlock 无该画幅记录报错指路 render-scene", () => {
  const p = project();
  assert.throws(() => findRenderBlock(p, "portrait"), /先跑 render-scene/);
});

test("带风格项目拒绝从旧风格或旧镜头渲染记录派生 GIF", () => {
  const p = project();
  const [a, b] = p.shots.map((s) => s.workingVersionId);
  const ref = {
    bibleId: "65a9df5b-3e3a-4b4e-b50e-fb91a0bd6c07",
    versionId: "88519557-c3a4-44c8-a615-503ed00a67c6",
    digest: "a".repeat(64),
  };
  p.styleBibleRef = ref;
  p.renderRecords = [
    { ...record("landscape", "r/landscape.mp4", a, 48), styleBibleRef: ref },
    { ...record("landscape", "r/landscape.mp4", b, 72), styleBibleRef: ref },
  ];
  assert.equal(findRenderBlock(p, "landscape").records.length, 2);
  p.renderRecords[1].styleBibleRef = { ...ref, digest: "b".repeat(64) };
  assert.throws(() => findRenderBlock(p, "landscape"), /Style Bible/);
  p.renderRecords[1].styleBibleRef = ref;
  p.shots[1].workingVersionId = "3b56d627-a04a-48dd-82b0-9394ca9f0b45";
  assert.throws(() => findRenderBlock(p, "landscape"), /工作镜头版本/);
});

test("findRenderBlock 块长度与镜头数不符报错", () => {
  const p = project();
  const a = p.shots[0].contentVersions[0].versionId;
  p.renderRecords = [record("landscape", "r1/landscape.mp4", a, 48)];
  assert.throws(() => findRenderBlock(p, "landscape"), /重渲染/);
});

test("gifFrameMap 整除时精确整数，非整除拒绝并列合法值", () => {
  const records = [{ frames: 48 }, { frames: 74 }];
  assert.deepEqual(gifFrameMap(records, 12), [24, 37]);
  assert.throws(
    () => gifFrameMap(records, 10),
    new RegExp(GIF_FPS_CHOICES.join("/")),
  );
});

test("gifFrameMap 帧数不被采样步长整除时产出非整数 → 拒绝并指路 fps 24（终评 C1）", () => {
  // fps 整除 24 只保证步长整数，不保证每镜头帧数/步长整数：
  // 49 帧 @12fps = 24.5；74 帧 @8fps = 24.67。旧实现放行小数，
  // 在 appendDelivery 的 schema 校验处以裸栈崩（转码已完成、交付未落档）。
  assert.throws(
    () => gifFrameMap([{ frames: 49 }, { frames: 74 }], 12),
    /fps 24/,
  );
  assert.throws(() => gifFrameMap([{ frames: 74 }], 8), /fps 24/);
  // fps 24 恒等于原帧数，任何帧图都整数。
  assert.deepEqual(gifFrameMap([{ frames: 49 }, { frames: 74 }], 24), [49, 74]);
});

test("findRenderBlock 同目录重复出片（单画幅同 ref 连续块）取最近一趟（终评 I1）", () => {
  // render-scene 的 outputAssetRef 纯路径派生：同 --out 重渲追加同 ref 记录。
  // 单画幅项目两趟 = 2N 条连续同 ref；旧实现按块长 ≠ N 永久报错，
  // 且其指路的「重渲染」补救无法解除。整倍数 → 取尾部最近一趟。
  const p = project();
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  p.renderRecords = [
    record("portrait", "o/portrait.mp4", a, 48),
    record("portrait", "o/portrait.mp4", b, 72),
    record("portrait", "o/portrait.mp4", a, 48),
    record("portrait", "o/portrait.mp4", b, 72),
  ];
  const block = findRenderBlock(p, "portrait");
  assert.equal(block.records.length, 2);
  // 尾部一趟 = 第 3、4 条记录
  assert.deepEqual(
    block.records.map((r) => r.renderId),
    p.renderRecords.slice(2).map((r) => r.renderId),
  );
});

test("findRenderBlock 块长非镜头数整倍数仍拒绝（防镜头增删后误派生）", () => {
  const p = project();
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  p.renderRecords = [
    record("landscape", "r/landscape.mp4", a, 48),
    record("landscape", "r/landscape.mp4", b, 72),
    record("landscape", "r/landscape.mp4", a, 48),
  ];
  assert.throws(() => findRenderBlock(p, "landscape"), /重渲染/);
});

test("buildGifFilter 含 fps/scale/palettegen/paletteuse", () => {
  const filter = buildGifFilter({ fps: 12, width: 480, colors: 128 });
  assert.ok(filter.includes("fps=12"));
  assert.ok(filter.includes("scale=480:-1:flags=lanczos"));
  assert.ok(filter.includes("palettegen=max_colors=128"));
  assert.ok(filter.includes("paletteuse=dither=bayer"));
  assert.ok(filter.endsWith("[out]"));
});

test("appendDelivery 追加交付并 savedVersion+1", () => {
  const p = project();
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  const r = [
    record("landscape", "r/landscape.mp4", a, 48),
    record("landscape", "r/landscape.mp4", b, 72),
  ];
  p.renderRecords = r;
  const { project: next, delivery } = appendDelivery(p, {
    versionIds: [a, b],
    renderIds: r.map((x) => x.renderId),
    frameMap: [24, 36],
  });
  assert.equal(next.deliveries.length, 1);
  assert.equal(next.savedVersion, 4);
  assert.equal(delivery.versionIds.length, 2);
  assert.ok(delivery.deliveryId && delivery.at);
  // 入参不被改写（纯函数）
  assert.equal(p.deliveries.length, 0);
  assert.equal(p.savedVersion, 3);
});

test("appendDelivery 拒绝未知 renderId（防手改项目后脏引用）", () => {
  const p = project();
  assert.throws(
    () =>
      appendDelivery(p, {
        versionIds: [p.shots[0].contentVersions[0].versionId],
        renderIds: [randomUUID()],
        frameMap: [24],
      }),
    /renderIds|render record/i,
  );
});

// —— P3-A 交互 HTML 交付（Task 1）：可选元数据只按传入落键 ——
function landscapeArgs(p) {
  const [a, b] = p.shots.map((s) => s.contentVersions[0].versionId);
  const r = [
    record("landscape", "r/landscape.mp4", a, 48),
    record("landscape", "r/landscape.mp4", b, 72),
  ];
  p.renderRecords = r;
  return {
    versionIds: [a, b],
    renderIds: r.map((x) => x.renderId),
    frameMap: [24, 36],
  };
}

test("appendDelivery 传入交互 HTML 三项时记录含三键", () => {
  const p = project();
  const digest = "a".repeat(64);
  const { delivery } = appendDelivery(p, {
    ...landscapeArgs(p),
    kind: "interactive-html",
    outputRef: "index.html",
    digest,
  });
  assert.equal(delivery.kind, "interactive-html");
  assert.equal(delivery.outputRef, "index.html");
  assert.equal(delivery.digest, digest);
});

test("appendDelivery 未传可选键时保持原五键记录形状", () => {
  const p = project();
  const { delivery } = appendDelivery(p, landscapeArgs(p));
  assert.deepEqual(Object.keys(delivery), [
    "deliveryId",
    "at",
    "versionIds",
    "renderIds",
    "frameMap",
  ]);
});
