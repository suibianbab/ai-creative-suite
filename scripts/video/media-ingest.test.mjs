// P2.5-T2 CLI：真实文件成功（stdout JSON 过 validateVideoProject）与失败
// （exit ≠0、stderr 中文、仓零残留）。夹具 ffmpeg 生成，仓/临时均用 tmp。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CLI = path.join(ROOT, "scripts/video/media-ingest.mjs");
const WORK = mkdtempSync(path.join(tmpdir(), "acs-cli-test-"));
const STORE = mkdtempSync(path.join(tmpdir(), "acs-cli-store-"));

function makeVideo(name) {
  const file = path.join(WORK, name);
  const spawned = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=640x360:rate=24",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  return file;
}

test("成功：stdout 打印契约合法的 MediaAsset JSON", async () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", makeVideo("ok.mp4"), "--store", STORE],
    {
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const asset = JSON.parse(run.stdout);
  const { validateVideoProject } = await import(
    pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
  );
  const document = {
    schemaVersion: 1,
    id: "0b0b13a2-6c63-4d3d-9a52-a70f6a3b3001",
    title: "媒体导入 CLI 测试",
    brief: { sentence: "导入一段实拍", aspectTargets: ["landscape"] },
    shots: [],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    mediaAssets: [asset],
  };
  validateVideoProject(document); // 契约级联校验：资产形状合法即不抛
  assert.equal(asset.origin.kind, "local-upload");
});

test("失败：文本改名 .mp4 → exit 1、stderr 中文、仓零残留", () => {
  const failStore = mkdtempSync(path.join(tmpdir(), "acs-cli-failstore-"));
  const fake = path.join(WORK, "fake.mp4");
  writeFileSync(fake, "不是视频");
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", fake, "--store", failStore],
    {
      encoding: "utf8",
    },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /文件无法探测|不含视频流|无法完整解码/);
  assert.ok(!readdirSync(failStore).some((entry) => entry === "original"));
});

test("--store 相对路径 → 用法错误 exit 2", () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", makeVideo("x.mp4"), "--store", "relative"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2);
});

test("F6：--file 不存在 → exit 1 + stderr 中文（不得英文堆栈炸出）", () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", path.join(WORK, "nope.mp4"), "--store", STORE],
    {
      encoding: "utf8",
    },
  );
  assert.equal(
    run.status,
    1,
    `exit 须为 1，实际 ${run.status}；stderr：${run.stderr}`,
  );
  assert.match(run.stderr, /无法读取文件/);
  assert.ok(!/ENOENT/.test(run.stderr), "不得裸抛英文堆栈");
});

test("F6：env 相对 ACS_MEDIA_STORE → exit 1 + stderr 中文", () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--file", makeVideo("env.mp4")],
    {
      encoding: "utf8",
      env: { ...process.env, ACS_MEDIA_STORE: "relative/store" },
    },
  );
  assert.equal(
    run.status,
    1,
    `exit 须为 1，实际 ${run.status}；stderr：${run.stderr}`,
  );
  assert.match(run.stderr, /ACS_MEDIA_STORE 须为绝对路径/);
  assert.ok(!/ENOENT|\n    at /.test(run.stderr), "不得裸抛英文堆栈");
});
