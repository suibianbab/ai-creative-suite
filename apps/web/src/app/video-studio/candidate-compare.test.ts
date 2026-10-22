// 候选对比的纯逻辑：候选就是既有内容版本，状态由事件推导；默认对给
// 「工作版本 + 最新非工作版本」，两列下拉互相排除。夹具按文档不变量构造。
import assert from "node:assert/strict";
import test from "node:test";
import type { Shot, VideoProject } from "@acs/video-document";
import {
  candidateChoices,
  candidateSummaries,
  defaultCandidatePair,
  statusLabel,
} from "./candidate-compare.js";
import {
  describeDurationImpact,
  durationApplyError,
} from "./duration-impact.js";

const AT = "2026-10-22T00:00:00.000Z";

// 一个镜头 + 若干内容版本：每个版本都 submitted(human)，工作版本 = 最后一个。
function shotWithVersions(durations: number[]): Shot {
  const contentVersions = durations.map((durationMs, index) => ({
    versionId: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: AT,
    durationMs,
    description: `候选 ${index + 1}`,
    narrationText: "",
    sceneSource: {
      type: "spec" as const,
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
  }));
  return {
    shotId: "bbbbbbbb-0000-4000-8000-000000000001",
    order: 0,
    locked: false,
    workingVersionId: contentVersions[contentVersions.length - 1]!.versionId,
    contentVersions,
    events: contentVersions.map((version) => ({
      kind: "submitted" as const,
      versionId: version.versionId,
      at: AT,
      actor: "human" as const,
    })),
  };
}

function projectWith(durations: number[]): VideoProject {
  return {
    schemaVersion: 1,
    id: "cccccccc-1111-4111-8111-111111111111",
    title: "候选对比测试",
    brief: { sentence: "", aspectTargets: [] },
    shots: durations.map((durationMs, index) => ({
      ...shotWithVersions([durationMs]),
      shotId: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`,
      order: index,
    })),
    renderRecords: [],
    deliveries: [],
    savedVersion: 0,
  };
}

test("摘要：序号 1 起、状态由事件推导、工作版本标 isWorking", () => {
  const shot = shotWithVersions([2000, 6000]);
  const summaries = candidateSummaries(shot);
  assert.deepEqual(
    summaries.map((s) => [s.index, s.status, s.isWorking, s.durationMs]),
    [
      [1, "candidate", false, 2000],
      [2, "candidate", true, 6000],
    ],
  );
  // 说明原样带出，供两列对比。
  assert.deepEqual(
    summaries.map((s) => s.description),
    ["候选 1", "候选 2"],
  );
});

test("默认对：左=工作版本，右=最后一个非工作版本", () => {
  const shot = shotWithVersions([2000, 6000, 4000]);
  const pair = defaultCandidatePair(shot);
  assert.equal(pair?.leftId, shot.contentVersions[2]!.versionId);
  assert.equal(pair?.rightId, shot.contentVersions[1]!.versionId);
});

test("默认对：只有一个版本返回 null", () => {
  assert.equal(defaultCandidatePair(shotWithVersions([2000])), null);
});

test("可选项排除另一列当前版本", () => {
  const summaries = candidateSummaries(shotWithVersions([2000, 6000, 4000]));
  const right = summaries[1]!;
  const choices = candidateChoices(summaries, right.versionId);
  assert.deepEqual(
    choices.map((s) => s.versionId),
    [summaries[0]!.versionId, summaries[2]!.versionId],
  );
  assert.equal(candidateChoices(summaries, null).length, 3);
});

test("状态文案", () => {
  assert.equal(statusLabel("draft"), "草稿");
  assert.equal(statusLabel("candidate"), "候选");
  assert.equal(statusLabel("approved"), "已批准");
});

test("与 C 闸门组合：选用的候选新造零帧时被拦", () => {
  const project = projectWith([1000, 40]);
  const impact = describeDurationImpact(project, 0, 1);
  assert.match(durationApplyError(impact) ?? "", /^无法应用：/);
});
