// 改时长的影响提示：当场量化整片帧数，并检查相邻转场借帧是否仍装得下。
// 夹具按文档不变量构造完整 VideoProject（每镜头一个 working 版本）。
import assert from "node:assert/strict";
import test from "node:test";
import type { Shot, ShotTransition, VideoProject } from "@acs/video-document";
import { describeDurationImpact } from "./duration-impact.js";

function shotWith(durationMs: number, index: number): Shot {
  const versionId = `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    shotId: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`,
    order: index,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-21T00:00:00.000Z",
        durationMs,
        description: `镜头 ${index + 1}`,
        narrationText: "",
        sceneSource: {
          type: "spec",
          spec: {
            specVersion: 1,
            componentId: "line-drawing",
            componentVersion: 1,
            durationMs,
            seed: 1,
            background: "#ffffff",
            params: {},
          },
        },
        provenance: { engineId: "test", engineVersion: "1.0.0" },
      },
    ],
    events: [],
  };
}

function projectWith(
  durations: number[],
  transitions?: ShotTransition[],
): VideoProject {
  return {
    schemaVersion: 1,
    id: "cccccccc-1111-4111-8111-111111111111",
    title: "帧数影响测试",
    brief: { sentence: "", aspectTargets: [] },
    shots: durations.map(shotWith),
    renderRecords: [],
    deliveries: [],
    savedVersion: 0,
    ...(transitions ? { transitions } : {}),
  };
}

test("未改时长：changed=false 且前后帧数一致", () => {
  const project = projectWith([8000, 8000, 8000, 6000]);
  const impact = describeDurationImpact(project, 1, 8000);
  assert.equal(impact.changed, false);
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 720);
  assert.equal(impact.transitionIssue, null);
});

test("加长 1s：整片帧数按累计边界量化", () => {
  const impact = describeDurationImpact(
    projectWith([8000, 8000, 8000, 6000]),
    0,
    9000,
  );
  assert.equal(impact.beforeFrames, 720);
  assert.equal(impact.afterFrames, 744); // 31s @24fps
});

test("缩到零帧：frameError 指名镜头，afterFrames 为 null", () => {
  const impact = describeDurationImpact(
    projectWith([8000, 8000, 8000, 6000]),
    0,
    1,
  );
  assert.equal(impact.afterFrames, null);
  assert.match(impact.frameError ?? "", /第 1 个镜头.*为零帧/);
});

test("相邻转场借帧失效：给出可操作提示", () => {
  const project = projectWith(
    [1000, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 1000 }],
  );
  const impact = describeDurationImpact(project, 0, 100);
  assert.match(impact.transitionIssue ?? "", /超出相邻 span/);
  assert.equal(impact.frameError, null);
});

test("无转场：不报转场问题", () => {
  const impact = describeDurationImpact(projectWith([1000, 1000]), 0, 100);
  assert.equal(impact.transitionIssue, null);
});

test("非相邻镜头变化：不误报远处转场", () => {
  const project = projectWith(
    [1000, 1000, 1000],
    [{ boundary: 0, kind: "fade", durationMs: 1000 }],
  );
  const impact = describeDurationImpact(project, 2, 100);
  assert.equal(impact.transitionIssue, null);
});
