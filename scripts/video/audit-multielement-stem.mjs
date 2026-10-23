#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-multielement-2026-10-23");
const read = (name) => JSON.parse(readFileSync(path.join(out, name), "utf8"));
const project = read("edited.video-project.json");
const before = read("before.video-project.json");
const bible = read("stem.style-bible.json");
const manifest = read("render/render-manifest.json");
assert.equal(project.shots.length, 7);
assert.equal(project.styleBibleRef.bibleId, bible.id);
assert.equal(project.renderRecords.length, 14);
const working = (shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
for (let index = 0; index < 7; index += 1) {
  assert.equal(
    working(project.shots[index]).narrationText,
    working(before.shots[index]).narrationText,
  );
  if ([1, 4].includes(index)) {
    assert.equal(
      working(project.shots[index]).sceneSource.spec.componentId,
      "explainer-composition",
    );
    assert.equal(
      working(before.shots[index]).sceneSource.spec.componentId,
      "explainer-composition",
    );
    assert.equal(
      project.shots[index].contentVersions.length,
      before.shots[index].contentVersions.length + 1,
    );
  }
}
const durationMs = project.shots.reduce(
  (total, shot) => total + working(shot).durationMs,
  0,
);
const outputs = [];
for (const aspect of ["landscape", "portrait"]) {
  const file = path.join(out, "render", `${aspect}.mp4`);
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height,r_frame_rate",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  const video = info.streams.find((stream) => stream.codec_name === "h264");
  const audio = info.streams.find((stream) => stream.codec_name === "aac");
  assert.deepEqual(
    [video?.width, video?.height],
    aspect === "landscape" ? [1280, 720] : [720, 1280],
  );
  assert.equal(video?.r_frame_rate, "24/1");
  assert(audio);
  assert(Math.abs(Number(info.format.duration) - durationMs / 1000) < 0.1);
  assert.equal(manifest.aspects[aspect].narration.length, 7);
  assert.equal(manifest.aspects[aspect].subtitleCues.length, 7);
  assert(manifest.aspects[aspect].subtitleCues.every((item) => item.cues > 0));
  for (const shot of [2, 5]) {
    assert(
      existsSync(path.join(out, "keyframes", `before-${aspect}-${shot}.png`)),
    );
    assert(
      existsSync(path.join(out, "keyframes", `after-${aspect}-${shot}.png`)),
    );
  }
  outputs.push({
    aspect,
    duration: Number(info.format.duration),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  });
}
const report = {
  pass: true,
  shots: 7,
  durationMs,
  narratedShots: 7,
  subtitleShots: 7,
  renderRecords: 14,
  outputs,
};
writeFileSync(
  path.join(out, "render-audit.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
