#!/usr/bin/env node
// Reuse the already approved WAV/word timing when only visuals changed.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const oldDir = path.join(
  root,
  "artifacts/video-studio-stem-sample-final-2026-10-23",
);
const nextDir = path.join(
  root,
  "artifacts/video-studio-multielement-2026-10-23",
);
const old = JSON.parse(
  readFileSync(path.join(oldDir, "stem.video-project.json"), "utf8"),
);
const next = JSON.parse(
  readFileSync(path.join(nextDir, "edited.video-project.json"), "utf8"),
);
assert.equal(old.shots.length, next.shots.length);
mkdirSync(path.join(nextDir, "narration"), { recursive: true });
for (let index = 0; index < old.shots.length; index += 1) {
  const a = old.shots[index];
  const b = next.shots[index];
  const av = a.contentVersions.find((v) => v.versionId === a.workingVersionId);
  const bv = b.contentVersions.find((v) => v.versionId === b.workingVersionId);
  assert.equal(
    av.narrationText,
    bv.narrationText,
    `镜头 ${index + 1} 文本发生变化，不能复用旁白`,
  );
  assert.equal(av.durationMs, bv.durationMs, `镜头 ${index + 1} 时长发生变化`);
  for (const extension of ["wav", "words.json"]) {
    copyFileSync(
      path.join(
        oldDir,
        "narration",
        `${a.shotId}-${av.versionId}.${extension}`,
      ),
      path.join(
        nextDir,
        "narration",
        `${b.shotId}-${bv.versionId}.${extension}`,
      ),
    );
  }
}
console.log(
  "STEM narration reuse: 7 text/duration matches, WAV and word timing copied",
);
