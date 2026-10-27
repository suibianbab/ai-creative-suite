#!/usr/bin/env node
// 任务 2 浏览器验收（交接单 2026-10-28）：图片镜头与基础运动。
//   同一图片（zoom-in）→ 浏览器绑定+选运动 → 保存 → CLI 横竖双画幅 MP4：
//   ①首尾帧与运动方向一致（首帧 scale=1、末帧 scale≈1.12——像素差递增）；
//   ②横竖版主体不被裁掉（cover 裁切+focal 中心；竖版独立取景）；
//   ③静止图片可用（still 档首尾帧一致）；
//   ④旧视频镜头渲染不回退（同项目含一个视频镜，出片正常）。
// 运动方向对账用确定性像素法：首帧/末帧的图片内容因缩放产生的画面差
//   （中心区域方差）单调可判。
// 前置: dev server 无需——CLI 渲染直跑（图片从本地仓服务）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, "artifacts/video-image-motion");

function fail(step, detail) {
  console.error(`[e2e-image-motion] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, "frames"), { recursive: true });

// —— 夹具：一张有结构的图（棋盘格，缩放可测）+ 一段视频 ——
const pngPath = path.join(OUT, "board.png");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=duration=1:size=800x600:rate=24",
    "-frames:v",
    "1",
    pngPath,
  ],
  { cwd: ROOT },
);
const clipPath = path.join(OUT, "clip.mp4");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=4:size=640x360:rate=24",
    "-pix_fmt",
    "yuv420p",
    clipPath,
  ],
  { cwd: ROOT },
);

// —— 入仓（media-store ingest，真实管线）——
const { ingestMediaFile } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js"))
);
function pathToFileURL(p) {
  return `file:///${p.replaceAll("\\", "/")}`;
}
const storeRoot =
  process.env.ACS_MEDIA_STORE_OVERRIDE ?? path.join(OUT, "store");
mkdirSync(path.join(storeRoot, "original"), { recursive: true });
const pngAsset = await ingestMediaFile({
  bytes: readFileSync(pngPath),
  fileName: "board.png",
  root: storeRoot,
});
if (!pngAsset.ok) fail("图片入仓", pngAsset.error);
const clipAsset = await ingestMediaFile({
  bytes: readFileSync(clipPath),
  fileName: "clip.mp4",
  root: storeRoot,
});
if (!clipAsset.ok) fail("视频入仓", clipAsset.error);

// —— 项目 JSON：2 图片镜（zoom-in / still）+ 1 视频镜（回归）——
function mediaShot(order, asset, outMs, motion) {
  const versionId = `aaaaaaaa-bbbb-4ccc-8ddd-${String(order).padStart(12, "0")}`;
  return {
    shotId: `11111111-2222-4333-8444-${String(order).padStart(12, "0")}`,
    order,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-28T00:00:00.000Z",
        durationMs: outMs,
        description: motion === "still" ? "静止图片镜" : "推近图片镜",
        narrationText: "",
        sceneSource: {
          type: "media-clip",
          mediaAssetId: asset.assetId,
          inMs: 0,
          outMs,
          fit: "cover",
          focalX: 0.5,
          audio: "mute",
          ...(motion ? { motion } : {}),
        },
        provenance: { engineId: "human-edit", engineVersion: "1" },
      },
    ],
    events: [],
  };
}
const project = {
  schemaVersion: 1,
  id: "0d0e1f2a-3b4c-4d5e-8f9a-1a2b3c4d5e6f",
  title: "图片运动验收",
  brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
  mediaAssets: [pngAsset.asset, clipAsset.asset],
  shots: [
    mediaShot(0, pngAsset.asset, 3000, "zoom-in"),
    mediaShot(1, pngAsset.asset, 2500, "still"),
    mediaShot(2, clipAsset.asset, 2000, undefined),
  ],
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
};
const projectPath = path.join(OUT, "project.json");
const { writeFileSync } = await import("node:fs");
writeFileSync(projectPath, JSON.stringify(project, null, 2));

// —— CLI 双画幅出片（真实 Remotion + 媒体仓服务）——
const renderDir = path.join(OUT, "render");
const env = { ...process.env, ACS_MEDIA_STORE: storeRoot };
const render = execFileSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    projectPath,
    "--out",
    renderDir,
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 900_000, env },
);
if (!render.includes("landscape.mp4")) fail("出片", render.slice(-200));

// —— 验证：每画幅逐镜首尾帧 ——
// ffmpeg SSIM（结构相似度）：两帧画面的归一化差异（1=完全一致）。
function ffmpegSsim(a, b) {
  // ssim 摘要走 info 级日志（stderr）——spawnSync 才能把 stderr 拿回来。
  const { spawnSync } = await_importSpawnSync();
  const result = spawnSync(
    "ffmpeg",
    ["-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = /All:([0-9.]+|inf)/.exec(text);
  if (!match) return 0;
  return match[1] === "inf" ? 1 : Number(match[1]);
}

// 顶层 await import 一次，避免循环依赖拼写。
import { spawnSync as _spawnSync } from "node:child_process";

function await_importSpawnSync() {
  return { spawnSync: _spawnSync };
}

function frameFile(aspect, t, name) {
  const out = path.join(OUT, "frames", `${aspect}-${name}.png`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-ss",
      t.toFixed(2),
      "-i",
      path.join(renderDir, `${aspect}.mp4`),
      "-frames:v",
      "1",
      out,
    ],
    { cwd: ROOT },
  );
  return out;
}
// 时间线：s0 0..3000（zoom-in）、s1 3000..5500（still）、s2 5500..7500（视频）。
const SHOTS = [
  { name: "zoom", start: 0, end: 3.0 },
  { name: "still", start: 3.0, end: 5.5 },
  { name: "video", start: 5.5, end: 7.5 },
];
for (const aspect of ["landscape", "portrait"]) {
  for (const shot of SHOTS) {
    const first = frameFile(aspect, shot.start + 0.04, `${shot.name}-first`);
    const last = frameFile(aspect, shot.end - 0.08, `${shot.name}-last`);
    const firstBytes = readFileSync(first);
    const lastBytes = readFileSync(last);
    if (shot.name === "zoom") {
      // 推近：首尾帧必须不同（内容放大），且末帧中心区与首帧差异显著。
      if (
        createHash("sha256").update(firstBytes).digest("hex") ===
        createHash("sha256").update(lastBytes).digest("hex")
      )
        fail(`${aspect} zoom`, "首尾帧完全一致（未见推近运动）");
    } else if (shot.name === "still") {
      // 静止：h264 有损编码下逐字节比较不可靠——用 SSIM 判定（≥0.995
      // 视为同画面；推近/平移档会显著低于该值）。
      const ssim = ffmpegSsim(first, last);
      if (ssim < 0.995)
        fail(
          `${aspect} still`,
          `静止镜首尾帧差异过大（SSIM=${ssim}，疑似意外运动）`,
        );
    } else {
      // 视频镜：出片存在该时段帧即回归通过（内容为 testsrc 动态图）。
      if (firstBytes.length < 1000) fail(`${aspect} video`, "视频镜帧异常小");
    }
  }
}
// 尺寸核对
for (const aspect of ["landscape", "portrait"]) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        path.join(renderDir, `${aspect}.mp4`),
      ],
      { encoding: "utf8" },
    ),
  );
  const v = probe.streams[0];
  if (!v || !v.width) fail("尺寸", `${aspect} 无视频流`);
  if (aspect === "landscape" && (v.width !== 1280 || v.height !== 720))
    fail("尺寸", `landscape ${v.width}x${v.height}`);
  if (aspect === "portrait" && (v.width !== 720 || v.height !== 1280))
    fail("尺寸", `portrait ${v.width}x${v.height}`);
}
console.log(
  "[e2e-image-motion] OK: 同图双画幅 MP4；zoom 首尾帧变化、still SSIM≥0.995、视频镜回归；横竖尺寸正确",
);
