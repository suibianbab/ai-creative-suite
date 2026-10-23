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
const out = path.join(
  root,
  "artifacts/video-studio-composition-templates-2026-10-23",
);
const project = JSON.parse(
  readFileSync(path.join(out, "interior.video-project.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(path.join(out, "render/render-manifest.json"), "utf8"),
);
const browser = JSON.parse(
  readFileSync(path.join(out, "browser-report.json"), "utf8"),
);
const imageProject = JSON.parse(
  readFileSync(path.join(out, "image-variant/project.json"), "utf8"),
);
const working = (shot) =>
  shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
assert.equal(browser.pass, true);
assert.equal(browser.rollbackChecked, true);
assert.deepEqual(browser.consoleErrors, []);
assert.equal(project.shots.length, 4);
assert.equal(project.renderRecords.length, 8);
assert.equal(
  working(project.shots[1]).sceneSource.spec.componentId,
  "explainer-composition",
);
assert.equal(
  working(project.shots[2]).sceneSource.spec.params.diagram.kind,
  "drawing",
);
assert.equal(
  working(imageProject.shots[2]).sceneSource.spec.params.diagram.kind,
  "image",
);
assert.equal(imageProject.renderRecords.length, 8);
const outputs = [];
for (const aspect of ["landscape", "portrait"]) {
  const file = path.join(out, "render", `${aspect}.mp4`);
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
  assert.equal(Number(stream.nb_frames), 216);
  assert.equal(manifest.aspects[aspect].frameMap.length, 4);
  for (let shot = 1; shot <= 4; shot++)
    assert(existsSync(path.join(out, "render", `${aspect}-${shot}.png`)));
  outputs.push({
    aspect,
    frames: Number(stream.nb_frames),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  });
  const imageFile = path.join(out, "image-variant/render", `${aspect}.mp4`);
  assert(existsSync(imageFile));
  assert(
    existsSync(path.join(out, "image-variant/render", `${aspect}-image.png`)),
  );
}
const report = {
  pass: true,
  projectId: project.id,
  shots: 4,
  renderRecords: 8,
  outputs,
  imageVariantRendered: true,
  visualReview: "See REPORT.md; sampled frames do not prove commercial finish.",
};
writeFileSync(
  path.join(out, "render-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
