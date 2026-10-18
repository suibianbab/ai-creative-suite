import assert from "node:assert/strict";
import test from "node:test";
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
