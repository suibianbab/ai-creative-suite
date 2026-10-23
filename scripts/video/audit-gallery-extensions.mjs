#!/usr/bin/env node
// Audit the dual-theme gallery extension renders: both projects must retain
// their five-shot frame maps and produce H.264 dual-aspect MP4s at 24 fps
// with frame counts matching the total duration. Visual quality is a
// separate sampled-frame review recorded in REPORT.md.
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
const out = path.join(root, "artifacts/video-template-experience-2026-10-23");
const THEMES = [
  { name: "renovation", durationMs: 16_000 },
  { name: "appliance", durationMs: 16_500 },
];
const working = (shot) =>
  shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
const themes = [];
for (const theme of THEMES) {
  const dir = path.join(out, theme.name);
  const project = JSON.parse(readFileSync(path.join(dir, "project.json"), "utf8"));
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "render/render-manifest.json"), "utf8"),
  );
  assert(existsSync(path.join(dir, `${theme.name}.style-bible.json`)));
  assert.equal(project.shots.length, 5);
  // render-scene appends one record per shot per aspect: 5 × 2 = 10.
  assert.equal(project.renderRecords.length, 10);
  const outputs = [];
  for (const aspect of ["landscape", "portrait"]) {
    const file = path.join(dir, "render", `${aspect}.mp4`);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,width,height,r_frame_rate,nb_frames",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    const stream = probe.streams[0];
    assert.equal(stream.codec_name, "h264");
    assert.deepEqual(
      [stream.width, stream.height],
      aspect === "landscape" ? [1280, 720] : [720, 1280],
    );
    assert.equal(stream.r_frame_rate, "24/1");
    assert.equal(
      Number(stream.nb_frames),
      (theme.durationMs / 1000) * 24,
      `${theme.name} ${aspect} frame count`,
    );
    assert.equal(manifest.aspects[aspect].frameMap.length, 5);
    outputs.push({
      aspect,
      frames: Number(stream.nb_frames),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    });
  }
  themes.push({
    name: theme.name,
    projectId: project.id,
    shots: 5,
    renderRecords: project.renderRecords.length,
    outputs,
  });
}
const report = {
  pass: true,
  themes,
  visualReview:
    "See REPORT.md; sampled frames do not prove commercial finish.",
};
writeFileSync(
  path.join(out, "render-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
