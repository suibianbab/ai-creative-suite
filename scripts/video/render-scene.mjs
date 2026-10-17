#!/usr/bin/env node
// 出片脚本：项目 JSON → 整片双尺寸 MP4 + render-manifest.json + RenderRecord 回写。
// P1 起支持多镜头：量化帧图拼成单文件整片（Timeline-* 合成），单镜头是 N=1 特例。
// 渲染前先跑逐帧干跑门禁（worker 隔离 + 单帧预算，P2-A 补齐），--skip-dryrun 可跳。
// 用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir> [--skip-dryrun] [--budget-ms 500]
// 依赖: packages/{video-document,video-scene} 已 build（pnpm -r build）；ffprobe 在 PATH。
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { browserLabel } from "./env-info.mjs";
import {
  buildProjectDryRunJobs,
  DEFAULT_BUDGET_MS,
  dryRunJobs,
} from "./frame-dryrun.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FONT_REL =
  "packages/remotion-engine/src/assets/fonts/NotoSansSC-Regular.woff";
const FPS = 24;
const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };

// scripts/ 不进 workspace 包图，按预检裁决用相对路径引 dist。
const { canonicalJson, quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { defaultRegistry, validateSceneSpec } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
);
const remotionVersion = JSON.parse(
  readFileSync(
    path.join(ROOT, "packages/remotion-engine/package.json"),
    "utf8",
  ),
).dependencies.remotion;

function fail(message) {
  console.error(`render-scene: ${message}`);
  process.exit(1);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function probe(video) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_frames,r_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      video,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    fail(`ffprobe 失败: ${result.stderr}\n  video: ${video}`);
  return JSON.parse(result.stdout);
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    out: { type: "string" },
    "skip-dryrun": { type: "boolean" },
    "budget-ms": { type: "string" },
  },
});
if (!values.project || !values.out)
  fail(
    "用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir> [--skip-dryrun] [--budget-ms 500]",
  );

const projectPath = path.resolve(values.project);
const outDir = path.resolve(values.out);
mkdirSync(outDir, { recursive: true });

// 1. 读项目 + 校验
let project;
try {
  project = validateVideoProject(JSON.parse(readFileSync(projectPath, "utf8")));
} catch (error) {
  fail(`项目校验失败: ${error.message}`);
}

// 2. 全镜头 working version 的 spec（多镜头整片；单镜头是 N=1 特例）
const shotEntries = project.shots.map((shot, index) => {
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  if (!version) fail(`镜头 ${index + 1} 缺少 working version`);
  if (version.sceneSource.type !== "spec")
    fail(`镜头 ${index + 1} 的 sceneSource 不是 spec（出片仅支持 spec 镜头）`);
  let spec;
  try {
    spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
  } catch (error) {
    fail(`镜头 ${index + 1} scene_spec 校验失败: ${error.message}`);
  }
  if (spec.durationMs !== version.durationMs)
    fail(
      `镜头 ${index + 1} spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${version.durationMs}) 不一致`,
    );
  return { shot, version, spec };
});
if (shotEntries.length === 0) fail("项目没有镜头，无法出片");

// 3. 帧图（累计边界量化）+ 字体指纹 + 浏览器标识（ADR §2.5 确定性输入）
const timeline = quantizeTimeline(
  shotEntries.map((entry) => entry.version.durationMs),
  FPS,
);
const totalFrames = timeline.totalFrames;
const fontDigests = {
  "NotoSansSC-Regular.woff": sha256(readFileSync(path.join(ROOT, FONT_REL))),
};
const contentDigests = shotEntries.map((entry) =>
  sha256(canonicalJson(entry.version)),
);
// 实际渲染用的浏览器：显式传了 Chrome 就记其版本，否则是 Remotion 自带 headless shell
const browser = browserLabel(existsSync(CHROME) ? CHROME : "");

// 3.5 逐帧干跑门禁（P2-A 补齐）：超时/抛错/超节点预算在出片前拦截
if (!values["skip-dryrun"]) {
  const budgetMs = values["budget-ms"]
    ? Number(values["budget-ms"])
    : DEFAULT_BUDGET_MS;
  const { jobs } = await buildProjectDryRunJobs(project);
  console.log(
    `[render-scene] 干跑 ${totalFrames} 帧（预算 ${budgetMs}ms/帧）…`,
  );
  const dryRun = await dryRunJobs(jobs, { budgetMs });
  if (!dryRun.ok) {
    fail(
      `逐帧干跑失败: ${dryRun.failures
        .map((item) => `${item.label} 第 ${item.frame} 帧 ${item.reason}`)
        .join("; ")}`,
    );
  }
  console.log("[render-scene] 干跑全部通过");
}

// 4. 逐 aspect 渲染整片 + ffprobe 校验
const aspects = project.brief.aspectTargets;
const manifest = {
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  remotion: remotionVersion,
  browser,
  fontDigests,
  aspects: {},
};
// Timeline props：量化帧图 + 逐镜头 spec（TimelineScene 要求 spans 连续无缝）
const timelineProps = {
  shots: timeline.shots.map((span) => ({
    spec: shotEntries[span.shotIndex].spec,
    startFrame: span.startFrame,
    frames: span.frames,
  })),
};

for (const aspect of aspects) {
  const compositionId = `Timeline-${aspect === "landscape" ? "Landscape" : "Portrait"}`;
  const videoPath = path.join(outDir, `${aspect}.mp4`);
  const propsPath = path.join(outDir, `props-${aspect}.json`);
  writeFileSync(propsPath, JSON.stringify(timelineProps));

  const command = [
    "--filter",
    "@acs/remotion-engine",
    "exec",
    "remotion",
    "render",
    "src/index.ts",
    compositionId,
    videoPath,
    `--props=${propsPath}`,
    "--codec=h264",
    "--crf=18",
    "--pixel-format=yuv420p",
    "--image-format=png",
    "--color-space=bt709",
    "--concurrency=2",
  ];
  // 与 render_form01.py 同款回退：系统 Chrome 存在就用它（Remotion 自带 headless shell 需额外下载）
  if (existsSync(CHROME)) {
    command.push(`--browser-executable=${CHROME}`);
  }
  console.log(`[render-scene] ${aspect}: ${compositionId} → ${videoPath}`);
  // shell:true 下 spawnSync 不做引号拼接（"Program Files" 会被拆开），手动补引号
  const quote = (arg) => (/\s/.test(arg) ? `"${arg}"` : arg);
  const render = spawnSync("pnpm", command.map(quote), {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const logPath = path.join(outDir, `${aspect}.log`);
  writeFileSync(logPath, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
  if (render.status !== 0) fail(`Remotion 渲染失败，见 ${logPath}`);

  // ffprobe 参数核对
  const metadata = probe(videoPath);
  const stream = metadata.streams?.[0];
  const [width, height] = DIMENSIONS[aspect];
  const durationSeconds = Number(metadata.format?.duration);
  if (
    stream?.codec_name !== "h264" ||
    stream?.width !== width ||
    stream?.height !== height ||
    Number(stream.nb_frames) !== totalFrames ||
    stream.r_frame_rate !== `${FPS}/1` ||
    Math.abs(durationSeconds - totalFrames / FPS) > 0.05
  ) {
    fail(
      `${aspect}.mp4 元数据不符: ${JSON.stringify(metadata)}（期望 ${width}x${height}, ${totalFrames}帧, ${FPS}fps）`,
    );
  }

  manifest.aspects[aspect] = {
    registryVersion: defaultRegistry.version,
    fps: FPS,
    width,
    height,
    frames: totalFrames,
    output: path.relative(outDir, videoPath),
    // frameMap：整片帧图 → 逐镜头 span 与内容指纹（RenderRecord 一一对应）
    frameMap: timeline.shots.map((span) => ({
      shotIndex: span.shotIndex,
      shotId: shotEntries[span.shotIndex].shot.shotId,
      versionId: shotEntries[span.shotIndex].version.versionId,
      componentId: shotEntries[span.shotIndex].spec.componentId,
      startFrame: span.startFrame,
      frames: span.frames,
      contentDigest: contentDigests[span.shotIndex],
    })),
  };

  // RenderRecord 追加：每画幅 × 每镜头一条（frames = 该镜头 span，输出为整片）
  // 输出路径相对项目文件，便于本地找回
  const outputAssetRef = path
    .relative(path.dirname(projectPath), videoPath)
    .split(path.sep)
    .join("/");
  for (const span of timeline.shots) {
    const entry = shotEntries[span.shotIndex];
    project.renderRecords.push({
      renderId: randomUUID(),
      versionId: entry.version.versionId,
      contentDigest: contentDigests[span.shotIndex],
      engineId: "remotion",
      engineVersion: String(defaultRegistry.version),
      rendererVersion: remotionVersion,
      browser,
      fps: FPS,
      width,
      height,
      codec: "h264",
      frames: span.frames,
      fontDigests,
      outputAssetRef,
    });
  }
}

// 5. 回写项目（追加后重校验 + savedVersion 递增）
project.savedVersion += 1;
validateVideoProject(project);
writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
writeFileSync(
  path.join(outDir, "render-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `[render-scene] 完成: ${aspects.map((a) => `${a}.mp4`).join(", ")}（${shotEntries.length} 镜头 × ${aspects.length} 画幅）; RenderRecord x${shotEntries.length * aspects.length} 已回写 ${path.basename(projectPath)} (savedVersion=${project.savedVersion})`,
);
