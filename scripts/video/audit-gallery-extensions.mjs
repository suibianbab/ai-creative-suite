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
const browser = JSON.parse(
  readFileSync(path.join(out, "browser-report.json"), "utf8"),
);
const THEMES = ["renovation", "appliance"];
const themes = [];
for (const name of THEMES) {
  const dir = path.join(out, name);
  const project = JSON.parse(
    readFileSync(path.join(dir, "project.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "render/render-manifest.json"), "utf8"),
  );
  // Derive the expected total from the audited artifact itself, not literals:
  // working-version durations and the render frame map must agree.
  const durationMs = project.shots.reduce((ms, shot) => {
    const version = shot.contentVersions.find(
      (item) => item.versionId === shot.workingVersionId,
    );
    return ms + (version ? version.durationMs : 0);
  }, 0);
  for (const aspect of ["landscape", "portrait"]) {
    assert.equal(
      manifest.aspects[aspect].frameMap.reduce((sum, s) => sum + s.frames, 0),
      (durationMs / 1000) * 24,
      `${name} ${aspect} frameMap total`,
    );
  }
  // The rendered project must be the one the browser chain edited and saved.
  const browserTheme = browser.themes.find((item) => item.name === name);
  assert.ok(browserTheme, `${name} missing from browser-report`);
  assert.equal(project.id, browserTheme.projectId);
  assert(existsSync(path.join(dir, `${name}.style-bible.json`)));
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
      (durationMs / 1000) * 24,
      `${name} ${aspect} frame count`,
    );
    assert.equal(manifest.aspects[aspect].frameMap.length, 5);
    outputs.push({
      aspect,
      frames: Number(stream.nb_frames),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    });
  }
  themes.push({
    name,
    projectId: project.id,
    durationMs,
    shots: 5,
    renderRecords: project.renderRecords.length,
    outputs,
  });
}
const report = {
  pass: true,
  themes,
  visualReview: "See REPORT.md; sampled frames do not prove commercial finish.",
};
writeFileSync(
  path.join(out, "render-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
