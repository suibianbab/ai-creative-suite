// P1-B：文档演进只允许追加。旧内容版本、事件、渲染与交付记录在新保存中
// 不可改写、不可删除；标题/brief 等元数据可改。保存前必须通过本校验。
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAppendOnlyEvolution,
  VideoProjectMutationError,
} from "./evolve.js";
import type { VideoProject } from "./types.js";

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
