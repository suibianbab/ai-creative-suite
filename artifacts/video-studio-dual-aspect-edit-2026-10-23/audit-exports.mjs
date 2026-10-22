#!/usr/bin/env node
// VID-035：双画幅预览与画幅微调的真实出片审计（2026-10-23）。
// 断言：同项目双变体（无覆写 before / 竖版覆写 after）各出横竖版 MP4；
// 分辨率 1280×720 / 720×1280、24fps、时长 = 量化总帧数；渲染记录逐镜×
// 逐画幅追加；全片解码通过；安全区 4×2×2 采样零越界（Python 像素核验）；
// 标签可读性关键帧落盘供人工审片（与安全区结论分开陈述）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const { quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const read = (name) =>
  validateVideoProject(
    JSON.parse(readFileSync(path.join(here, name), "utf8")),
  );
const before = read("stress-before.video-project.json"); // 渲染后回写：含追加记录
const after = read("stress-after.video-project.json");
assert.equal(after.id, before.id);
assert.deepEqual(
  after.shots.map((shot) => shot.shotId),
  before.shots.map((shot) => shot.shotId),
);
assert.equal(after.shots.length, 4, "压力项目固定 4 镜头");
// e2e 导出时无渲染记录；两个变体各应追加 4 镜头 × 2 画幅 = 8 条。
assert.equal(before.renderRecords.length, 8);
assert.equal(after.renderRecords.length, 8);

const durations = after.shots.map((shot) => {
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  return version.durationMs;
});
const timeline = quantizeTimeline(durations, 24);
const totalSeconds = timeline.totalFrames / 24;

const outputs = {};
for (const version of ["before", "after"]) {
  outputs[version] = {};
  for (const aspect of ["landscape", "portrait"]) {
    const video = path.join(here, `render-${version}`, `${aspect}.mp4`);
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v", "error", "-select_streams", "v:0", "-show_entries",
          "stream=width,height,r_frame_rate", "-show_entries", "format=duration",
          "-of", "json", video,
        ],
        { encoding: "utf8" },
      ),
    );
    const stream = metadata.streams[0];
    assert.equal(stream.width, aspect === "landscape" ? 1280 : 720);
    assert.equal(stream.height, aspect === "landscape" ? 720 : 1280);
    assert.equal(stream.r_frame_rate, "24/1");
    assert.ok(
      Math.abs(Number(metadata.format.duration) - totalSeconds) < 0.05,
      `时长 ${metadata.format.duration}s ≠ 量化总长 ${totalSeconds}s`,
    );
    execFileSync("ffmpeg", ["-xerror", "-v", "error", "-i", video, "-f", "null", "-"]);
    outputs[version][aspect] = {
      width: stream.width,
      height: stream.height,
      fps: stream.r_frame_rate,
      durationSeconds: totalSeconds,
      frames: timeline.totalFrames,
      sha256: createHash("sha256").update(readFileSync(video)).digest("hex"),
      fullDecode: "pass",
    };
  }
}

// 安全区像素核验的采样配置（每镜 4 时点 × 2 画幅 × 2 变体）。
let cursor = 0;
const shotSpans = timeline.shots.map((span) => {
  const start = cursor;
  cursor = span.startFrame + span.frames;
  return start / 24;
});
writeFileSync(
  path.join(here, "spans.json"),
  `${JSON.stringify({
    shotCount: timeline.shots.length,
    shotSeconds: timeline.shots.map((span) => span.frames / 24),
    before: shotSpans,
    after: shotSpans,
  }, null, 2)}\n`,
);
execFileSync("python", [path.join(here, "verify-safe-frames.py")], {
  stdio: "inherit",
});

// 人工审片关键帧：折线镜头（第 2 镜）中段 × 双画幅 × 双变体。
mkdirSync(path.join(here, "keyframes"), { recursive: true });
const lineShotStart = timeline.shots[1].startFrame / 24;
const lineShotMid = lineShotStart + timeline.shots[1].frames / 24 / 2;
const keyframes = [];
for (const version of ["before", "after"]) {
  for (const aspect of ["landscape", "portrait"]) {
    const name = `keyframes/${version}-${aspect}-line-chart.png`;
    execFileSync("ffmpeg", [
      "-v", "error", "-ss", lineShotMid.toFixed(3), "-i",
      path.join(here, `render-${version}`, `${aspect}.mp4`),
      "-frames:v", "1", "-y", path.join(here, name),
    ]);
    keyframes.push(name);
  }
}

const report = {
  pass: true,
  projectId: after.id,
  shotIds: after.shots.map((shot) => shot.shotId),
  totalFrames: timeline.totalFrames,
  appendedRenderRecordsPerVariant: 8,
  outputs,
  humanReviewKeyframes: keyframes,
};
const target = process.argv.includes("--record")
  ? path.join(here, "export-audit.json")
  : path.join(ROOT, ".tools/video-studio-dual-aspect-edit/export-audit.json");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Export audit PASS: ${after.id}; 4 shots; 4 decoded videos; safe frames clean; keyframes at ${keyframes.join(", ")}`,
);
