// P2-A 补齐：逐帧干跑门禁的单元测试。fixture 在注册表之外直构 render 函数，
// 分别覆盖正常路径、死循环超时路径（worker 必须在预算内被杀并点名镜头/帧）、
// 抛错路径（记录后继续，不整批中断）。
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dryRunJobs } from "./frame-dryrun.mjs";

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
