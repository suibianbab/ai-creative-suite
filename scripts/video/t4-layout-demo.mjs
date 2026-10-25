#!/usr/bin/env node
// T4 验收：用非 STEM 短片（"门店改造季报"）实际采用两种新布局——
// 前后对比 + 里程碑时间轴——加上开场文字，真实双画幅出片并抽帧。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-t4-layouts-2026-10-25");
mkdirSync(path.join(out, "render"), { recursive: true });
const { applyStyleBible, validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { applyShotRecipe } = await import(
  pathToFileURL(
    path.join(root, "apps/web/src/app/video-studio/shot-recipes.ts"),
  ).href
);

const emptyProject = () => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  title: "门店改造季报",
  brief: { sentence: "T4 布局验收", aspectTargets: ["landscape", "portrait"] },
  shots: [],
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});
const versionId = crypto.randomUUID();
const bible = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  currentVersionId: versionId,
  versions: [
    {
      versionId,
      createdAt: new Date().toISOString(),
      name: "暖木改造",
      palette: {
        background: "#241c14",
        foreground: "#f5efe6",
        secondary: "#e3cfae",
        accent: "#d97a3d",
        object: "#7d8b5a",
      },
      fontFamily: "NotoSansSC",
      lightingPreset: "orbit3d-fixed-soft-studio",
    },
  ],
};

let project = emptyProject();
// 开场
let result = applyShotRecipe(project, "recipe-text-point", {
  title: "门店改造季报",
  subtitle: "两个关键变化",
});
if (!("document" in result)) throw new Error(result.error);
project = result.document;
// 前后对比
result = applyShotRecipe(project, "recipe-compare-split", {
  title: "等单时长对比",
  subtitle: "12 分钟",
  labels: ["3 分钟"],
});
if (!("document" in result)) throw new Error(result.error);
project = result.document;
// 里程碑
result = applyShotRecipe(project, "recipe-timeline-milestones", {
  title: "改造里程碑",
  labels: ["签约", "拆除", "重装", "验收", "开业"],
});
if (!("document" in result)) throw new Error(result.error);
project = result.document;
// 收尾
result = applyShotRecipe(project, "recipe-text-point", {
  title: "下季目标",
  subtitle: "翻台率再提 20%",
});
if (!("document" in result)) throw new Error(result.error);
project = result.document;
const styled = await applyStyleBible(project, bible, bible.currentVersionId);
validateVideoProject(styled);
const projectPath = path.join(out, "project.json");
const biblePath = path.join(out, "t4.style-bible.json");
writeFileSync(projectPath, `${JSON.stringify(styled, null, 2)}\n`);
writeFileSync(biblePath, `${JSON.stringify(bible, null, 2)}\n`);

execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    projectPath,
    "--style-bible",
    biblePath,
    "--out",
    path.join(out, "render"),
  ],
  { cwd: root, stdio: "inherit" },
);
for (const aspect of ["landscape", "portrait"]) {
  for (const [shot, at] of [
    [2, 2.5],
    [3, 6.5],
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
const manifest = JSON.parse(
  readFileSync(path.join(out, "render/render-manifest.json"), "utf8"),
);
console.log(
  "frames:",
  Object.fromEntries(
    ["landscape", "portrait"].map((a) => [
      a,
      manifest.aspects[a].frameMap.reduce((s, f) => s + f.frames, 0),
    ]),
  ),
);
