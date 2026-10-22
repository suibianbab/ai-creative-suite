#!/usr/bin/env node
// D4 导出扩充（spec R2）：单镜头声明式场景 → 独立 SVG 文件。动画模式（--fps，
// 默认 12）出 CSS 翻页册；--frame <0 基> 出静态单帧。DeliveryRecord 落档
// （renderIds 为空数组——SVG 直出，不派生自任何 MP4 渲染）。
// 用法: node scripts/video/export-shot-svg.mjs --project <path.json> --shot <1 基序号> [--fps 12 | --frame 24] [--aspect landscape|portrait] [--out <dir>]
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appendDelivery, commitDeliveryFiles } from "./delivery.mjs";
import { buildAnimatedSvg, buildStaticSvg } from "./svg-serialize.mjs";

const RENDER_FPS = 24;
const FPS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];
const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { assertNodeBudget, defaultRegistry, seededRandom, validateSceneSpec } =
  await import(
    pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
  );

export function resolveShot(project, shotNumber) {
  const shot = project.shots[shotNumber - 1];
  if (!shot)
    throw new Error(
      `--shot ${shotNumber} 越界（合法 1..${project.shots.length}）`,
    );
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  if (!version) throw new Error(`镜头 ${shotNumber} 缺少 working version`);
  if (version.sceneSource.type !== "spec")
    throw new Error(
      `镜头 ${shotNumber} 的场景源不是 spec（仅 spec 场景源镜头可导出 SVG）`,
    );
  return { shot, version };
}

export function shotFrames(durationMs, fps = RENDER_FPS) {
  return quantizeTimeline([durationMs], fps).shots[0].frames;
}

export function sampledFrameCount(durationFrames, fps, renderFps = RENDER_FPS) {
  if (!FPS_CHOICES.includes(fps))
    throw new Error(
      `--fps ${fps} 不整除渲染帧率 ${renderFps}，合法值: ${FPS_CHOICES.join("/")}`,
    );
  return Math.ceil(durationFrames / (renderFps / fps));
}

// —— CLI 主路径（纯逻辑以上，测试只碰纯逻辑；直接运行才执行） ——

function fail(message) {
  throw new Error(message);
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      shot: { type: "string" },
      fps: { type: "string" },
      frame: { type: "string" },
      aspect: { type: "string", default: "landscape" },
      out: { type: "string" },
    },
  });
  if (!values.project || !values.shot)
    fail(
      "用法: node scripts/video/export-shot-svg.mjs --project <path.json> --shot <1 基序号> [--fps 12 | --frame 24] [--aspect landscape|portrait] [--out <dir>]",
    );
  const shotNumber = Number(values.shot);
  if (!Number.isInteger(shotNumber))
    fail(`--shot 必须是整数，收到 ${values.shot}`);
  const aspect = values.aspect;
  if (!(aspect in DIMENSIONS))
    fail(`--aspect 只认 landscape/portrait，收到 ${aspect}`);
  const [width, height] = DIMENSIONS[aspect];

  const projectPath = path.resolve(values.project);
  let project;
  try {
    project = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
  } catch (error) {
    fail(`项目校验失败: ${error.message}`);
  }

  let version;
  try {
    ({ version } = resolveShot(project, shotNumber));
  } catch (error) {
    fail(error.message);
  }

  let spec;
  try {
    spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
  } catch (error) {
    fail(`镜头 ${shotNumber} scene_spec 校验失败: ${error.message}`);
  }
  if (spec.durationMs !== version.durationMs)
    fail(
      `镜头 ${shotNumber} spec.durationMs(${spec.durationMs}) 与版本时长(${version.durationMs})不一致，先在工作台修订对齐`,
    );

  const durationFrames = shotFrames(version.durationMs);
  const fps =
    values.frame !== undefined ? undefined : Number(values.fps ?? "12");
  // 采样步长：动画模式 RENDER_FPS/fps；静态模式只取指定帧（index 不参与）。
  const step = fps === undefined ? 1 : RENDER_FPS / fps;
  const renderFrame = (index) => {
    const node = defaultRegistry
      .get(spec.componentId, spec.componentVersion)
      .render(spec, {
        frame: Math.round(index * step),
        fps: RENDER_FPS,
        durationFrames,
        width,
        height,
        random: seededRandom(spec.seed),
      });
    assertNodeBudget(node);
    return node;
  };

  const outDir = path.resolve(values.out ?? path.dirname(projectPath));
  mkdirSync(outDir, { recursive: true });
  let svgPath;
  let result;
  try {
    if (values.frame !== undefined) {
      const frame = Number(values.frame);
      if (!Number.isInteger(frame) || frame < 0 || frame >= durationFrames)
        fail(`--frame ${values.frame} 越界（合法 0..${durationFrames - 1}）`);
      result = buildStaticSvg({
        renderFrame: () => renderFrame(frame),
        frame,
        width,
        height,
        background: spec.background,
      });
      svgPath = path.join(outDir, `shot-${shotNumber}-frame-${frame}.svg`);
    } else {
      const frameCount = sampledFrameCount(durationFrames, fps);
      result = buildAnimatedSvg({
        renderFrame,
        frameCount,
        fps,
        width,
        height,
        background: spec.background,
      });
      svgPath = path.join(outDir, `shot-${shotNumber}-animated-${fps}fps.svg`);
    }
  } catch (error) {
    fail(error.message);
  }
  const stagedSvgPath = path.join(
    outDir,
    `.${path.basename(svgPath)}.${randomUUID()}.tmp.svg`,
  );
  try {
    writeFileSync(stagedSvgPath, result.svg);
    const digest = createHash("sha256")
      .update(readFileSync(stagedSvgPath))
      .digest("hex");
    const { project: next, delivery } = appendDelivery(project, {
      versionIds: [version.versionId],
      renderIds: [],
      frameMap: [
        values.frame !== undefined ? 1 : sampledFrameCount(durationFrames, fps),
      ],
      kind: "shot-svg",
      outputRef: path.basename(svgPath),
      digest,
    });
    commitDeliveryFiles({
      stagedOutputPath: stagedSvgPath,
      outputPath: svgPath,
      projectPath,
      nextProject: next,
    });
    console.log(
      `[export-shot-svg] 完成: ${svgPath}（${result.totalNodes} 节点）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 (savedVersion=${next.savedVersion})`,
    );
  } finally {
    rmSync(stagedSvgPath, { force: true });
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain)
  await main().catch((error) => {
    console.error(`[export-shot-svg] ${error.message}`);
    process.exitCode = 1;
  });
