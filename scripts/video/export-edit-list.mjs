#!/usr/bin/env node
// W5 中立剪辑交换清单导出器（edit-list v1）：镜头产物与时序、字幕文本、
// 独立音轨、素材摘要/来源、画幅与帧率。每个交付版本一条权威终片时间线；
// 导出失败不留成功记录（原子写 + 校验后落盘）。
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const sha256File = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export function buildEditList(project, { fps = 24, narrationDir = null } = {}) {
  const working = (shot) =>
    shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  const timeline = [];
  let cursorFrames = 0;
  for (const shot of project.shots) {
    const version = working(shot);
    const frames = Math.round((version.durationMs / 1000) * fps);
    const entry = {
      shotId: shot.shotId,
      versionId: version.versionId,
      startFrame: cursorFrames,
      endFrame: cursorFrames + frames,
      durationMs: version.durationMs,
      description: version.description,
      component: version.sceneSource.type,
      narrationText: version.narrationText ?? "",
    };
    if (version.sceneSource.type === "spec")
      entry.componentId = version.sceneSource.spec.componentId;
    if (version.sceneSource.type === "media-clip") {
      entry.mediaAssetId = version.sceneSource.mediaAssetId;
      entry.clip = {
        inMs: version.sceneSource.inMs,
        outMs: version.sceneSource.outMs,
        fit: version.sceneSource.fit,
      };
    }
    // 独立音轨引用：旁白 WAV 与字级时间戳（存在才引用，摘要入账）。
    if (narrationDir) {
      for (const ext of ["wav", "words.json"]) {
        const file = path.join(
          narrationDir,
          `${shot.shotId}-${version.versionId}.${ext}`,
        );
        if (existsSync(file))
          entry[ext === "wav" ? "audioTrack" : "wordTimings"] = {
            file: path.basename(file),
            bytes: readFileSync(file).length,
            sha256: sha256File(file),
          };
      }
    }
    timeline.push(entry);
    cursorFrames += frames;
  }
  return {
    format: "acs-edit-list",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId: project.id,
    savedVersion: project.savedVersion,
    authoritativeTimeline: "shots 按序拼接即为唯一权威终片时间线",
    fps,
    aspects: project.brief.aspectTargets,
    timeline,
    mediaAssets: (project.mediaAssets ?? []).map((asset) => ({
      assetId: asset.assetId,
      origin: asset.origin,
      original: asset.original,
    })),
  };
}

export function validateEditList(list) {
  if (
    !list ||
    list.format !== "acs-edit-list" ||
    list.formatVersion !== 1 ||
    !Array.isArray(list.timeline) ||
    list.timeline.length === 0 ||
    typeof list.projectId !== "string" ||
    !Array.isArray(list.aspects) ||
    list.aspects.length === 0
  )
    throw new Error("edit-list v1 形状无效");
  let expectedStart = 0;
  const seenShots = new Set();
  for (const [index, entry] of list.timeline.entries()) {
    const field = `timeline[${index}]`;
    if (typeof entry.shotId !== "string" || seenShots.has(entry.shotId))
      throw new Error(`${field}.shotId 无效或重复`);
    seenShots.add(entry.shotId);
    if (entry.startFrame !== expectedStart)
      throw new Error(`${field}.startFrame 须无缝衔接（权威时间线）`);
    if (entry.endFrame <= entry.startFrame)
      throw new Error(`${field} 帧区间须为正`);
    expectedStart = entry.endFrame;
  }
  return true;
}

// CLI：node export-edit-list.mjs --project <json> --out <dir> [--fps 24]
// [--narration <dir>]（导出文件 edit-list.v1.json，原子写）。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      out: { type: "string" },
      fps: { type: "string" },
      narration: { type: "string" },
    },
    strict: true,
  });
  if (!values.project || !values.out) {
    console.error(
      "用法：export-edit-list.mjs --project <json> --out <dir> [--fps 24] [--narration <dir>]",
    );
    process.exit(1);
  }
  const project = validateVideoProject(
    JSON.parse(readFileSync(values.project, "utf8")),
  );
  const list = buildEditList(project, {
    fps: values.fps ? Number(values.fps) : 24,
    narrationDir: values.narration ?? null,
  });
  validateEditList(list);
  mkdirSync(values.out, { recursive: true });
  const temp = path.join(values.out, ".edit-list.tmp.json");
  writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`);
  renameSync(temp, path.join(values.out, "edit-list.v1.json"));
  console.log(
    `edit-list v1 → ${path.join(values.out, "edit-list.v1.json")}（${list.timeline.length} 镜头 / ${list.aspects.join("+")} / ${values.fps ?? 24}fps）`,
  );
}
