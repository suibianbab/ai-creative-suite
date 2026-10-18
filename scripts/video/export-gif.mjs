#!/usr/bin/env node
// D4（spec R1）：整片 GIF 派生导出——从项目最近一次该画幅整片渲染的 MP4 经
// ffmpeg palettegen/paletteuse 转码，DeliveryRecord 落档（deliveries 首次写入）。
// 用法: node scripts/video/export-gif.mjs --project <path.json> [--aspect landscape|portrait] [--out <dir>] [--fps 12] [--colors 128] [--width 480]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appendDelivery } from "./delivery.mjs";

// 测试与共享方从本模块取交付追加器（计划 Interfaces 约定）。
export { appendDelivery };

// 与出片一致（render-scene.mjs 同值；scripts/ 不引 web 侧常量）。
export const RENDER_FPS = 24;
export const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };
export const GIF_FPS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];

export function findRenderBlock(project, aspect) {
  const isAspect = (record) =>
    aspect === "landscape"
      ? record.width > record.height
      : record.width < record.height;
  const last = project.renderRecords.findLastIndex(isAspect);
  if (last < 0)
    throw new Error(
      `项目没有 ${aspect} 渲染记录，先跑 render-scene 出片再导出 GIF`,
    );
  const ref = project.renderRecords[last].outputAssetRef;
  const block = [];
  for (
    let i = last;
    i >= 0 && project.renderRecords[i].outputAssetRef === ref;
    i--
  )
    block.unshift(project.renderRecords[i]);
  if (block.length !== project.shots.length)
    throw new Error(
      `${aspect} 最近渲染块长度 ${block.length} ≠ 当前镜头数 ${project.shots.length}（渲染后镜头已变更，需重渲染）`,
    );
  return { records: block, outputAssetRef: ref };
}

export function gifFrameMap(records, fps) {
  if (!GIF_FPS_CHOICES.includes(fps))
    throw new Error(
      `--fps ${fps} 不整除渲染帧率 ${RENDER_FPS}，合法值: ${GIF_FPS_CHOICES.join("/")}`,
    );
  return records.map((record) => (record.frames * fps) / RENDER_FPS);
}

export function buildGifFilter({ fps, width, colors }) {
  return (
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=4[out]`
  );
}

// —— CLI 主路径（纯逻辑以上，测试只碰纯逻辑；直接运行才执行） ——

function fail(message) {
  console.error(`[export-gif] ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      aspect: { type: "string", default: "landscape" },
      out: { type: "string" },
      fps: { type: "string", default: "12" },
      colors: { type: "string", default: "128" },
      width: { type: "string", default: "480" },
    },
  });
  if (!values.project)
    fail(
      "用法: node scripts/video/export-gif.mjs --project <path.json> [--aspect landscape|portrait] [--out <dir>] [--fps 12] [--colors 128] [--width 480]",
    );
  const aspect = values.aspect;
  if (!(aspect in DIMENSIONS))
    fail(`--aspect 只认 landscape/portrait，收到 ${aspect}`);
  const fps = Number(values.fps);
  const colors = Number(values.colors);
  const width = Number(values.width);

  const projectPath = path.resolve(values.project);
  let project;
  try {
    project = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    fail(`项目读取失败: ${error.message}`);
  }
  // 回读先整体校验：脏文档不导出（appendDelivery 追加后还会再校验一次）。
  const { validateVideoProject } = await import("./delivery.mjs");
  try {
    project = validateVideoProject(project);
  } catch (error) {
    fail(`项目校验失败: ${error.message}`);
  }

  let block;
  try {
    block = findRenderBlock(project, aspect);
  } catch (error) {
    fail(error.message);
  }
  const videoPath = path.resolve(
    path.dirname(projectPath),
    block.outputAssetRef,
  );
  if (!existsSync(videoPath))
    fail(
      `渲染产物不存在: ${videoPath}（outputAssetRef 失效，重跑 render-scene 后再导出）`,
    );

  let frameMap;
  try {
    frameMap = gifFrameMap(block.records, fps);
  } catch (error) {
    fail(error.message);
  }

  const outDir = path.resolve(values.out ?? path.dirname(projectPath));
  mkdirSync(outDir, { recursive: true });
  const gifPath = path.join(outDir, `${aspect}.gif`);
  const transcode = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      videoPath,
      "-filter_complex",
      buildGifFilter({ fps, width, colors }),
      "-map",
      "[out]",
      "-loop",
      "0",
      gifPath,
    ],
    { encoding: "utf8", timeout: 600_000 },
  );
  if (transcode.status !== 0)
    fail(`ffmpeg 转码失败:\n${transcode.stderr ?? ""}`);

  // ffprobe 门禁：codec/宽度/时长（GIF 帧计时取整允许 0.2s 容差）
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      gifPath,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (probe.status !== 0) fail(`ffprobe 失败: ${probe.stderr}`);
  const metadata = JSON.parse(probe.stdout);
  const stream = metadata.streams?.[0];
  const totalFrames = block.records.reduce(
    (sum, record) => sum + record.frames,
    0,
  );
  const expectedSeconds = totalFrames / RENDER_FPS;
  const durationSeconds = Number(metadata.format?.duration ?? 0);
  if (stream?.codec_name !== "gif" || stream?.width !== width)
    fail(`GIF 元数据不符: ${JSON.stringify(metadata)}（期望 gif/${width} 宽）`);
  if (Math.abs(durationSeconds - expectedSeconds) > 0.2)
    fail(`GIF 时长 ${durationSeconds}s 与源 ${expectedSeconds}s 偏差超 0.2s`);

  const { project: next, delivery } = appendDelivery(project, {
    versionIds: block.records.map((record) => record.versionId),
    renderIds: block.records.map((record) => record.renderId),
    frameMap,
  });
  writeFileSync(projectPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `[export-gif] 完成: ${gifPath}（${expectedSeconds.toFixed(1)}s @${fps}fps, ${width}px 宽）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 ${path.basename(projectPath)} (savedVersion=${next.savedVersion})`,
  );
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) await main();
