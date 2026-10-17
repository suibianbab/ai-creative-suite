#!/usr/bin/env node
// 确定性 fitness function（ADR 0003）：同一 spec 双渲染 PNG 序列，逐帧 sha256 对比。
// 口径是解码后的帧，不是容器字节——编码器版本/线程调度不进确定性契约。
// 用法: node scripts/video/verify-determinism.mjs [--project <path.json>]
// exit 0 = 同输入集两次渲染逐帧一致；exit 1 = 帧数不符或存在差异帧（打印首个差异）。
// 依赖: packages/{video-document,video-scene} 已 build；输出目录在 artifacts/（gitignored）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FONT_REL =
  "packages/remotion-engine/src/assets/fonts/NotoSansSC-Regular.woff";
const FPS = 24;
const ASPECT = "landscape"; // 双尺寸由 render-scene 出片核对，这里抽查一个 aspect 即可
const DEFAULT_PROJECT = path.join(
  ROOT,
  "artifacts/video-studio-smoke/project.json",
);
const OUT_BASE = path.join(ROOT, "artifacts/video-studio-determinism");

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
  console.error(`verify-determinism: ${message}`);
  process.exit(1);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

const { values } = parseArgs({
  options: { project: { type: "string" } },
});
const projectPath = path.resolve(values.project ?? DEFAULT_PROJECT);

// 1. 读项目 → working version 的 spec（与 render-scene 同一套前置校验，只读不回写）
let project;
try {
  project = validateVideoProject(JSON.parse(readFileSync(projectPath, "utf8")));
} catch (error) {
  fail(`项目校验失败: ${error.message}`);
}
if (project.shots.length !== 1)
  fail(`仅支持单镜头项目，当前 ${project.shots.length} 个镜头`);
const shot = project.shots[0];
const version = shot.contentVersions.find(
  (candidate) => candidate.versionId === shot.workingVersionId,
);
if (version.sceneSource.type !== "spec")
  fail('仅支持 sceneSource.type === "spec" 的镜头');
let spec;
try {
  spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
} catch (error) {
  fail(`scene_spec 校验失败: ${error.message}`);
}

const totalFrames = quantizeTimeline([spec.durationMs], FPS).totalFrames;
mkdirSync(OUT_BASE, { recursive: true });
const propsPath = path.join(OUT_BASE, "props.json");
writeFileSync(propsPath, JSON.stringify({ spec })); // 两次渲染共用同一份 props：同输入集

// 2. 渲染函数：PNG 序列到目录
function renderOnce(runDir, logPath) {
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const command = [
    "--filter",
    "@acs/remotion-engine",
    "exec",
    "remotion",
    "render",
    "src/index.ts",
    `SceneSpec-${ASPECT === "landscape" ? "Landscape" : "Portrait"}`,
    runDir,
    `--props=${propsPath}`,
    "--sequence",
    "--image-format=png",
    "--concurrency=2",
    "--overwrite",
  ];
  if (existsSync(CHROME)) {
    command.push(`--browser-executable=${CHROME}`);
  }
  // shell:true 下 spawnSync 不做引号拼接（"Program Files" 会被拆开），手动补引号
  const quote = (arg) => (/\s/.test(arg) ? `"${arg}"` : arg);
  const render = spawnSync("pnpm", command.map(quote), {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  writeFileSync(logPath, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
  if (render.status !== 0) fail(`Remotion 渲染失败，见 ${logPath}`);
}

function frameFiles(runDir) {
  return readdirSync(runDir)
    .filter((name) => name.endsWith(".png"))
    .sort(); // Remotion 序列帧名零填充，字典序即帧序
}

console.log(
  `[verify-determinism] 双渲染 ${totalFrames} 帧 PNG 序列（${ASPECT}）...`,
);
renderOnce(path.join(OUT_BASE, "run-a"), path.join(OUT_BASE, "run-a.log"));
renderOnce(path.join(OUT_BASE, "run-b"), path.join(OUT_BASE, "run-b.log"));

// 3. 逐帧对比（帧数 + sha256）
const framesA = frameFiles(path.join(OUT_BASE, "run-a"));
const framesB = frameFiles(path.join(OUT_BASE, "run-b"));
if (framesA.length !== totalFrames || framesB.length !== totalFrames)
  fail(
    `帧数不符: run-a=${framesA.length}, run-b=${framesB.length}, 期望 ${totalFrames}`,
  );
if (framesA.length !== framesB.length)
  fail(`两次渲染帧数不同: ${framesA.length} vs ${framesB.length}`);

for (const [index, name] of framesA.entries()) {
  const hashA = sha256(readFileSync(path.join(OUT_BASE, "run-a", name)));
  const hashB = sha256(readFileSync(path.join(OUT_BASE, "run-b", name)));
  if (hashA !== hashB)
    fail(`帧 ${index}(${name}) 不一致: ${hashA} vs ${hashB}`);
}

// 4. 输入集 manifest（确定性是「同输入集」性质，记录在案供对比跨次运行）
const manifest = {
  specDigest: sha256(canonicalJson(spec)),
  registryVersion: defaultRegistry.version,
  componentId: spec.componentId,
  componentVersion: spec.componentVersion,
  remotion: remotionVersion,
  node: process.version,
  fontDigests: {
    "NotoSansSC-Regular.woff": sha256(readFileSync(path.join(ROOT, FONT_REL))),
  },
  fps: FPS,
  frames: totalFrames,
};
console.log(
  `[verify-determinism] OK: ${framesA.length}/${framesA.length} 帧逐帧一致`,
);
console.log(
  `[verify-determinism] 输入集 manifest: ${JSON.stringify(manifest, null, 2)}`,
);
