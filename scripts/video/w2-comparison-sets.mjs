#!/usr/bin/env node
// W2 三套内部对照样片：文字动效 / 数据解释（配方直构，无浏览器依赖）、
// 竖版字幕（复用留存的最终 STEM 项目与其旁白资产）。每套产出双画幅 MP4、
// 中段关键帧与项目/风格 JSON；人工审片在 REPORT 中标「待人工」。
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-w2-2026-10-24");
const { applyStyleBible, validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { applyShotRecipe } = await import(
  pathToFileURL(
    path.join(root, "apps/web/src/app/video-studio/shot-recipes.ts"),
  ).href
);

const emptyProject = (title) => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  title,
  brief: { sentence: "W2 内部对照", aspectTargets: ["landscape", "portrait"] },
  shots: [],
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

const bibleFor = (name, palette) => {
  const versionId = crypto.randomUUID();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    currentVersionId: versionId,
    versions: [
      {
        versionId,
        createdAt: new Date().toISOString(),
        name,
        palette,
        fontFamily: "NotoSansSC",
        lightingPreset: "orbit3d-fixed-soft-studio",
      },
    ],
  };
};

async function buildRecipeSet(setName, recipeId, inputs, bible) {
  const dir = path.join(out, setName);
  mkdirSync(path.join(dir, "render"), { recursive: true });
  const project = emptyProject(`W2 对照 · ${setName}`);
  const applied = applyShotRecipe(project, recipeId, inputs);
  if (!("document" in applied)) throw new Error(applied.error);
  const styled = await applyStyleBible(
    applied.document,
    bible,
    bible.currentVersionId,
  );
  validateVideoProject(styled);
  const projectPath = path.join(dir, "project.json");
  const biblePath = path.join(dir, `${setName}.style-bible.json`);
  mkdirSync(path.dirname(projectPath), { recursive: true });
  const { writeFileSync } = await import("node:fs");
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
      path.join(dir, "render"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  extractFrames(dir, 1);
}

function extractFrames(dir, shotCount) {
  for (const aspect of ["landscape", "portrait"]) {
    const file = path.join(dir, "render", `${aspect}.mp4`);
    for (let shot = 1; shot <= shotCount; shot++) {
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        "1.4",
        "-i",
        file,
        "-frames:v",
        "1",
        path.join(dir, `${aspect}-${shot}-mid.png`),
      ]);
    }
  }
}

await buildRecipeSet(
  "text-motion",
  "recipe-text-point",
  { title: "一句话开场", subtitle: "三十秒讲清楚" },
  bibleFor("对照 · 深蓝文字", {
    background: "#101f34",
    foreground: "#f3f5f7",
    secondary: "#b4d8e4",
    accent: "#f5b652",
    object: "#42a5a0",
  }),
);
await buildRecipeSet(
  "data-explain",
  "recipe-data-bar",
  { title: "月度对比", labels: ["一月", "二月", "三月"], values: [3, 6, 9] },
  bibleFor("对照 · 深蓝数据", {
    background: "#122137",
    foreground: "#f5f7fa",
    secondary: "#afcde6",
    accent: "#ffbc60",
    object: "#4a9fdb",
  }),
);

// 竖版字幕对照：复用留存的最终 STEM 项目（含旁白与字幕链路）重渲。
{
  const dir = path.join(out, "portrait-subtitle");
  mkdirSync(path.join(dir, "render"), { recursive: true });
  const source = path.join(
    root,
    "artifacts/video-studio-stem-sample-final-2026-10-23",
  );
  execFileSync(
    process.execPath,
    [
      "scripts/video/render-scene.mjs",
      "--project",
      path.join(source, "stem.video-project.json"),
      "--style-bible",
      path.join(source, "stem.style-bible.json"),
      "--narration",
      path.join(source, "narration"),
      "--out",
      path.join(dir, "render"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  copyFileSync(
    path.join(source, "stem.video-project.json"),
    path.join(dir, "project.json"),
  );
  copyFileSync(
    path.join(source, "stem.style-bible.json"),
    path.join(dir, "portrait-subtitle.style-bible.json"),
  );
  // 竖版字幕镜（各镜中段 + 第 5 镜字幕带更晚帧）。
  for (const [shot, at] of [
    [1, 1.4],
    [2, 5.5],
    [3, 9.5],
    [4, 13.5],
    [5, 17.5],
    [6, 21.5],
    [7, 24.5],
  ]) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      path.join(dir, "render", "portrait.mp4"),
      "-frames:v",
      "1",
      path.join(dir, `portrait-${shot}-mid.png`),
    ]);
  }
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "render", "render-manifest.json"), "utf8"),
  );
  console.log(
    "portrait-subtitle frames:",
    manifest.aspects.portrait.frameMap.reduce((s, f) => s + f.frames, 0),
  );
}
console.log(`W2 comparison sets done → ${out}`);
