// P1-B：文档演进只允许追加。旧内容版本、事件、渲染与交付记录在新保存中
// 不可改写、不可删除；标题/brief 等元数据可改。保存前必须通过本校验。
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAppendOnlyEvolution,
  VideoProjectMutationError,
} from "./evolve.js";
import type { MediaAsset, VideoProject } from "./types.js";

const ID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4001";

function baseProject(): VideoProject {
  return {
    schemaVersion: 1,
    id: ID,
    title: "p0",
    savedVersion: 2,
    brief: {
      sentence: "做一个8秒的线描动画，标题是山水发布",
      aspectTargets: ["landscape"],
    },
    shots: [
      {
        shotId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4002",
        order: 0,
        locked: false,
        workingVersionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
        contentVersions: [
          {
            versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
            createdAt: "2026-10-17T00:00:00.000Z",
            durationMs: 8000,
            description: "线描",
            narrationText: "",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "line-drawing",
                componentVersion: 1,
                durationMs: 8000,
                seed: 7,
                background: "#ffffff",
                params: {},
              },
            },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [
          {
            kind: "submitted",
            versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
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

// 在 base 上追加：新内容版本 + submitted 事件 + workingVersionId 前移。
function appendedProject(): VideoProject {
  const next = structuredClone(baseProject());
  const shot = next.shots[0]!;
  shot.contentVersions.push({
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4004",
    createdAt: "2026-10-17T01:00:00.000Z",
    durationMs: 12000,
    description: "文字改版",
    narrationText: "",
    sceneSource: {
      type: "spec",
      spec: {
        specVersion: 1,
        componentId: "text-animation",
        componentVersion: 1,
        durationMs: 12000,
        seed: 8,
        background: "#ffffff",
        params: { title: "云制造" },
      },
    },
    provenance: {
      engineId: "planner-rules",
      engineVersion: "1",
      parentVersionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
    },
  });
  shot.events.push({
    kind: "submitted",
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4004",
    at: "2026-10-17T01:00:00.000Z",
    actor: "ai",
  });
  shot.workingVersionId = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4004";
  return next;
}

test("追加内容版本/事件 + 换 workingVersionId → 通过", () => {
  assert.doesNotThrow(() =>
    assertAppendOnlyEvolution(baseProject(), appendedProject()),
  );
});

test("元数据（标题/brief.sentence）可改 → 通过", () => {
  const next = appendedProject();
  next.title = "改名";
  next.brief.sentence = "做一个12秒的文字动画，标题是云制造";
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

test("savedVersion 差异不影响判定（版本号由调用方管理）", () => {
  const next = appendedProject();
  next.savedVersion = baseProject().savedVersion + 1;
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

test("项目 id 不同 → 拒绝", () => {
  const next = appendedProject();
  next.id = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4999";
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    VideoProjectMutationError,
  );
});

test("改写旧内容版本字段 → 拒绝", () => {
  const next = appendedProject();
  next.shots[0]!.contentVersions[0]!.description = "偷改旧版描述";
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /contentVersions.*改写|改写.*contentVersions|modified/,
  );
});

test("删除旧事件 → 拒绝", () => {
  const next = appendedProject();
  next.shots[0]!.events.shift();
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /events|事件/,
  );
});

test("删除旧内容版本 → 拒绝", () => {
  const next = structuredClone(baseProject());
  next.shots[0]!.contentVersions = [];
  next.shots[0]!.workingVersionId = "";
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /contentVersions/,
  );
});

test("丢失旧镜头 → 拒绝", () => {
  const next = appendedProject();
  next.shots = [];
  assert.throws(() => assertAppendOnlyEvolution(baseProject(), next), /shot/);
});

test("改写已有渲染记录 → 拒绝；追加渲染记录 → 通过", () => {
  const withRender = appendedProject();
  withRender.renderRecords.push({
    renderId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4005",
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
    contentDigest: "a".repeat(64),
    engineId: "remotion",
    engineVersion: "4",
    rendererVersion: "1",
    browser: "Chrome 155",
    codec: "h264",
    outputAssetRef: "render/landscape.mp4",
    fps: 24,
    width: 1280,
    height: 720,
    frames: 192,
    fontDigests: { "NotoSansSC-Regular.woff": "b".repeat(64) },
  });
  assert.doesNotThrow(() =>
    assertAppendOnlyEvolution(baseProject(), withRender),
  );

  const rewritten = structuredClone(withRender);
  rewritten.renderRecords[0]!.outputAssetRef = "render/tampered.mp4";
  assert.throws(
    () => assertAppendOnlyEvolution(withRender, rewritten),
    /renderRecords/,
  );

  const removed = structuredClone(withRender);
  removed.renderRecords.pop();
  assert.throws(
    () => assertAppendOnlyEvolution(withRender, removed),
    /renderRecords/,
  );
});

test("删除已有交付记录 → 拒绝；旧 delivery 的来源在追加编辑后仍可追溯", () => {
  const withDelivery = appendedProject();
  withDelivery.renderRecords.push({
    renderId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4005",
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003",
    contentDigest: "a".repeat(64),
    engineId: "remotion",
    engineVersion: "4",
    rendererVersion: "1",
    browser: "Chrome 155",
    codec: "h264",
    outputAssetRef: "render/landscape.mp4",
    fps: 24,
    width: 1280,
    height: 720,
    frames: 192,
    fontDigests: { "NotoSansSC-Regular.woff": "b".repeat(64) },
  });
  withDelivery.deliveries.push({
    deliveryId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4006",
    at: "2026-10-17T02:00:00.000Z",
    versionIds: ["0b0b13a2-6c63-4d3d-9a52-a70f6a3b4003"],
    renderIds: ["0b0b13a2-6c63-4d3d-9a52-a70f6a3b4005"],
    frameMap: [192],
  });
  assert.doesNotThrow(() =>
    assertAppendOnlyEvolution(baseProject(), withDelivery),
  );
  // 追加编辑（再落一个版本）后旧 delivery 引用仍可解析
  const evolved = structuredClone(withDelivery);
  evolved.shots[0]!.contentVersions.push({
    ...evolved.shots[0]!.contentVersions[0]!,
    versionId: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b4007",
    createdAt: "2026-10-17T03:00:00.000Z",
  });
  assert.doesNotThrow(() => assertAppendOnlyEvolution(withDelivery, evolved));
  const allVersionIds = new Set(
    evolved.shots.flatMap((shot) =>
      shot.contentVersions.map((version) => version.versionId),
    ),
  );
  for (const versionId of evolved.deliveries[0]!.versionIds) {
    assert.ok(allVersionIds.has(versionId), "delivery 来源版本仍存在");
  }

  const removedDelivery = structuredClone(withDelivery);
  removedDelivery.deliveries.pop();
  assert.throws(
    () => assertAppendOnlyEvolution(withDelivery, removedDelivery),
    /deliveries/,
  );
});

// Codex 复核反馈（P0 整改补充）：locked 是审计字段——每次变化必须留下
// lock-changed(human) 事件（operations.setLocked 的契约）。绕过 setLocked
// 直改 locked 曾被演进检查接受，审计链有洞；且旧前缀里的同值历史事件
// 不能为本次翻转背书，只认本次追加段。
test("locked 翻转但未追加 lock-changed 事件 → 拒绝（绕过 setLocked 的直改）", () => {
  const next = appendedProject();
  next.shots[0]!.locked = true;
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /lock-changed|locked/,
    "锁定状态变化必须留审计事件",
  );
});

test("locked 翻转且本次追加段有匹配的 lock-changed 事件 → 通过（setLocked 路径）", () => {
  const next = appendedProject();
  const shot = next.shots[0]!;
  shot.locked = true;
  shot.events.push({
    kind: "lock-changed",
    locked: true,
    at: "2026-10-17T04:00:00.000Z",
    actor: "human",
  });
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

test("locked 翻转但事件的 locked 与新状态不符 → 拒绝", () => {
  const next = appendedProject();
  const shot = next.shots[0]!;
  shot.locked = true;
  shot.events.push({
    kind: "lock-changed",
    locked: false, // 事件值对不上新状态
    at: "2026-10-17T04:00:00.000Z",
    actor: "human",
  });
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /lock-changed|locked/,
  );
});

test("旧前缀里的同值 lock-changed 事件不能为本次翻转背书 → 拒绝", () => {
  // 历史上锁过又解锁（前缀有 locked:false 事件），本次再直改回 false：
  // 背书必须来自本次追加段，不能翻旧账
  const history = appendedProject();
  const historyShot = history.shots[0]!;
  historyShot.locked = true;
  historyShot.events.push({
    kind: "lock-changed",
    locked: true,
    at: "2026-10-17T04:00:00.000Z",
    actor: "human",
  });
  historyShot.locked = false;
  historyShot.events.push({
    kind: "lock-changed",
    locked: false,
    at: "2026-10-17T05:00:00.000Z",
    actor: "human",
  });

  const next = structuredClone(history);
  next.shots[0]!.locked = true; // 直改，不追加事件
  assert.throws(
    () => assertAppendOnlyEvolution(history, next),
    /lock-changed|locked/,
  );
});

test("locked 未变时追加 lock-changed 事件 → 不禁止（无害的冗余留痕）", () => {
  const next = appendedProject();
  next.shots[0]!.events.push({
    kind: "lock-changed",
    locked: false, // 与旧状态一致，状态没翻
    at: "2026-10-17T04:00:00.000Z",
    actor: "human",
  });
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

// 末条裁定（2026-10-18 Codex 复核反馈）：背书不是「追加段里出现过匹配值」，
// 而是「追加段最后一条 lock-changed 所说的值 = 最终 locked」。构造
// [锁定 true，解锁 false] 而终态 true 曾被接受——事件链末条与终态矛盾。
test("追加段先锁后解、终态却为锁 → 拒绝（末条事件与终态矛盾）", () => {
  const next = appendedProject();
  const shot = next.shots[0]!;
  shot.locked = true;
  shot.events.push(
    {
      kind: "lock-changed",
      locked: true,
      at: "2026-10-17T04:00:00.000Z",
      actor: "human",
    },
    {
      kind: "lock-changed",
      locked: false,
      at: "2026-10-17T05:00:00.000Z",
      actor: "human",
    },
  );
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /lock-changed|locked/,
    "末条 lock-changed 裁定最终状态，不能翻回去",
  );
});

test("追加段先锁后解、终态为解 → 通过（同帧两次 setLocked 的合法轨迹）", () => {
  const next = appendedProject();
  const shot = next.shots[0]!;
  shot.locked = false;
  shot.events.push(
    {
      kind: "lock-changed",
      locked: true,
      at: "2026-10-17T04:00:00.000Z",
      actor: "human",
    },
    {
      kind: "lock-changed",
      locked: false,
      at: "2026-10-17T05:00:00.000Z",
      actor: "human",
    },
  );
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

test("locked 未变但追加段末条 lock-changed 与终态矛盾 → 拒绝", () => {
  const next = appendedProject();
  next.shots[0]!.events.push({
    kind: "lock-changed",
    locked: true, // 事件说锁了，终态却仍是 false
    at: "2026-10-17T04:00:00.000Z",
    actor: "human",
  });
  assert.throws(
    () => assertAppendOnlyEvolution(baseProject(), next),
    /lock-changed|locked/,
    "审计链末条必须与终态一致，无论状态是否翻转",
  );
});

// —— brief.applications 只追加（2026-10-18 Codex 复核反馈第三轮）——
// 应用快照是逐次审计记录：下一版本不得删除/改写已保存的条目
// （与 shots/events/renderRecords 同一只追加纪律；此前无记录则不受约束）。
function applicationEntry(sentence: string, appliedAt: string) {
  return {
    sentence,
    appendedShotCount: 4,
    appendedDurationMs: 30000,
    filmShotCountAfter: 4,
    filmTotalMsAfter: 30000,
    appliedAt,
  };
}

test("brief.applications 已存条目被删除 → 拒绝", () => {
  const history = appendedProject();
  history.brief.applications = [
    applicationEntry(
      "做一个30秒的STEM解说视频，主题是勾股定理",
      "2026-10-18T00:00:00.000Z",
    ),
    applicationEntry(
      "做一个10秒的STEM解说视频，主题是二次方程",
      "2026-10-18T01:00:00.000Z",
    ),
  ];
  const next = structuredClone(history);
  next.brief.applications = next.brief.applications!.slice(0, 1); // 删掉第二条
  assert.throws(
    () => assertAppendOnlyEvolution(history, next),
    /applications/,
    "应用快照只允许追加",
  );
});

test("brief.applications 整体被抹掉 → 拒绝", () => {
  const history = appendedProject();
  history.brief.applications = [
    applicationEntry(
      "做一个30秒的STEM解说视频，主题是勾股定理",
      "2026-10-18T00:00:00.000Z",
    ),
  ];
  const next = structuredClone(history);
  delete next.brief.applications;
  assert.throws(
    () => assertAppendOnlyEvolution(history, next),
    /applications/,
    "已保存的应用记录不能凭空消失",
  );
});

test("brief.applications 旧条目被改写 → 拒绝", () => {
  const history = appendedProject();
  history.brief.applications = [
    applicationEntry(
      "做一个30秒的STEM解说视频，主题是勾股定理",
      "2026-10-18T00:00:00.000Z",
    ),
  ];
  const next = structuredClone(history);
  next.brief.applications![0]!.filmTotalMsAfter = 999999; // 篡改对账值
  assert.throws(
    () => assertAppendOnlyEvolution(history, next),
    /applications\[0\]/,
    "旧快照逐字段原样",
  );
});

test("brief.applications 追加新条目、旧条目原样 → 通过", () => {
  const history = appendedProject();
  history.brief.applications = [
    applicationEntry(
      "做一个30秒的STEM解说视频，主题是勾股定理",
      "2026-10-18T00:00:00.000Z",
    ),
  ];
  const next = structuredClone(history);
  next.brief.applications = [
    ...next.brief.applications!,
    applicationEntry(
      "做一个10秒的STEM解说视频，主题是二次方程",
      "2026-10-18T02:00:00.000Z",
    ),
  ];
  assert.doesNotThrow(() => assertAppendOnlyEvolution(history, next));
});

test("双方都无 brief.applications → 不受约束（单镜头项目路径）", () => {
  const next = appendedProject();
  next.brief.sentence = "改一句需求";
  assert.doesNotThrow(() => assertAppendOnlyEvolution(baseProject(), next));
});

// —— mediaAssets 素材账本只追加（2026-10-19 P2.5-T1 终评 I1）——
// 与 renderRecords 同纪律（types.ts 注释即此承诺）：assetId 只增不减，
// 既有条目的 origin/createdAt/original 逐字段不可变（original 是 ffprobe
// 实测落账的内容寻址根基，原地偷换 sha256/storeKey 必须被闸门拦截）；
// proxy 声明为「可再生成」，允许增改（豁免项）。
function mediaAssetEntry(assetId: string, sha256: string): MediaAsset {
  return {
    assetId,
    createdAt: "2026-10-19T00:00:00.000Z",
    origin: { kind: "local-upload", fileName: "site-dji.mp4" },
    original: {
      sha256,
      bytes: 123456,
      durationMs: 5400,
      width: 1920,
      height: 1080,
      fps: 29.97,
      codec: "h264",
      hasAudio: true,
      storeKey: `${sha256.slice(0, 16)}.mp4`,
    },
  };
}

const ASSET_A = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2010";
const ASSET_B = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b2011";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function projectWithMediaAssets(): VideoProject {
  const project = appendedProject();
  project.mediaAssets = [mediaAssetEntry(ASSET_A, SHA_A)];
  return project;
}

test("mediaAssets 既有条目的 original 被改写 → 拒绝（内容寻址不得原地偷换）", () => {
  const next = structuredClone(projectWithMediaAssets());
  next.mediaAssets![0]!.original.bytes = 999; // 形状仍合法，validate 拦不住
  assert.throws(
    () => assertAppendOnlyEvolution(projectWithMediaAssets(), next),
    /mediaAssets.*original|original/,
    "original 落账后不可变",
  );
});

test("mediaAssets 未被引用的条目被删除 → 拒绝（账本只增不减）", () => {
  const next = structuredClone(projectWithMediaAssets());
  next.mediaAssets = []; // 即便无镜头引用也不许删
  assert.throws(
    () => assertAppendOnlyEvolution(projectWithMediaAssets(), next),
    /mediaAssets/,
    "素材账本只允许追加",
  );
});

test("mediaAssets assetId 被改写或重排 → 拒绝", () => {
  const next = structuredClone(projectWithMediaAssets());
  next.mediaAssets![0]!.assetId = ASSET_B;
  assert.throws(
    () => assertAppendOnlyEvolution(projectWithMediaAssets(), next),
    /mediaAssets/,
    "旧素材条目必须原样保留",
  );
});

test("mediaAssets 既有条目增改 proxy（可再生成字段豁免）→ 通过", () => {
  const withProxy = structuredClone(projectWithMediaAssets());
  withProxy.mediaAssets![0]!.proxy = {
    sha256: SHA_B,
    bytes: 45678,
    width: 1280,
    height: 720,
    note: "h264 crf23 1280x720",
  };
  assert.doesNotThrow(() =>
    assertAppendOnlyEvolution(projectWithMediaAssets(), withProxy),
  );

  // 已有 proxy 的再生成（改写豁免字段）同样合法
  const regenerated = structuredClone(withProxy);
  regenerated.mediaAssets![0]!.proxy = {
    sha256: "c".repeat(64),
    bytes: 40000,
    width: 960,
    height: 540,
    note: "h264 crf26 960x540 重生成",
  };
  assert.doesNotThrow(() => assertAppendOnlyEvolution(withProxy, regenerated));
});

test("mediaAssets 追加新素材条目、旧条目原样 → 通过", () => {
  const next = structuredClone(projectWithMediaAssets());
  next.mediaAssets!.push(mediaAssetEntry(ASSET_B, SHA_B));
  assert.doesNotThrow(() =>
    assertAppendOnlyEvolution(projectWithMediaAssets(), next),
  );
});
