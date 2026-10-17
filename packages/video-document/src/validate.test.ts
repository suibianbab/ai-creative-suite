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
