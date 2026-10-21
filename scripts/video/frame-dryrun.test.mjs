// P2-A 补齐：逐帧干跑门禁的单元测试。fixture 在注册表之外直构 render 函数，
// 分别覆盖正常路径、死循环超时路径（worker 必须在预算内被杀并点名镜头/帧）、
// 抛错路径（记录后继续，不整批中断）。
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProjectDryRunJobs, dryRunJobs } from "./frame-dryrun.mjs";

const FIXTURE_URL = pathToFileURL(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "frame-dryrun.fixtures.mjs",
  ),
).href;

test("干跑：正常快组件全帧通过", async () => {
  const result = await dryRunJobs([
    {
      label: "快镜头",
      frames: 5,
      moduleUrl: FIXTURE_URL,
      fn: "renderFast",
      args: {},
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("干跑：死循环帧在预算内被杀，点名镜头与帧号", async () => {
  const startedAt = Date.now();
  const result = await dryRunJobs(
    [
      {
        label: "卡死镜头",
        frames: 4,
        moduleUrl: FIXTURE_URL,
        fn: "renderHanging",
        args: { hangAtFrame: 2 },
      },
    ],
    { budgetMs: 150 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].label, "卡死镜头");
  assert.equal(result.failures[0].frame, 2);
  assert.match(result.failures[0].reason, /150ms/);
  // 预算 150ms：整批必须在远小于测试超时的时间内收口（含 worker 终止开销）
  assert.ok(Date.now() - startedAt < 10_000);
});

test("干跑：抛错帧记录异常并继续后续帧", async () => {
  const result = await dryRunJobs([
    {
      label: "抛错镜头",
      frames: 3,
      moduleUrl: FIXTURE_URL,
      fn: "renderThrowing",
      args: { throwAtFrame: 1 },
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].frame, 1);
  assert.match(result.failures[0].reason, /第 1 帧炸了/);
});

test("干跑：多镜头混批，正常镜头不受卡死镜头牵连地逐个报告", async () => {
  const result = await dryRunJobs(
    [
      {
        label: "好镜头",
        frames: 2,
        moduleUrl: FIXTURE_URL,
        fn: "renderFast",
        args: {},
      },
      {
        label: "坏镜头",
        frames: 2,
        moduleUrl: FIXTURE_URL,
        fn: "renderHanging",
        args: { hangAtFrame: 1 },
      },
    ],
    { budgetMs: 120 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].label, "坏镜头");
  assert.equal(result.failures[0].frame, 1);
});

// ── P2.5-T4（D1）：混编项目干跑装配 ───────────────────────────────────
// 帧图量化覆盖全部镜头（帧保真），spec 干跑作业只给 spec span；全媒体项目
// 空 jobs 合法（媒体渲染路径在 render-scene，无需 spec 干跑）。

function workingShot(shotId, versionId, durationMs, sceneSource) {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-19T00:00:00.000Z",
        durationMs,
        description: "",
        narrationText: "",
        sceneSource,
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

const SPEC = { type: "spec", spec: { componentId: "poster-title" } };
const MEDIA = {
  type: "media-clip",
  mediaAssetId: "a1",
  inMs: 0,
  outMs: 2000,
  fit: "cover",
  focalX: 0.5,
  audio: "mute",
};
const THREE = {
  type: "three",
  spec: {
    specVersion: 1,
    componentId: "orbit3d",
    componentVersion: 1,
    durationMs: 1000,
    seed: 20261021,
    background: "#101820",
    params: {},
  },
};

const dryProject = (shots) => ({
  schemaVersion: 1,
  id: "p1",
  title: "t",
  brief: { sentence: "s", aspectTargets: ["landscape"] },
  shots,
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

test("干跑装配：spec+media 混编——量化覆盖全部镜头（72 帧），作业只给 spec span", async () => {
  const { jobs, timeline } = await buildProjectDryRunJobs(
    dryProject([
      workingShot("s1", "v1", 1000, SPEC),
      workingShot("s2", "v2", 2000, MEDIA),
    ]),
  );
  assert.equal(timeline.totalFrames, 72, "1000ms+2000ms @24fps = 24+48");
  assert.equal(jobs.length, 1, "媒体镜头不出 spec 干跑作业");
  assert.equal(jobs[0].frames, 24);
  assert.match(jobs[0].label, /镜头 1/);
});

test("干跑装配：全媒体项目空 jobs 合法返回（不抛），未知 sceneSource 类型仍抛", async () => {
  const all = await buildProjectDryRunJobs(
    dryProject([workingShot("m1", "v1", 2000, MEDIA)]),
  );
  assert.deepEqual(all.jobs, []);
  assert.equal(all.timeline.totalFrames, 48);
  await assert.rejects(
    () =>
      buildProjectDryRunJobs(
        dryProject([workingShot("x1", "v1", 1000, { type: "未来类型" })]),
      ),
    /既非 spec、media-clip 也非 three/,
  );
});

// ── P3-B Task 4：three 镜头进干跑装配 ─────────────────────────────────
// 3D 镜头由烘焙门禁覆盖（Task 3），干跑不产生 SVG 作业也不抛错；帧图量化
// 仍覆盖全部镜头（帧保真——span 与出片一致）。

test("干跑：three 镜头不产生作业且不抛错", async () => {
  const { jobs, timeline } = await buildProjectDryRunJobs(
    dryProject([workingShot("t1", "v1", 1000, THREE)]),
  );
  assert.deepEqual(jobs, []);
  assert.equal(timeline.totalFrames, 24);
});

test("干跑：three 与 media-clip 混排时作业数只计 spec 镜头", async () => {
  const { jobs, timeline } = await buildProjectDryRunJobs(
    dryProject([
      workingShot("s1", "v1", 1000, SPEC),
      workingShot("t1", "v2", 500, THREE),
      workingShot("m1", "v3", 2000, MEDIA),
    ]),
  );
  assert.equal(timeline.totalFrames, 84, "24 + 12 + 48 帧全部占位");
  assert.equal(jobs.length, 1, "three 与 media 都不出 spec 干跑作业");
  assert.equal(jobs[0].frames, 24);
  assert.match(jobs[0].label, /镜头 1/);
});
