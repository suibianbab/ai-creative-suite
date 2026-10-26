#!/usr/bin/env node
// Task 3：从当前 main 入口重新生成季度样片，逐镜校验 + 出片。
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-first-release-acceptance-2026-10-26");
mkdirSync(path.join(out, "render"), { recursive: true });

const { createGallerySample } = await import(
  pathToFileURL(path.join(root, "apps/web/src/app/video-studio/sample-gallery.ts")).href
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { validateSceneSpec, defaultRegistry } = await import(
  pathToFileURL(path.join(root, "packages/video-scene/dist/index.js")).href
);

const { project, bible } = await createGallerySample("quarterly");
validateVideoProject(project);
console.log(`季度样片: ${project.shots.length} 镜 / ${project.shots.reduce((ms, s) => ms + s.contentVersions[0].durationMs, 0)}ms`);
for (const [i, shot] of project.shots.entries()) {
  const w = shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
  const s = w.sceneSource;
  if (s.type === "spec") {
    validateSceneSpec(s.spec, defaultRegistry);
    console.log(`  shot ${i + 1}: ${s.spec.componentId}@${s.spec.componentVersion} enterMs=${s.spec.params.enterMs ?? "none"} sequence=${s.spec.params.sequence ?? "none"}`);
  } else {
    console.log(`  shot ${i + 1}: ${s.type}`);
  }
}

writeFileSync(path.join(out, "project.json"), JSON.stringify(project, null, 2) + "\n");
writeFileSync(path.join(out, "quarterly.style-bible.json"), JSON.stringify(bible, null, 2) + "\n");

// 真实双画幅出片
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    path.join(out, "project.json"),
    "--style-bible",
    path.join(out, "quarterly.style-bible.json"),
    "--out",
    path.join(out, "render"),
  ],
  { cwd: root, stdio: "inherit" },
);

// 哈希 + 关键帧
const { readFileSync: rf } = await import("node:fs");
const sha = (f) => createHash("sha256").update(rf(f)).digest("hex");
for (const aspect of ["landscape", "portrait"]) {
  const mp4 = path.join(out, "render", `${aspect}.mp4`);
  console.log(`${aspect}: sha256=${sha(mp4)}`);
  for (const [shot, at] of [[3, 5.0], [4, 9.0]]) {
    execFileSync("ffmpeg", ["-y","-loglevel","error","-ss",String(at),"-i",mp4,"-frames:v","1",path.join(out, `${aspect}-shot${shot}.png`)]);
  }
}
console.log("ACCEPTANCE RENDER DONE");
