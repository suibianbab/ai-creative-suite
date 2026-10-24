#!/usr/bin/env node
import assert from "node:assert/strict";
// Audit the dual-theme gallery extension renders.
//
// Retained mode (default): integrity check of the committed evidence under
// artifacts/ — encoding, dimensions, frame counts, per-shot record↔frameMap↔
// working-version digests, and the browser-report project tie. It reads
// fixed retained files and by design CANNOT detect later sample or renderer
// regressions; the live regression gate is --live (VID-046).
//
// Live mode (--live): re-run the browser chain against the current code,
// render dual-aspect MP4s from the fresh projects, and apply the same
// assertions to the new outputs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const live = process.argv.includes("--live");
const artifactsFlag = process.argv.indexOf("--artifacts");
const out =
  artifactsFlag !== -1
    ? path.resolve(process.argv[artifactsFlag + 1])
    : live
      ? path.join(root, ".tools/video-gallery-live")
      : path.join(root, "artifacts/video-template-experience-2026-10-23");

const ffprobe = (file) =>
  JSON.parse(
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
  ).streams[0];

function check(condition, message) {
  if (!condition) throw new Error(`画廊审计：${message}`);
}

function auditTheme(name) {
  const dir = path.join(out, name);
  const project = JSON.parse(
    readFileSync(path.join(dir, "project.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "render/render-manifest.json"), "utf8"),
  );
  const browser = JSON.parse(
    readFileSync(path.join(out, "browser-report.json"), "utf8"),
  );
  check(existsSync(path.join(dir, `${name}.style-bible.json`)), "缺少风格文件");
  assert.equal(project.shots.length, 5);
  assert.equal(project.renderRecords.length, 10);
  const browserTheme = browser.themes.find((item) => item.name === name);
  check(Boolean(browserTheme), `browser-report 缺少 ${name}`);
  assert.equal(project.id, browserTheme.projectId);
  const durationMs = project.shots.reduce((sum, shot) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    check(Boolean(working), `${name} 存在没有工作版本的镜头`);
    return sum + working.durationMs;
  }, 0);
  const outputs = [];
  for (const aspect of ["landscape", "portrait"]) {
    const file = path.join(dir, "render", `${aspect}.mp4`);
    const stream = ffprobe(file);
    assert.equal(stream.codec_name, "h264", `${name}/${aspect} 编码`);
    assert.deepEqual(
      [stream.width, stream.height],
      aspect === "landscape" ? [1280, 720] : [720, 1280],
      `${name}/${aspect} 尺寸`,
    );
    assert.equal(stream.r_frame_rate, "24/1", `${name}/${aspect} 帧率`);
    const map = manifest.aspects[aspect].frameMap;
    assert.equal(map.length, 5, `${name}/${aspect} frameMap 镜数`);
    assert.equal(
      map.reduce((sum, item) => sum + item.frames, 0),
      (durationMs / 1000) * 24,
      `${name}/${aspect} frameMap 与项目时长不符`,
    );
    assert.equal(
      Number(stream.nb_frames),
      map.reduce((sum, item) => sum + item.frames, 0),
      `${name}/${aspect} 帧数与 frameMap 总和`,
    );
    const size = aspect === "landscape" ? [1280, 720] : [720, 1280];
    for (const item of map) {
      const shot = project.shots[item.shotIndex];
      check(Boolean(shot), `${name}/${aspect} frameMap 指向不存在的镜头`);
      assert.equal(
        item.shotId,
        shot.shotId,
        `${name}/${aspect} frameMap 镜头 ID 不符`,
      );
      // The rendered map must reflect the retained project's working versions.
      assert.equal(
        item.versionId,
        shot.workingVersionId,
        `${name}/${aspect} 镜 ${item.shotIndex + 1} frameMap 与工作版本不符`,
      );
      // Every frameMap entry needs its own render record, digest-matched.
      const record = project.renderRecords.find(
        (entry) =>
          entry.versionId === item.versionId &&
          entry.contentDigest === item.contentDigest &&
          entry.frames === item.frames &&
          entry.width === size[0] &&
          entry.height === size[1],
      );
      check(
        record,
        `${name}/${aspect} 镜 ${item.shotIndex + 1} 无逐镜渲染记录或摘要不符`,
      );
    }
    const aspectRecords = project.renderRecords.filter(
      (entry) => entry.width === size[0] && entry.height === size[1],
    );
    assert.equal(
      aspectRecords.length,
      map.length,
      `${name}/${aspect} 渲染记录数量与镜头数不符`,
    );
    outputs.push({
      aspect,
      frames: Number(stream.nb_frames),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    });
  }
  return {
    name,
    projectId: project.id,
    shots: 5,
    renderRecords: project.renderRecords.length,
    outputs,
  };
}

if (live) {
  if (!process.env.BASE_URL)
    throw new Error("--live 需要 BASE_URL 指向本 worktree 的 web 服务");
  mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, ["scripts/video/e2e-gallery-extensions.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GALLERY_EVIDENCE_DIR: out },
  });
  for (const name of ["renovation", "appliance"]) {
    const dir = path.join(out, name);
    mkdirSync(dir, { recursive: true });
    // The browser-edited project is the live render input; render-scene
    // appends its records into this exact file, so the audit's record ties
    // hold against what was actually rendered.
    copyFileSync(
      path.join(out, `${name}-edited.video-project.json`),
      path.join(dir, "project.json"),
    );
    copyFileSync(
      path.join(out, `${name}.style-bible.json`),
      path.join(dir, `${name}.style-bible.json`),
    );
    execFileSync(
      process.execPath,
      [
        "scripts/video/render-scene.mjs",
        "--project",
        path.join(dir, "project.json"),
        "--style-bible",
        path.join(dir, `${name}.style-bible.json`),
        "--out",
        path.join(dir, "render"),
      ],
      { cwd: root, stdio: "inherit" },
    );
  }
}

const themes = ["renovation", "appliance"].map(auditTheme);
console.log(
  JSON.stringify(
    {
      pass: true,
      mode: live ? "live" : "retained",
      themes,
      visualReview:
        "See REPORT.md; sampled frames do not prove commercial finish.",
    },
    null,
    2,
  ),
);
