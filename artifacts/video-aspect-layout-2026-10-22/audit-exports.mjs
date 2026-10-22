import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateVideoProject } from "../../packages/video-document/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  validateVideoProject(JSON.parse(readFileSync(path.join(here, name), "utf8")));
const source = read("source-video-project.json");
const rendered = read("rendered-video-project.json");
const longSource = read("long-title-source.json");
const longRendered = read("long-title-rendered.json");
const shotIds = source.shots.map((shot) => shot.shotId);
assert.equal(shotIds.length, 4);
for (const project of [rendered, longSource, longRendered]) {
  assert.equal(project.id, source.id);
  assert.deepEqual(project.shots.map((shot) => shot.shotId), shotIds);
}
assert.equal(rendered.renderRecords.length - source.renderRecords.length, 8);
assert.equal(longRendered.renderRecords.length - longSource.renderRecords.length, 8);

const outputs = {};
for (const version of ["before", "after", "long-title"]) {
  outputs[version] = {};
  for (const aspect of ["landscape", "portrait"]) {
    const video = path.join(here, version, `${aspect}.mp4`);
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
    assert.equal(Number(metadata.format.duration), 12);
    execFileSync("ffmpeg", ["-xerror", "-v", "error", "-i", video, "-f", "null", "-"]);
    outputs[version][aspect] = {
      width: stream.width,
      height: stream.height,
      fps: stream.r_frame_rate,
      durationSeconds: 12,
      sha256: createHash("sha256").update(readFileSync(video)).digest("hex"),
      fullDecode: "pass",
    };
  }
}

execFileSync("python", [path.join(here, "verify-safe-frames.py")], {
  stdio: "inherit",
});
const report = {
  pass: true,
  projectId: source.id,
  shotIds,
  appendedRenderRecordsPerVariant: 8,
  outputs,
};
const target = process.argv.includes("--record")
  ? path.join(here, "export-audit.json")
  : path.join(here, "../../.tools/video-aspect-layout/export-audit.json");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Export audit PASS: ${source.id}; 4 shots; 6 decoded videos`);
