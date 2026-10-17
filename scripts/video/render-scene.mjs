#!/usr/bin/env node
// P0 出片脚本：项目 JSON → 双尺寸 MP4 + render-manifest.json + RenderRecord 回写。
// 用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir>
// 依赖: packages/{video-document,video-scene} 已 build（pnpm -r build）；ffprobe 在 PATH。
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { browserLabel } from "./env-info.mjs";

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
  },
});
if (!values.project || !values.out)
  fail(
    "用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir>",
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

// 2. P0 单镜头 + working version 的 spec
if (project.shots.length !== 1)
  fail(`P0 出片脚本仅支持单镜头项目，当前 ${project.shots.length} 个镜头`);
const shot = project.shots[0];
const version = shot.contentVersions.find(
  (candidate) => candidate.versionId === shot.workingVersionId,
);
if (version.sceneSource.type !== "spec")
  fail('P0 仅支持 sceneSource.type === "spec" 的镜头');
let spec;
try {
  spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
} catch (error) {
  fail(`scene_spec 校验失败: ${error.message}`);
}
if (spec.durationMs !== version.durationMs)
  fail(
    `spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${version.durationMs}) 不一致`,
  );

// 3. 帧数（累计边界量化）+ 字体指纹 + 浏览器标识（ADR §2.5 确定性输入）
const totalFrames = quantizeTimeline([version.durationMs], FPS).totalFrames;
const fontDigests = {
  "NotoSansSC-Regular.woff": sha256(readFileSync(path.join(ROOT, FONT_REL))),
};
const specDigest = sha256(canonicalJson(spec));
const contentDigest = sha256(canonicalJson(version));
// 实际渲染用的浏览器：显式传了 Chrome 就记其版本，否则是 Remotion 自带 headless shell
const browser = browserLabel(existsSync(CHROME) ? CHROME : "");

// 4. 逐 aspect 渲染 + ffprobe 校验
const aspects = project.brief.aspectTargets;
const manifest = {
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  versionId: version.versionId,
  remotion: remotionVersion,
  browser,
  fontDigests,
  aspects: {},
};

for (const aspect of aspects) {
  const compositionId = `SceneSpec-${aspect === "landscape" ? "Landscape" : "Portrait"}`;
  const videoPath = path.join(outDir, `${aspect}.mp4`);
  const propsPath = path.join(outDir, `props-${aspect}.json`);
  writeFileSync(propsPath, JSON.stringify({ spec }));

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
    specDigest,
    registryVersion: defaultRegistry.version,
    componentId: spec.componentId,
    componentVersion: spec.componentVersion,
    fps: FPS,
    width,
    height,
    frames: totalFrames,
    output: path.relative(outDir, videoPath),
  };

  // RenderRecord 追加（输出路径相对项目文件，便于本地找回）
  project.renderRecords.push({
    renderId: randomUUID(),
    versionId: version.versionId,
    contentDigest,
    engineId: "remotion",
    engineVersion: String(defaultRegistry.version),
    rendererVersion: remotionVersion,
    browser,
    fps: FPS,
    width,
    height,
    codec: "h264",
    frames: totalFrames,
    fontDigests,
    outputAssetRef: path
      .relative(path.dirname(projectPath), videoPath)
      .split(path.sep)
      .join("/"),
  });
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
  `[render-scene] 完成: ${aspects.map((a) => `${a}.mp4`).join(", ")}; RenderRecord x${aspects.length} 已回写 ${path.basename(projectPath)} (savedVersion=${project.savedVersion})`,
);
