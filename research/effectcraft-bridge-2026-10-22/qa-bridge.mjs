import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateVideoProject } from "../../packages/video-document/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = (name) => path.join(here, name);
const read = (name) => JSON.parse(readFileSync(file(name), "utf8"));
const digest = (name) =>
  createHash("sha256")
    .update(readFileSync(file(name)))
    .digest("hex");
const probe = (name) => {
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=width,height,r_frame_rate",
        "-of",
        "json",
        file(name),
      ],
      { encoding: "utf8" },
    ),
  );
  const video = info.streams.find((stream) => stream.width);
  return {
    width: video.width,
    height: video.height,
    fps: video.r_frame_rate,
    duration: Number(info.format.duration),
  };
};

const source = validateVideoProject(read("source-video-project.json"));
const land = validateVideoProject(read("handoff-landscape.json"));
const port = validateVideoProject(read("handoff-portrait.json"));
const manifest = read("bridge-manifest.json");
const changes = read("edit-diff.json");
const native = read("data-motion-edited.ecproj");
assert.equal(native.savedBy, "0.14.0");
assert.equal(native.schema, 2);
assert.equal(digest("data-motion-edited.ecproj"), manifest.nativeSource.sha256);
assert.equal(source.id, land.id);
assert.equal(source.id, port.id);
assert.equal(source.shots.length, 4);
for (let i = 0; i < source.shots.length; i++) {
  assert.deepEqual(
    land.shots[i].contentVersions[0],
    source.shots[i].contentVersions[0],
  );
  assert.deepEqual(
    port.shots[i].contentVersions[0],
    source.shots[i].contentVersions[0],
  );
}
assert.deepEqual(
  [source, land, port].map((p) => p.shots.map((s) => s.shotId)),
  [
    source.shots.map((s) => s.shotId),
    source.shots.map((s) => s.shotId),
    source.shots.map((s) => s.shotId),
  ],
);
assert.equal(
  source.shots.reduce(
    (n, s) =>
      n +
      s.contentVersions.find((v) => v.versionId === s.workingVersionId)
        .durationMs,
    0,
  ),
  12000,
);
for (const entry of changes) {
  assert.equal(digest(`${entry.comp}-before.png`), entry.before);
  assert.equal(digest(`${entry.comp}-after.png`), entry.after);
  assert.equal(entry.changed, entry.before !== entry.after);
}
assert.deepEqual(
  changes.filter((c) => c.changed).map((c) => c.comp),
  ["L_04", "P_04"],
);
assert.equal(land.renderRecords.length, 4);
assert.equal(port.renderRecords.length, 4);
assert.deepEqual(land.brief.aspectTargets, ["landscape"]);
assert.deepEqual(port.brief.aspectTargets, ["portrait"]);
assert.equal(land.mediaAssets.length, 8);
assert.equal(port.mediaAssets.length, 8);
for (const [i, entry] of manifest.shots.entries()) {
  assert.equal(entry.shotId, source.shots[i].shotId);
  for (const aspect of ["landscape", "portrait"]) {
    const variant = entry[aspect];
    assert.equal(digest(variant.file), variant.sha256);
    assert.deepEqual(probe(variant.file), {
      width: aspect === "landscape" ? 1280 : 720,
      height: aspect === "landscape" ? 720 : 1280,
      fps: "24/1",
      duration: 3,
    });
    const project = aspect === "landscape" ? land : port;
    const shot = project.shots[i];
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    assert.equal(working.sceneSource.mediaAssetId, variant.mediaAssetId);
    assert(
      shot.contentVersions.some(
        (v) =>
          v.sceneSource.type === "editor-binding" &&
          v.sceneSource.assetId === manifest.nativeSource.assetId,
      ),
    );
  }
}
const outputs = {};
for (const aspect of ["landscape", "portrait"]) {
  const expected = {
    width: aspect === "landscape" ? 1280 : 720,
    height: aspect === "landscape" ? 720 : 1280,
    fps: "24/1",
    duration: 12,
  };
  const effect = probe(`video-studio-${aspect}/${aspect}.mp4`);
  const baseline = probe(`programmatic-baseline/${aspect}.mp4`);
  assert.deepEqual(effect, expected);
  assert.deepEqual(baseline, expected);
  outputs[aspect] = {
    effectCraft: {
      ...effect,
      sha256: digest(`video-studio-${aspect}/${aspect}.mp4`),
    },
    programmatic: {
      ...baseline,
      sha256: digest(`programmatic-baseline/${aspect}.mp4`),
    },
  };
}
let nativeReopenVerified = false;
if (process.env.EFFECTCRAFT_CLI) {
  const info = JSON.parse(
    execFileSync(
      process.env.EFFECTCRAFT_CLI,
      ["info", "--project", file("data-motion-edited.ecproj"), "--json"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(info.version, "0.14.0");
  assert.equal(
    info.project.items.filter((item) => item.type === "Composition").length,
    8,
  );
  nativeReopenVerified = true;
}
const report = {
  pass: true,
  nativeReopenVerified,
  projectId: source.id,
  shotCount: 4,
  durationMs: 12000,
  nativeProjectSha256: manifest.nativeSource.sha256,
  editedComps: changes.filter((c) => c.changed).map((c) => c.comp),
  outputs,
};
if (process.argv.includes("--write-report"))
  writeFileSync(file("qa-result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
