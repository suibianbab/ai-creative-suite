import assert from "node:assert/strict";
import test from "node:test";
import {
  addCandidateVersion,
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
