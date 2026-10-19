// P2.5-T2 P 表：ffprobe 解析与拒绝。纯函数部分用录制夹具（零进程），
// runProbe 用真实 ffprobe + ffmpeg 生成的夹具媒体（脚本测试先例）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isEnoentError,
  parseFps,
  parseProbeOutput,
  runProbe,
} from "./probe.js";

const WORK = mkdtempSync(path.join(tmpdir(), "acs-probe-test-"));

// 生成夹具媒体：2 秒 640x360 24fps h264，带正弦音轨。
function makeTestVideo(name: string, withAudio: boolean): string {
  const file = path.join(WORK, name);
  const args = ["-v", "error", "-y"];
  args.push("-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=24");
  if (withAudio)
    args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=2");
  args.push("-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  const spawned = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(spawned.status, 0, `ffmpeg 生成夹具失败: ${spawned.stderr}`);
  return file;
}

test("parseFps：分数帧率 30000/1001 → ≈29.97；0/0 与垃圾 → 0", () => {
  assert.ok(Math.abs(parseFps("30000/1001") - 30000 / 1001) < 1e-9);
  assert.equal(parseFps("0/0"), 0);
  assert.equal(parseFps("0/1"), 0);
  assert.equal(parseFps("garbage"), 0);
  assert.equal(parseFps("25"), 25);
});

test("parseProbeOutput：合法 JSON → 全字段（P0 正路径）", () => {
  const raw = JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 640,
        height: 360,
        r_frame_rate: "24/1",
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "2.000000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  });
  const outcome = parseProbeOutput(raw);
  assert.ok(outcome.ok);
  assert.equal(outcome.probe.durationMs, 2000);
  assert.equal(outcome.probe.width, 640);
  assert.equal(outcome.probe.height, 360);
  assert.equal(outcome.probe.fps, 24);
  assert.equal(outcome.probe.codec, "h264");
  assert.equal(outcome.probe.hasAudio, true);
});

test("parseProbeOutput P1：无视频流 → 拒", () => {
  const raw = JSON.stringify({
    streams: [{ codec_type: "audio" }],
    format: { duration: "2" },
  });
  const outcome = parseProbeOutput(raw);
  assert.ok(!outcome.ok);
  assert.match(outcome.error, /文件不含视频流/);
});

test("parseProbeOutput P2：duration 缺失/非正 → 拒", () => {
  for (const duration of ["N/A", "0", "-1"]) {
    const outcome = parseProbeOutput(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 640,
            height: 360,
            r_frame_rate: "24/1",
          },
        ],
        format: { duration },
      }),
    );
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /无法读取视频时长/);
  }
});

test("parseProbeOutput P3/P4：画幅非正整数 / 帧率 0 → 拒", () => {
  const base = { codec_type: "video", codec_name: "h264" };
  const badSize = parseProbeOutput(
    JSON.stringify({
      streams: [{ ...base, width: 0, height: 360, r_frame_rate: "24/1" }],
      format: { duration: "2" },
    }),
  );
  assert.ok(!badSize.ok && /无法读取视频画幅/.test(badSize.error));
  const badFps = parseProbeOutput(
    JSON.stringify({
      streams: [{ ...base, width: 640, height: 360, r_frame_rate: "0/0" }],
      format: { duration: "2" },
    }),
  );
  assert.ok(!badFps.ok && /无法读取视频帧率/.test(badFps.error));
});

test("runProbe 真文件：2s 640x360 24fps，hasAudio 随音轨", async () => {
  const silent = await runProbe(makeTestVideo("silent.mp4", false));
  assert.ok(silent.ok);
  assert.equal(silent.probe.durationMs, 2000);
  assert.equal(silent.probe.width, 640);
  assert.equal(silent.probe.height, 360);
  assert.equal(silent.probe.fps, 24);
  assert.equal(silent.probe.codec, "h264");
  assert.equal(silent.probe.hasAudio, false);
  const audible = await runProbe(makeTestVideo("audible.mp4", true));
  assert.ok(audible.ok);
  assert.equal(audible.probe.hasAudio, true);
});

test("runProbe P5：文本改名 .mp4 → 拒且消息中文", async () => {
  const fake = path.join(WORK, "fake.mp4");
  writeFileSync(fake, "这不是视频");
  const outcome = await runProbe(fake);
  assert.ok(!outcome.ok);
  assert.match(outcome.error, /文件无法探测：ffprobe 失败/);
});

test("runProbe ENOENT：PATH 空 → ffprobe 不在路径 → 中文大声失败（Review Focus 2）", async () => {
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const outcome = await runProbe(path.join(WORK, "silent.mp4"));
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /未找到 ffprobe（请安装 FFmpeg 并加入 PATH）/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("F1：isEnoentError 分类——ENOENT 才算未装；ENOBUFS/普通 Error 不是", () => {
  assert.equal(
    isEnoentError(
      Object.assign(new Error("spawn ENOBUFS"), { code: "ENOBUFS" }),
    ),
    false,
  );
  assert.equal(
    isEnoentError(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    true,
  );
  assert.equal(isEnoentError(new Error("普通错误")), false);
  assert.equal(isEnoentError(undefined), false);
});
