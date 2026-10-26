#!/usr/bin/env node
// Task 3 验收脚本（F1/F3 修复版）。
// 运行方式（试用包已记录）：node --import tsx scripts/video/first-release-acceptance.mjs
// 输出到可配置目录（ACCEPTANCE_OUT），成功后才写产物。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// tsx runtime
const { createGallerySample } = await import(
  pathToFileURL(path.join(root, "apps/web/src/app/video-studio/sample-gallery.ts")).href
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { validateSceneSpec, defaultRegistry } = await import(
  pathToFileURL(path.join(root, "packages/video-scene/dist/index.js")).href
);

const out = path.resolve(
  process.env.ACCEPTANCE_OUT ??
    path.join(root, "artifacts/video-studio-first-release-acceptance-2026-10-26"),
);
mkdirSync(path.join(out, "render"), { recursive: true });

const { project, bible } = await createGallerySample("quarterly");
validateVideoProject(project);
console.log(`季度样片: ${project.shots.length} 镜 / ${project.shots.reduce((ms, s) => ms + s.contentVersions[0].durationMs, 0)}ms`);
for (const [i, shot] of project.shots.entries()) {
  const w = shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
  const s = w.sceneSource;
  if (s.type === "spec") {
    validateSceneSpec(s.spec, defaultRegistry);
    console.log(`  shot ${i + 1}: ${s.spec.componentId}@${s.spec.componentVersion}`);
  } else {
    console.log(`  shot ${i + 1}: ${s.type}`);
  }
}

writeFileSync(path.join(out, "project.json"), JSON.stringify(project, null, 2) + "\n");
writeFileSync(path.join(out, "quarterly.style-bible.json"), JSON.stringify(bible, null, 2) + "\n");

// 渲染
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

// F3 修复：从 render-manifest frameMap 推导抽帧时间，不手写秒数。
const manifest = JSON.parse(
  readFileSync(path.join(out, "render", "render-manifest.json"), "utf8"),
);
const fps = 24;
const targets = [];
for (const aspect of ["landscape"]) {
  for (const [i, shot] of manifest.aspects[aspect].frameMap.entries()) {
    const mid = shot.startFrame + Math.floor(shot.frames / 2);
    const late = shot.startFrame + Math.floor(shot.frames * 0.9);
    targets.push({ shot: i + 1, componentId: shot.componentId, mid, late });
  }
}
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const report = { fps, shots: [], hashes: {} };
for (const aspect of ["landscape", "portrait"]) {
  const mp4 = path.join(out, "render", `${aspect}.mp4`);
  report.hashes[aspect] = sha(mp4);
  // 抽对比镜（explainer-composition compare-split）和时间轴镜（timeline-milestones）
  for (const t of targets) {
    if (
      t.componentId === "compare-split" ||
      t.componentId === "timeline-milestones"
    ) {
      const midSec = (t.mid / fps).toFixed(3);
      const lateSec = (t.late / fps).toFixed(3);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-ss", midSec, "-i", mp4, "-frames:v", "1",
        path.join(out, `${aspect}-shot${t.shot}-mid.png`),
      ]);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-ss", lateSec, "-i", mp4, "-frames:v", "1",
        path.join(out, `${aspect}-shot${t.shot}-late.png`),
      ]);
      report.shots.push({
        aspect,
        shot: t.shot,
        componentId: t.componentId,
        midFrame: t.mid,
        lateFrame: t.late,
        midSec: Number(midSec),
        lateSec: Number(lateSec),
      });
      console.log(`${aspect} shot${t.shot} (${t.componentId}): mid@${midSec}s late@${lateSec}s`);
    }
  }
}
writeFileSync(path.join(out, "acceptance-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log("ACCEPTANCE DONE");
console.log("hashes:", JSON.stringify(report.hashes));
