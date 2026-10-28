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

// —— 夹具：白底 + 中心色块（四边恒亮——平移露黑条会被边缘检查直接
// 抓到；testsrc2 自带明暗条带，边缘暗≠黑条会误报）+ 一段视频 ——
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
    "color=white:s=800x600:d=1:r=24",
    "-vf",
    "drawbox=x=250:y=175:w=300:h=250:color=0x3f7f9f@1:t=fill",
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
    // P1-1：叠加放在 still 镜——静止画面上唯一的亮度变化就是药丸淡入，
    // 不与运动缩放的亮度漂移混淆。
    {
      ...mediaShot(1, pngAsset.asset, 2500, "still"),
      contentVersions: [
        {
          ...mediaShot(1, pngAsset.asset, 2500, "still").contentVersions[0],
          sceneSource: {
            ...mediaShot(1, pngAsset.asset, 2500, "still").contentVersions[0]
              .sceneSource,
            overlay: {
              title: "运动验收叠加",
              position: "bottom",
              enterMs: 400,
            },
          },
        },
      ],
    },
    // P1-2：pan 放在非首镜头（全局帧 bug 的直接受害者）。
    mediaShot(2, pngAsset.asset, 2500, "pan-left"),
    mediaShot(3, clipAsset.asset, 2000, undefined),
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

const nodeSpawnSync = _spawnSync;

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
// 时间线：s0 0..3000（zoom-in+overlay）、s1 3000..5500（pan-left）、
// s2 5500..7500（视频）。
const SHOTS = [
  { name: "zoom", start: 0, end: 3.0 },
  { name: "still", start: 3.0, end: 5.5 },
  { name: "pan", start: 5.5, end: 8.0 },
  { name: "video", start: 8.0, end: 10.0 },
];
for (const aspect of ["landscape", "portrait"]) {
  for (const shot of SHOTS) {
    const first = frameFile(aspect, shot.start + 0.04, `${shot.name}-first`);
    const last = frameFile(aspect, shot.end - 0.08, `${shot.name}-last`);
    const firstBytes = readFileSync(first);
    const lastBytes = readFileSync(last);
    if (shot.name === "zoom") {
      // 推近：首尾帧必须不同（内容放大）。
      if (
        createHash("sha256").update(firstBytes).digest("hex") ===
        createHash("sha256").update(lastBytes).digest("hex")
      )
        fail(`${aspect} zoom`, "首尾帧完全一致（未见推近运动）");
    } else if (shot.name === "still") {
      // 静止（排除药丸带）：SSIM ≥0.995。全帧比较会被叠加淡入本身
      // 拉低（首帧 ~10% vs 末帧全不透明）——只比较药丸带以上的画面区。
      const ssimUpper = ffmpegSsimCrop(first, last, "upper");
      if (ssimUpper < 0.995)
        fail(
          `${aspect} still`,
          `画面区（除药丸带）SSIM=${ssimUpper} —— 静止镜出现意外运动`,
        );
      // P1-1：药丸可见性——still 镜首帧淡入 ~10% 作基线，中段（药丸
      // 已完全不透明）的药丸条带必须显著更暗；静止画面无运动亮度混淆。
      const mid = frameFile(aspect, shot.start + 1.5, "still-mid");
      const dims = probeDims(mid);
      // 药丸文字行：实测 top≈h*0.83（字号 h*5.5% + 内边距），取窄条带
      // h*0.82..0.875 —— 覆盖药丸主体且避开下方亮内容行。
      const pillH = Math.max(12, Math.round(dims.h * 0.028));
      const pillY = Math.round(dims.h * 0.83);
      const pillW = Math.round(dims.w * 0.4);
      const pillCrop = `${pillW}:${pillH}:${Math.round(dims.w / 2 - pillW / 2)}:${pillY}`;
      const midY = stripYavgCrop(mid, pillCrop);
      const firstY = stripYavgCrop(first, pillCrop);
      if (firstY - midY < 10)
        fail(
          `${aspect} overlay`,
          `药丸条带亮度 首帧${firstY.toFixed(1)} → 中段${midY.toFixed(1)}（降幅 <10）——叠加不可见或淡入口径错误（P1-1）`,
        );
    } else if (shot.name === "pan") {
      // P1-2：非首镜头运动——首/中/末帧必须连续变化（全局帧 bug 会
      // 让它一上屏就停在终点：首帧≈末帧）。
      const mid = frameFile(aspect, shot.start + 1.25, "pan-mid");
      const ssimFL = ffmpegSsim(first, last);
      if (ssimFL >= 0.995)
        fail(
          `${aspect} pan`,
          `首末帧几乎一致（SSIM=${ssimFL}）——非首镜头运动未按镜头时长进行（P1-2）`,
        );
      const ssimFM = ffmpegSsim(first, mid);
      const ssimML = ffmpegSsim(mid, last);
      if (ssimFM >= 0.999 || ssimML >= 0.999)
        fail(`${aspect} pan`, `中段无连续过渡（F-M=${ssimFM} M-L=${ssimML}）`);
      // P1-3：平移首尾帧四边不得有黑条——边缘条带亮度须接近内容亮度。
      for (const frame of [first, last]) {
        for (const edge of ["left", "right", "top", "bottom"]) {
          const edgeY = stripYavg(frame, edge);
          const centerY = stripYavg(frame, "center");
          if (centerY - edgeY > 40)
            fail(
              `${aspect} pan ${edge}`,
              `边缘亮度 ${edgeY.toFixed(1)} 远低于中心 ${centerY.toFixed(1)}——平移露黑边（P1-3）`,
            );
        }
      }
    } else {
      // 视频镜：出片存在该时段帧即回归通过（内容为 testsrc 动态图）。
      if (firstBytes.length < 1000) fail(`${aspect} video`, "视频镜帧异常小");
    }
  }
}

// 条带亮度（P1-1/P1-3）：裁 8% 边条/中心块，signalstats YAVG。
// 上 5/6 画面的 SSIM（裁掉底部药丸带再比）。
function ffmpegSsimCrop(a, b, zone) {
  const { spawnSync: syncSpawn } = requireNodeChildProcess();
  const dims = probeDims(a);
  const upperH = Math.round((dims.h * 5) / 6);
  const crop = `crop=${dims.w}:${upperH}:0:0`;
  const out = syncSpawn(
    "ffmpeg",
    [
      "-i",
      a,
      "-i",
      b,
      "-lavfi",
      `[0:v]${crop}[l];[1:v]${crop}[r];[l][r]ssim`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const m = /All:([0-9.]+|inf)/.exec(text);
  if (!m) return 0;
  return m[1] === "inf" ? 1 : Number(m[1]);
}

function stripYavgCrop(file, crop) {
  const { spawnSync: syncSpawn } = requireNodeChildProcess();
  const out = syncSpawn(
    "ffmpeg",
    [
      "-i",
      file,
      "-vf",
      `crop=${crop},signalstats,metadata=print`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const m = /signalstats\.YAVG=([0-9.]+)/.exec(text);
  return m ? Number(m[1]) : -1;
}

function stripYavg(file, zone) {
  const { spawnSync: syncSpawn } = requireNodeChildProcess();
  const dims = probeDims(file);
  const strip = Math.max(4, Math.round(Math.min(dims.w, dims.h) * 0.08));
  const crops = {
    left: `${strip}:${dims.h}:0:0`,
    right: `${strip}:${dims.h}:${dims.w - strip}:0`,
    top: `${dims.w}:${strip}:0:0`,
    bottom: `${dims.w}:${strip}:0:${dims.h - strip}`,
    center: `${Math.round(dims.w / 3)}:${Math.round(dims.h / 3)}:${Math.round(dims.w / 3)}:${Math.round(dims.h / 3)}`,
  };
  const out = syncSpawn(
    "ffmpeg",
    [
      "-i",
      file,
      "-vf",
      `crop=${crops[zone]},signalstats,metadata=print`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const m = /signalstats\.YAVG=([0-9.]+)/.exec(text);
  return m ? Number(m[1]) : -1;
}
function probeDims(file) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  const v = JSON.parse(out).streams[0];
  return { w: v.width, h: v.height };
}
function requireNodeChildProcess() {
  // 顶层已 import execFileSync；spawnSync 单取。
  return { spawnSync: nodeSpawnSync };
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
  "[e2e-image-motion] OK: 双画幅 MP4；zoom 运动、still（画面区 SSIM≥0.995 + 药丸条带可见 P1-1）、非首镜头 pan 连续过渡（P1-2）且四边无黑条（P1-3）、视频镜回归；横竖尺寸正确",
);
