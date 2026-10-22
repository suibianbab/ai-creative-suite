#!/usr/bin/env node
// D：四镜头真实样片 → 风格版本 v1 / 局部修订 / v2 → MP4/GIF/SVG 导出。
// 全部产物写 .tools，零外部服务、零 TTS 调用；失败非零退出。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, ".tools/video-style-bible-e2e");
mkdirSync(OUT, { recursive: true });
const {
  applyStyleBible,
  canonicalJson,
  reviseWorkingVersion,
  resolveStyleBibleRef,
  validateVideoProject,
  workingStyleIssues,
} = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

function run(script, args, timeout = 600_000) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/video", script), ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout,
    },
  );
  if (result.status !== 0)
    throw new Error(`${script} 失败：${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function save(name, value) {
  const file = path.join(OUT, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
function cloneShot(shot, order) {
  const out = structuredClone(shot);
  const id = randomUUID();
  out.shotId = randomUUID();
  out.order = order;
  out.workingVersionId = id;
  out.contentVersions[0].versionId = id;
  out.events[0].versionId = id;
  out.contentVersions[0].narrationText = "";
  out.contentVersions[0].description = `风格样片镜头 ${order + 1}`;
  return out;
}

const source = JSON.parse(
  readFileSync(
    path.join(ROOT, "scripts/video/fixtures/three-sample.video-project.json"),
    "utf8",
  ),
);
const shots = [
  cloneShot(source.shots[1], 0),
  cloneShot(source.shots[0], 1),
  cloneShot(source.shots[0], 2),
  cloneShot(source.shots[1], 3),
];
for (const [index, shot] of shots.entries()) {
  const spec = shot.contentVersions[0].sceneSource.spec;
  if (index === 0 || index === 3) {
    spec.params.title = index === 0 ? "统一风格" : "结束语";
    spec.params.subtitle = "深蓝 · 暖金";
    spec.params.enterMs = 400;
  } else spec.params.shape = index === 1 ? "sphere" : "torus";
}
const project = {
  schemaVersion: 1,
  id: randomUUID(),
  title: "Style Bible 四镜头样片",
  brief: { sentence: "文字 → 3D → 3D → 文字", aspectTargets: ["landscape"] },
  shots,
  mediaAssets: [],
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
};
validateVideoProject(project);
const bibleId = randomUUID();
const darkId = randomUUID();
const lightId = randomUUID();
const bible = {
  schemaVersion: 1,
  id: bibleId,
  currentVersionId: lightId,
  versions: [
    {
      versionId: darkId,
      createdAt: "2026-10-22T00:00:00.000Z",
      name: "深蓝暖金",
      palette: {
        background: "#101820",
        foreground: "#f3e6cf",
        secondary: "#e8b04b",
        accent: "#e8b04b",
        object: "#c98548",
      },
      fontFamily: "NotoSansSC",
      lightingPreset: "orbit3d-fixed-soft-studio",
    },
    {
      versionId: lightId,
      createdAt: "2026-10-22T00:00:01.000Z",
      name: "浅底蓝字",
      palette: {
        background: "#f5f1e8",
        foreground: "#13283c",
        secondary: "#3268d9",
        accent: "#3268d9",
        object: "#397dba",
      },
      fontFamily: "NotoSansSC",
      lightingPreset: "orbit3d-fixed-soft-studio",
    },
  ],
};
const bibleFile = save("sample.style-bible.json", bible);
const dark = await applyStyleBible(project, bible, darkId);
assert.deepEqual(
  workingStyleIssues(
    dark,
    await resolveStyleBibleRef(dark.styleBibleRef, bible),
  ),
  [],
);
assert.deepEqual(Object.keys(dark.styleBibleRef).sort(), [
  "bibleId",
  "digest",
  "versionId",
]);
const darkFile = save("dark.video-project.json", dark);

// 缺 sidecar / 摘要错误必须在渲染前拒绝，项目字节不得变化。
const darkBefore = hash(darkFile);
const denied = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    darkFile,
    "--out",
    path.join(OUT, "denied"),
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 30_000 },
);
assert.notEqual(denied.status, 0);
assert.match(denied.stderr, /--style-bible/);
assert.equal(hash(darkFile), darkBefore);

run("render-scene.mjs", [
  "--project",
  darkFile,
  "--style-bible",
  bibleFile,
  "--out",
  path.join(OUT, "dark-render"),
]);
const darkRendered = validateVideoProject(
  JSON.parse(readFileSync(darkFile, "utf8")),
);
assert.equal(darkRendered.renderRecords.length, 4);
assert(
  darkRendered.renderRecords.every(
    (record) =>
      canonicalJson(record.styleBibleRef) === canonicalJson(dark.styleBibleRef),
  ),
);

const edited = structuredClone(dark);
const last = edited.shots[3];
const original = last.contentVersions.find(
  (v) => v.versionId === last.workingVersionId,
);
const spec = structuredClone(original.sceneSource.spec);
spec.params.title = "新的结束语";
const revised = reviseWorkingVersion(
  edited,
  last.shotId,
  { spec },
  randomUUID(),
);
assert.deepEqual(workingStyleIssues(revised, bible.versions[0]), []);
for (let i = 0; i < 3; i++)
  assert.equal(canonicalJson(revised.shots[i]), canonicalJson(dark.shots[i]));
const editedFile = save("edited.video-project.json", revised);
run("render-scene.mjs", [
  "--project",
  editedFile,
  "--style-bible",
  bibleFile,
  "--out",
  path.join(OUT, "edited-render"),
]);

// H.264 整片重编码会因后段画面变化影响前段少量像素；按解码帧
// 比较前三镜而不误称 MP4 字节一致。PSNR >60 dB 代表差异极小。
const psnr = spawnSync(
  "ffmpeg",
  [
    "-v",
    "info",
    "-i",
    path.join(OUT, "dark-render/landscape.mp4"),
    "-i",
    path.join(OUT, "edited-render/landscape.mp4"),
    "-filter_complex",
    "[0:v]trim=end_frame=72,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=72,setpts=PTS-STARTPTS[b];[a][b]psnr",
    "-f",
    "null",
    "NUL",
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
);
assert.equal(psnr.status, 0, psnr.stderr);
const firstThreePsnrDb = Number(/average:([\d.]+)/.exec(psnr.stderr)?.[1]);
assert(firstThreePsnrDb > 60, `前三镜解码帧 PSNR ${firstThreePsnrDb} dB ≤60`);

const light = await applyStyleBible(dark, bible, lightId);
assert.deepEqual(workingStyleIssues(light, bible.versions[1]), []);
assert.equal(light.styleBibleRef.versionId, lightId);
assert.equal(
  light.shots[0].contentVersions.length,
  dark.shots[0].contentVersions.length + 1,
);
const lightFile = save("light.video-project.json", light);
run("render-scene.mjs", [
  "--project",
  lightFile,
  "--style-bible",
  bibleFile,
  "--out",
  path.join(OUT, "light-render"),
]);
run("export-gif.mjs", [
  "--project",
  lightFile,
  "--style-bible",
  bibleFile,
  "--out",
  path.join(OUT, "gif"),
  "--fps",
  "24",
]);
run("export-shot-svg.mjs", [
  "--project",
  lightFile,
  "--style-bible",
  bibleFile,
  "--out",
  path.join(OUT, "svg"),
  "--shot",
  "1",
  "--frame",
  "12",
]);
const exported = validateVideoProject(
  JSON.parse(readFileSync(lightFile, "utf8")),
);
for (const record of exported.deliveries) {
  const file = path.join(
    OUT,
    record.kind === "gif" ? "gif" : "svg",
    record.outputRef,
  );
  assert.equal(hash(file), record.digest);
}

// 旧项目仍无 styleBibleRef，原契约继续过校验。
const legacy = JSON.parse(
  readFileSync(
    path.join(
      ROOT,
      "scripts/video/fixtures/interactive-sample.video-project.json",
    ),
    "utf8",
  ),
);
assert.equal(validateVideoProject(legacy).styleBibleRef, undefined);

const report = {
  shots: 4,
  font: "NotoSansSC (render font digest pinned)",
  lighting:
    "orbit3d@1 fixed ambient 0.35 + directional 2.0, position (2.5,4,3)",
  darkVersionId: darkId,
  lightVersionId: lightId,
  darkMp4Sha256: hash(path.join(OUT, "dark-render/landscape.mp4")),
  editedMp4Sha256: hash(path.join(OUT, "edited-render/landscape.mp4")),
  lightMp4Sha256: hash(path.join(OUT, "light-render/landscape.mp4")),
  firstThreeShotSourcesIdentical: true,
  firstThreeDecodedPsnrDb: firstThreePsnrDb,
  finalShotSourceDifferent:
    canonicalJson(dark.shots[3]) !== canonicalJson(revised.shots[3]),
  deliveries: exported.deliveries.map(({ kind, outputRef, digest }) => ({
    kind,
    outputRef,
    digest,
  })),
  legacyRead: true,
  missingSidecarRejected: true,
};
save("report.json", report);
console.log(`[e2e-style-bible] PASS ${JSON.stringify(report)}`);
