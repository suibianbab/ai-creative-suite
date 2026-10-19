// P2.5-T2 W 表：needsProxy 判定 + 真转码自核验（长边 ≤1280、时长差 <500ms、
// note 记 ffmpeg 版本）。夹具由 ffmpeg 生成（先例同 probe.test）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProbeResult, runProbe } from "./probe.js";
import { needsProxy, PROXY_MAX_EDGE, transcodeProxy } from "./proxy.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-proxy-test-"));

function fixture(name: string, size: string): string {
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
  return file;
}

function probeOf(width: number, height: number, codec: string): ProbeResult {
  return {
    durationMs: 2000,
    width,
    height,
    fps: 24,
    codec,
    hasAudio: false,
    formatName: "mov,mp4",
  };
}

test("needsProxy W1：长边 >1280 或非浏览器 codec → true；否则 false", () => {
  assert.equal(needsProxy(probeOf(1920, 1080, "h264")), true);
  assert.equal(needsProxy(probeOf(1080, 1920, "h264")), true);
  assert.equal(needsProxy(probeOf(640, 360, "h264")), false);
  assert.equal(needsProxy(probeOf(1280, 720, "h264")), false);
  assert.equal(needsProxy(probeOf(640, 360, "hevc")), true);
});

test("transcodeProxy 真转码：1080p → 1280x720 h264，note 含 ffmpeg 版本（W3 自核验内含）", async () => {
  const source = fixture("big.mp4", "1920x1080");
  const probed = await runProbe(source);
  assert.ok(probed.ok);
  const output = path.join(WORK, "big.proxy.mp4");
  const result = await transcodeProxy(source, output, probed.probe);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.ok(result.bytes > 0);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.note, /ffmpeg/i);
  assert.ok(existsSync(output));
  const verify = await runProbe(output);
  assert.ok(verify.ok);
  assert.equal(verify.probe.codec, "h264");
  assert.ok(Math.abs(verify.probe.durationMs - 2000) < 500);
});

test("transcodeProxy 竖版：1080x1920 → 720x1280", async () => {
  const source = fixture("tall.mp4", "1080x1920");
  const probed = await runProbe(source);
  assert.ok(probed.ok);
  const result = await transcodeProxy(
    source,
    path.join(WORK, "tall.proxy.mp4"),
    probed.probe,
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.width, 720);
  assert.equal(result.height, 1280);
});

test("PROXY_MAX_EDGE 常量钉死 1280", () => {
  assert.equal(PROXY_MAX_EDGE, 1280);
});

test("F1：转码进程启动失败（PATH 空）→ 错误消息须含诊断而非空前缀", async () => {
  const source = fixture("small.mp4", "640x360");
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const result = await transcodeProxy(
      source,
      path.join(WORK, "enoent.proxy.mp4"),
      probeOf(1920, 1080, "h264"),
    );
    assert.ok(!result.ok);
    assert.ok(
      result.error.length > "代理转码失败：".length,
      `消息须带诊断细节，实际：${result.error}`,
    );
  } finally {
    process.env.PATH = previousPath;
  }
});
