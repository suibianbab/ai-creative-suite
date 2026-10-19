// P2.5-T2 导入管线：happy path、S1 扩展名门、P6 时长越界（注入探针）、
// D1 残片解码门、W2 转码失败回滚分寸（新写删/预存不动）、幂等复用。
// 真实 ffmpeg 夹具 + 注入假依赖两轨。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { MediaAsset } from "@acs/video-document";
import { ingestMediaFile } from "./ingest.js";
import { type ProbeOutcome, runProbe } from "./probe.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-ingest-test-"));
const FIXTURE_BYTES_CACHE = new Map<string, Buffer>();

function makeTestVideo(name: string, size = "640x360"): Buffer {
  const cached = FIXTURE_BYTES_CACHE.get(name);
  if (cached) return cached;
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
      `testsrc=duration=2:size=${size}:rate=24`,
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(spawned.status, 0, spawned.stderr);
  const bytes = readFileSync(file);
  FIXTURE_BYTES_CACHE.set(name, bytes);
  return bytes;
}

function storeRoot(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `acs-ingest-store-${name}-`));
}

function result0Sha(bytes: Buffer): string {
  // 与实现同算法的 sha256，供测试推导 storeKey
  return createHash("sha256").update(bytes).digest("hex");
}

const FIXED_NOW = "2026-10-19T12:00:00.000Z";

test("happy path：640x360 h264（无需代理）→ 契约合法 MediaAsset，文件落仓", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("happy");
  const result = await ingestMediaFile({
    bytes,
    fileName: "小片.mp4",
    root,
    now: () => FIXED_NOW,
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const asset: MediaAsset = result.asset;
  assert.match(asset.assetId, /^[0-9a-f-]{36}$/);
  assert.equal(asset.createdAt, FIXED_NOW);
  assert.deepEqual(asset.origin, {
    kind: "local-upload",
    fileName: "小片.mp4",
  });
  assert.equal(asset.original.durationMs, 2000);
  assert.equal(asset.original.width, 640);
  assert.equal(asset.original.height, 360);
  assert.equal(asset.original.fps, 24);
  assert.equal(asset.original.codec, "h264");
  assert.equal(asset.original.hasAudio, false);
  assert.equal(asset.original.bytes, bytes.byteLength);
  assert.equal(
    asset.original.storeKey,
    `${asset.original.sha256.slice(0, 16)}.mp4`,
  );
  assert.equal(asset.proxy, undefined);
  const stored = path.join(root, "original", asset.original.storeKey);
  assert.ok(existsSync(stored));
  assert.equal(readFileSync(stored).byteLength, bytes.byteLength);
  // spec §4.6：仓文件 sha256 复核一致
  assert.equal(
    createHash("sha256").update(readFileSync(stored)).digest("hex"),
    asset.original.sha256,
  );
});

test("happy path + 代理：1920x1080 → asset.proxy 存在且产物过核验", async () => {
  const bytes = makeTestVideo("big.mp4", "1920x1080");
  const root = storeRoot("proxy");
  const result = await ingestMediaFile({
    bytes,
    fileName: "big.mp4",
    root,
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.ok(result.asset.proxy);
  assert.equal(result.asset.proxy.width, 1280);
  assert.equal(result.asset.proxy.height, 720);
  assert.match(result.asset.proxy.note, /ffmpeg/i);
  assert.ok(
    existsSync(
      path.join(
        root,
        "proxy",
        `${result.asset.original.storeKey.slice(0, 16)}.proxy.mp4`,
      ),
    ),
  );
});

test("S1：扩展名不支持/无扩展名拒绝；.MP4 大写归一放行", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("s1");
  for (const bad of ["clip.gif", "clip", "clip.avi"]) {
    const result = await ingestMediaFile({ bytes, fileName: bad, root });
    assert.ok(!result.ok);
    assert.match(result.error, /不支持的媒体格式/);
    assert.equal(result.reasonCode, "unsupported-format");
  }
  const upper = await ingestMediaFile({ bytes, fileName: "CLIP.MP4", root });
  assert.ok(upper.ok, upper.ok ? "" : upper.error);
  assert.deepEqual(readdirSync(path.join(root, "original")).length, 1);
});

test("P6：时长越界（注入假探针 199ms / 600001ms）→ 拒且临时目录零残留", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("p6");
  const tempDir = mkdtempSync(path.join(tmpdir(), "acs-ingest-tempdir-"));
  for (const durationMs of [199, 600001]) {
    const fakeProbe = (): ProbeOutcome => ({
      ok: true,
      probe: {
        durationMs,
        width: 640,
        height: 360,
        fps: 24,
        codec: "h264",
        hasAudio: false,
        formatName: "mov,mp4",
      },
    });
    const result = await ingestMediaFile({
      bytes,
      fileName: "clip.mp4",
      root,
      tempDir,
      runProbe: fakeProbe,
      runDecode: () => ({ ok: true }),
    });
    assert.ok(!result.ok);
    assert.match(result.error, new RegExp(`视频时长 ${durationMs}ms 越界`));
    assert.equal(result.reasonCode, "duration-out-of-range");
  }
  assert.deepEqual(readdirSync(tempDir), [], "失败后临时目录必须清空");
  assert.ok(!existsSync(path.join(root, "original")), "失败不得写仓");
});

test("D1：残片（截断 40%）→ 全片解码门拦，零残留", async () => {
  const full = makeTestVideo("small.mp4");
  const truncated = full.subarray(0, Math.floor(full.byteLength * 0.4));
  const root = storeRoot("d1");
  const tempDir = mkdtempSync(path.join(tmpdir(), "acs-ingest-tempdir2-"));
  const result = await ingestMediaFile({
    bytes: truncated,
    fileName: "broken.mp4",
    root,
    tempDir,
  });
  assert.ok(!result.ok);
  assert.ok(
    result.reasonCode === "decode-failed" ||
      result.reasonCode === "probe-failed",
    `残片应被探针或解码门拦截，实际 ${result.reasonCode}（${result.error}）`,
  );
  assert.deepEqual(readdirSync(tempDir), []);
  assert.ok(!existsSync(path.join(root, "original")));
});

test("W2 回滚分寸：转码失败 → 本次新写 original 删除；预存同 storeKey 文件原样", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("w2");
  const sha = result0Sha(bytes);
  const storeKey = `${sha.slice(0, 16)}.mp4`;
  const fakeBigProbe = (): ProbeOutcome => ({
    ok: true,
    probe: {
      durationMs: 2000,
      width: 1920,
      height: 1080,
      fps: 24,
      codec: "h264",
      hasAudio: false,
      formatName: "mov,mp4",
    },
  });
  const failTranscode = () => ({
    ok: false as const,
    error: "代理转码失败：注入失败",
  });
  // 场景 A：仓内无预存 → 新写 original 被回滚删除
  const a = await ingestMediaFile({
    bytes,
    fileName: "big.mp4",
    root,
    runProbe: fakeBigProbe,
    runDecode: () => ({ ok: true }),
    runTranscode: failTranscode,
  });
  assert.ok(!a.ok);
  assert.equal(a.reasonCode, "proxy-failed");
  assert.ok(
    !existsSync(path.join(root, "original", storeKey)),
    "新写的 original 必须回滚删除",
  );
  // 场景 B：仓内预存同 storeKey（伪造预存资产）→ 预存文件不得被删/被改
  const preexisting = path.join(root, "original", storeKey);
  mkdirSync(path.dirname(preexisting), { recursive: true });
  writeFileSync(preexisting, bytes);
  const mtimeBefore = statSync(preexisting).mtimeMs;
  const b = await ingestMediaFile({
    bytes,
    fileName: "big.mp4",
    root,
    runProbe: fakeBigProbe,
    runDecode: () => ({ ok: true }),
    runTranscode: failTranscode,
  });
  assert.ok(!b.ok);
  assert.ok(existsSync(preexisting), "预存文件不得被销毁");
  assert.equal(statSync(preexisting).mtimeMs, mtimeBefore);
});

test("F4：导入期间事件循环不得被阻塞（spawnSync 会冻结整条循环）", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("eventloop");
  let ticked = false;
  setImmediate(() => {
    ticked = true;
  });
  const result = await ingestMediaFile({
    bytes,
    fileName: "clip.mp4",
    root,
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.ok(ticked, "导入执行中 setImmediate 必须有机会跑（探测/解码须异步 spawn）");
});

test("幂等复用：同内容二次导入 → 同 storeKey 文件 mtime 不变（未重写）+ 新 assetId", async () => {
  const bytes = makeTestVideo("small.mp4");
  const root = storeRoot("idem");
  const first = await ingestMediaFile({ bytes, fileName: "a.mp4", root });
  assert.ok(first.ok);
  const stored = path.join(root, "original", first.asset.original.storeKey);
  const mtimeBefore = statSync(stored).mtimeMs;
  const second = await ingestMediaFile({ bytes, fileName: "b.mp4", root });
  assert.ok(second.ok);
  assert.equal(second.asset.original.storeKey, first.asset.original.storeKey);
  assert.notEqual(second.asset.assetId, first.asset.assetId);
  assert.equal(statSync(stored).mtimeMs, mtimeBefore, "复用路径不得重写仓文件");
});
