import assert from "node:assert/strict";
import test from "node:test";
import {
  addCandidateVersion,
  reviseWorkingVersion,
  rollbackWorkingVersion,
  ShotLockedError,
  setLocked,
} from "./operations.js";
import type { VideoProject } from "./types.js";

const UUID = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1001";
const UUID2 = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1002";
const DELIVERY = "0b0b13a2-6c63-4d3d-9a52-a70f6a3b1003";
const at = "2026-10-17T00:00:00.000Z";

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
            createdAt: at,
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
        events: [{ kind: "submitted", versionId, at, actor: "human" }],
      },
    ],
    renderRecords: [],
    deliveries: [],
  };
}

test("锁定镜头拒绝 AI 重生成", () => {
  const p = setLocked(baseProject(), baseProject().shots[0]!.shotId, true, at);
  const v2 = { ...p.shots[0]!.contentVersions[0]!, versionId: UUID2 };
  assert.throws(
    () => addCandidateVersion(p, p.shots[0]!.shotId, v2, at),
    ShotLockedError,
  );
});

test("回滚 working 版本保留历史且旧 delivery 不变", () => {
  let p = baseProject();
  const v2 = { ...p.shots[0]!.contentVersions[0]!, versionId: UUID2 };
  p = addCandidateVersion(p, p.shots[0]!.shotId, v2, at);
  p = {
    ...p,
    deliveries: [
      {
        deliveryId: DELIVERY,
        at,
        versionIds: [p.shots[0]!.contentVersions[0]!.versionId],
        renderIds: [],
        frameMap: [288],
      },
    ],
  };
  const rolled = rollbackWorkingVersion(
    p,
    p.shots[0]!.shotId,
    p.shots[0]!.contentVersions[0]!.versionId,
    at,
  );
  assert.equal(
    rolled.shots[0]!.workingVersionId,
    rolled.shots[0]!.contentVersions[0]!.versionId,
  );
  assert.equal(rolled.deliveries.length, 1);
  assert.equal(rolled.shots[0]!.contentVersions.length, 2); // 历史不丢
});

// —— 分镜编辑器：人工修订路径（ADR 0003 §1.3）——

const T0 = "2026-10-18T00:00:00.000Z";
const T = "2026-10-18T01:00:00.000Z";

// baseProject 的版本 narrationText 为空串；这里给一个非空初值便于断言继承/覆盖。
function editableProject(): VideoProject {
  const p = baseProject();
  const shot = p.shots[0]!;
  return {
    ...p,
    shots: [
      {
        ...shot,
        contentVersions: [
          { ...shot.contentVersions[0]!, narrationText: "旧旁白。" },
        ],
      },
    ],
  };
}

test("reviseWorkingVersion 追加 human 版本并前移指针", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "新旁白。" },
    UUID2,
    T,
  );
  const shot = next.shots[0]!;
  assert.equal(shot.contentVersions.length, 2);
  assert.equal(shot.workingVersionId, UUID2);
  const v2 = shot.contentVersions[1]!;
  assert.equal(v2.narrationText, "新旁白。");
  assert.equal(v2.durationMs, shot.contentVersions[0]!.durationMs); // 未 patch spec → 继承
  assert.equal(v2.provenance.engineId, "human-edit");
  assert.equal(v2.provenance.parentVersionId, UUID);
  assert.deepEqual(shot.events.at(-1), {
    kind: "submitted",
    versionId: UUID2,
    at: T,
    actor: "human",
  });
  assert.ok(v2.description.includes("人工修订"));
  assert.ok(v2.description.length <= 200);
  // 入参不动
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion 锁定镜头允许且追加 audit 事件", () => {
  const p = setLocked(
    editableProject(),
    editableProject().shots[0]!.shotId,
    true,
    T0,
  );
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "锁定下改。" },
    UUID2,
    T,
  );
  const events = next.shots[0]!.events;
  assert.deepEqual(events.at(-2), {
    kind: "submitted",
    versionId: UUID2,
    at: T,
    actor: "human",
  });
  assert.deepEqual(events.at(-1), {
    kind: "audit",
    note: "人工修订（锁定镜头）",
    at: T,
    actor: "human",
  });
});

test("reviseWorkingVersion spec patch 同步 durationMs 与 sceneSource", () => {
  const p = editableProject();
  const spec = {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: "1",
    durationMs: 3000,
    seed: 1,
    background: "#ffffff",
    params: {},
  };
  const next = reviseWorkingVersion(p, p.shots[0]!.shotId, { spec }, UUID2, T);
  const v2 = next.shots[0]!.contentVersions[1]!;
  assert.equal(v2.durationMs, 3000);
  assert.deepEqual(v2.sceneSource, { type: "spec", spec });
  // 未给 narrationText → 继承 working 版本
  assert.equal(v2.narrationText, "旧旁白。");
});

test("reviseWorkingVersion 未知镜头抛错且入参不变", () => {
  const p = editableProject();
  assert.throws(
    () =>
      reviseWorkingVersion(p, "no-such-shot", { narrationText: "x" }, UUID2, T),
    /不存在/,
  );
  assert.equal(p.shots[0]!.contentVersions.length, 1);
});

test("reviseWorkingVersion 空旁白合法", () => {
  const p = editableProject();
  const next = reviseWorkingVersion(
    p,
    p.shots[0]!.shotId,
    { narrationText: "" },
    UUID2,
    T,
  );
  assert.equal(next.shots[0]!.contentVersions[1]!.narrationText, "");
});
