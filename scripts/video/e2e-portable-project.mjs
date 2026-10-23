#!/usr/bin/env node
// Two real render round trips: Style Bible with historical media and active
// media without Style Bible (the current Style Bible contract forbids both active).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256File } from "./sha256-file.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { ingestMediaFile } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const EVIDENCE_ROOT = path.join(ROOT, ".tools", "video-portable-e2e");
mkdirSync(EVIDENCE_ROOT, { recursive: true });
const work = mkdtempSync(path.join(EVIDENCE_ROOT, "run-"));

function run(label, script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 600_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${label} 失败（exit ${result.status}）：${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}

function runExpectedFailure(label, script, args, expected) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.notEqual(result.status, 0, `${label} 意外成功`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected);
}

const original = path.join(
  ROOT,
  "artifacts/video-studio-composition-templates-2026-10-23/render/landscape.mp4",
);
const sourceStore = path.join(work, "source-store");
const ingested = await ingestMediaFile({
  bytes: readFileSync(original),
  fileName: "interior-sample.mp4",
  root: sourceStore,
  generateProxy: false,
});
assert.equal(ingested.ok, true, ingested.error);
const project = JSON.parse(
  readFileSync(
    path.join(
      ROOT,
      "artifacts/video-studio-composition-templates-2026-10-23/interior.video-project.json",
    ),
    "utf8",
  ),
);
project.mediaAssets = [...(project.mediaAssets ?? []), ingested.asset];
const shot = project.shots[0];
const previous = shot.contentVersions.find(
  (version) => version.versionId === shot.workingVersionId,
);
assert.ok(previous);
const versionId = randomUUID();
const at = new Date().toISOString();
const durationMs = Math.min(2000, ingested.asset.original.durationMs);
assert.ok(durationMs >= 200);
shot.contentVersions.push({
  versionId,
  createdAt: at,
  durationMs,
  description: "家装方案视频素材展示",
  narrationText: "",
  sceneSource: {
    type: "media-clip",
    mediaAssetId: ingested.asset.assetId,
    inMs: 0,
    outMs: durationMs,
    fit: "contain",
    focalX: 0.5,
    audio: "mute",
  },
  provenance: {
    engineId: "portable-e2e",
    engineVersion: "1",
    parentVersionId: previous.versionId,
  },
});
shot.events.push({ kind: "submitted", versionId, at, actor: "human" });
project.savedVersion += 1;
const styledProject = structuredClone(project);
shot.workingVersionId = versionId;
delete project.styleBibleRef;
validateVideoProject(project);
validateVideoProject(styledProject);
const styleFile = path.join(
  ROOT,
  "artifacts/video-studio-composition-templates-2026-10-23/interior.style-bible.json",
);
const cli = path.join(ROOT, "scripts/video/portable-project.mjs");
async function roundTrip(label, inputProject, withStyle) {
  const sourceProject = path.join(work, `${label}.source.video-project.json`);
  writeFileSync(sourceProject, JSON.stringify(inputProject, null, 2));
  const bundle = path.join(work, `${label}.bundle`);
  const targetStore = path.join(work, `${label}.target-store`);
  const restored = path.join(work, `${label}.restored`);
  run(`${label} pack`, cli, [
    "pack",
    "--project",
    sourceProject,
    ...(withStyle ? ["--style-bible", styleFile] : []),
    "--store",
    sourceStore,
    "--out",
    bundle,
  ]);
  run(`${label} verify`, cli, ["verify", "--bundle", bundle]);
  run(`${label} restore`, cli, [
    "restore",
    "--bundle",
    bundle,
    "--store",
    targetStore,
    "--out",
    restored,
  ]);
  const restoredProject = path.join(restored, "project.video-project.json");
  assert.equal(
    readFileSync(restoredProject, "utf8"),
    readFileSync(sourceProject, "utf8"),
  );
  const renderOut = path.join(work, `${label}.render`);
  run(
    `${label} render`,
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    [
      "--project",
      restoredProject,
      ...(withStyle
        ? ["--style-bible", path.join(restored, "style-bible.json")]
        : []),
      "--out",
      renderOut,
    ],
    { ...process.env, ACS_MEDIA_STORE: targetStore },
  );
  const rendered = validateVideoProject(
    JSON.parse(readFileSync(restoredProject, "utf8")),
  );
  const records = rendered.renderRecords.filter(
    (record) => record.versionId === versionId,
  );
  assert.equal(records.length, withStyle ? 0 : 2);
  if (!withStyle)
    for (const record of records)
      assert.equal(
        record.assetDigests?.[ingested.asset.assetId],
        ingested.asset.original.sha256,
      );
  const outputs = {};
  for (const aspect of ["landscape", "portrait"]) {
    const file = path.join(renderOut, `${aspect}.mp4`);
    outputs[aspect] = { file, sha256: await sha256File(file) };
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(
      probe.stdout.trim(),
      aspect === "landscape" ? "1280x720" : "720x1280",
    );
  }
  return {
    bundle,
    targetStore,
    restoredProject,
    mediaRenderRecords: records.length,
    outputs,
  };
}

const styled = await roundTrip("styled", styledProject, true);
const media = await roundTrip("media", project, false);
const incompatibleProject = path.join(work, "incompatible.video-project.json");
writeFileSync(
  incompatibleProject,
  JSON.stringify({ ...project, styleBibleRef: styledProject.styleBibleRef }),
);
runExpectedFailure(
  "active media with Style Bible",
  cli,
  [
    "pack",
    "--project",
    incompatibleProject,
    "--style-bible",
    styleFile,
    "--store",
    sourceStore,
    "--out",
    path.join(work, "incompatible.bundle"),
  ],
  /Style Bible 与工作镜头不兼容/,
);
const result = {
  pass: true,
  projectId: project.id,
  originalSha256: ingested.asset.original.sha256,
  styled,
  media,
  incompatibleStyleMediaRejected: true,
};
writeFileSync(path.join(work, "report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
