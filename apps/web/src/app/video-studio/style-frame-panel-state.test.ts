import assert from "node:assert/strict";
import test from "node:test";
import type { StyleFrameConfirmation, VideoProject } from "@acs/video-document";
import { reviseWorkingVersion } from "@acs/video-document";
import {
  confirmationBlockSignature,
  describeConfirmationStatus,
} from "./style-frame-panel-state";

const AT = "2026-10-24T00:00:00.000Z";
const ID = "11111111-1111-4111-8111-111111111111";

function sample(): VideoProject {
  const shotId = "44444444-4444-4444-8444-444444444444";
  return {
    schemaVersion: 1,
    id: ID,
    title: "panel state",
    savedVersion: 1,
    brief: { sentence: "one", aspectTargets: ["landscape"] },
    shots: [
      {
        shotId,
        order: 0,
        locked: false,
        workingVersionId: shotId,
        contentVersions: [
          {
            versionId: shotId,
            createdAt: AT,
            durationMs: 1000,
            description: "d",
            narrationText: "",
            sceneSource: {
              type: "spec",
              spec: {
                specVersion: 1,
                componentId: "text-animation",
                componentVersion: 1,
                durationMs: 1000,
                seed: 1,
                background: "#101820",
                params: {
                  title: "t",
                  titleColor: "#f3e6cf",
                  subtitleColor: "#e8b04b",
                  entrance: "fade-up",
                  enterMs: 400,
                },
              },
            },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [],
      },
    ],
    renderRecords: [],
    deliveries: [],
    styleBibleRef: {
      bibleId: ID,
      versionId: "22222222-2222-4222-8222-222222222222",
      digest: "0".repeat(64),
    },
  };
}

test("confirmationBlockSignature 覆盖风格引用、工作版本与转场", () => {
  const project = sample();
  const base = confirmationBlockSignature(project);
  assert.equal(base, confirmationBlockSignature(project));
  // 工作版本变化 → 签名变化
  const baseSource = sample().shots[0]!.contentVersions[0]!.sceneSource as {
    type: "spec";
    spec: Record<string, unknown>;
  };
  const edited = reviseWorkingVersion(
    project,
    project.shots[0]!.shotId,
    { spec: { ...baseSource.spec, seed: 9 } },
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    AT,
  );
  assert.notEqual(confirmationBlockSignature(edited), base);
  // 风格引用变化 → 签名变化
  const restyled = {
    ...project,
    styleBibleRef: { ...project.styleBibleRef!, digest: "1".repeat(64) },
  };
  assert.notEqual(confirmationBlockSignature(restyled), base);
  // 转场变化 → 签名变化
  const faded = {
    ...project,
    transitions: [{ boundary: 0, kind: "fade" as const, durationMs: 200 }],
  };
  assert.notEqual(confirmationBlockSignature(faded), base);
  // 标题等元数据变化 → 签名不变（不影响已出关键帧的画面）
  assert.equal(confirmationBlockSignature({ ...project, title: "改名" }), base);
});

test("describeConfirmationStatus 给出可读的有效/失效文案", () => {
  const confirmation = {
    confirmedAt: AT,
    frameIndex: 12,
  } as unknown as StyleFrameConfirmation;
  assert.match(
    describeConfirmationStatus({ valid: true, confirmation }),
    /有效|已确认/,
  );
  assert.match(
    describeConfirmationStatus({
      valid: false,
      reason: "项目内容（镜头工作版本或转场）已变更…",
      confirmation,
    }),
    /已变更/,
  );
  assert.match(
    describeConfirmationStatus({
      valid: false,
      reason: "尚无风格代表帧确认…",
      confirmation: null,
    }),
    /尚无/,
  );
});
