#!/usr/bin/env node
// Task 2 验收：升级后的家装改造样片（7 镜 24 秒含双新布局）真实双画幅出片。
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-b2-renovation-2026-10-25");
mkdirSync(path.join(out, "render"), { recursive: true });
const { createGallerySample } = await import(
  pathToFileURL(
    path.join(root, "apps/web/src/app/video-studio/sample-gallery.ts"),
  ).href
);
const { applyStyleBible, validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { writeFileSync } = await import("node:fs");
const { project, bible } = await createGallerySample("renovation");
const styled = await applyStyleBible(project, bible, bible.currentVersionId);
validateVideoProject(styled);
const projectPath = path.join(out, "project.json");
writeFileSync(projectPath, `${JSON.stringify(styled, null, 2)}\n`);
writeFileSync(
  path.join(out, "renovation.style-bible.json"),
  `${JSON.stringify(bible, null, 2)}\n`,
);
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    projectPath,
    "--style-bible",
    path.join(out, "renovation.style-bible.json"),
    "--out",
    path.join(out, "render"),
  ],
  { cwd: root, stdio: "inherit" },
);
// 逐镜关键帧（对比镜 2 中段、时间轴镜 4 全节点入场完成后 = 13.7s）。
for (const aspect of ["landscape", "portrait"]) {
  for (const [shot, at] of [
    [2, 5.0],
    [4, 13.7],
  ]) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      path.join(out, "render", `${aspect}.mp4`),
      "-frames:v",
      "1",
      path.join(out, `${aspect}-shot${shot}.png`),
    ]);
  }
}
console.log("renovation 7-shot render done");
