#!/usr/bin/env node
// Audits the retained dual-aspect narrated STEM sample without using a TTS key.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(
  root,
  "artifacts/video-studio-stem-sample-final-2026-10-23",
);
const project = JSON.parse(
  readFileSync(path.join(out, "stem.video-project.json"), "utf8"),
);
const bible = JSON.parse(
  readFileSync(path.join(out, "stem.style-bible.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(path.join(out, "render/render-manifest.json"), "utf8"),
);
assert.equal(project.shots.length, 7);
assert.equal(project.renderRecords.length, 14);
assert.equal(project.styleBibleRef.bibleId, bible.id);
const versions = project.shots.map((shot) =>
  shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  ),
);
assert(versions.every((version) => version?.narrationText));
const durationMs = versions.reduce(
  (total, version) => total + version.durationMs,
  0,
);
assert(durationMs >= 20_000 && durationMs <= 30_000);
assert.equal(
  readdirSync(path.join(out, "narration")).filter((name) =>
    name.endsWith(".wav"),
  ).length,
  7,
);
assert.equal(
  readdirSync(path.join(out, "narration")).filter((name) =>
    name.endsWith(".words.json"),
  ).length,
  7,
);

const outputs = [];
for (const aspect of ["landscape", "portrait"]) {
  const file = path.join(out, "render", `${aspect}.mp4`);
  const meta = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  const video = meta.streams.find((stream) => stream.codec_name === "h264");
  const audio = meta.streams.find((stream) => stream.codec_name === "aac");
  assert.deepEqual(
    [video?.width, video?.height],
    aspect === "landscape" ? [1280, 720] : [720, 1280],
  );
  assert(audio, `${aspect} 缺 AAC 旁白音轨`);
  assert(Math.abs(Number(meta.format.duration) - durationMs / 1000) < 0.1);
  assert.equal(manifest.aspects[aspect].fps, 24);
  assert.equal(manifest.aspects[aspect].narration.length, 7);
  assert.equal(manifest.aspects[aspect].subtitleCues.length, 7);
  assert(manifest.aspects[aspect].subtitleCues.every((cue) => cue.cues > 0));
  outputs.push({
    aspect,
    duration: Number(meta.format.duration),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  });
}
console.log(
  JSON.stringify(
    { passed: true, projectId: project.id, shots: 7, durationMs, outputs },
    null,
    2,
  ),
);
