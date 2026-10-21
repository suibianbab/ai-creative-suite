#!/usr/bin/env node
// P3-A 交互交付（spec R1/R2/R4/R5/R6）：项目全部 spec 镜头按顺序成为步骤，
// 每步用既有 SVG 翻页册采样后拼进单个自包含 index.html，并落 DeliveryRecord。
// 纯函数只算不写盘；CLI 成功写 <out>/index.html、追加交付、回写项目。
// 用法: node scripts/video/export-interactive.mjs --project <path.json> [--out <dir>] [--fps 12] [--aspect landscape|portrait]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { appendDelivery, validateVideoProject } from "./delivery.mjs";
import { sampledFrameCount } from "./export-shot-svg.mjs";
import { buildPlayerHtml } from "./interactive-player.mjs";
import { buildAnimatedSvg } from "./svg-serialize.mjs";

// 与出片/其他导出同口径（render-scene.mjs 为 24fps）。
const RENDER_FPS = 24;
export const FPS_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];
export const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { quantizeTimeline } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { assertNodeBudget, defaultRegistry, seededRandom, validateSceneSpec } =
  await import(
    pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
  );

export function buildInteractiveExport({
  project,
  fps = 12,
  aspect = "landscape",
}) {
  if (!Object.hasOwn(DIMENSIONS, aspect))
    throw new Error(`--aspect 只认 landscape/portrait，收到 ${aspect}`);
  // 在渲染前拒绝非整除帧率：避免白跑一遍各镜头采样才报参数错。
  if (!FPS_CHOICES.includes(fps))
    throw new Error(
      `--fps ${fps} 不整除渲染帧率 ${RENDER_FPS}，合法值: ${FPS_CHOICES.join("/")}`,
    );
  const [width, height] = DIMENSIONS[aspect];
  const versionIds = [];
  const frameMap = [];
  const steps = [];

  // spec R2：步骤顺序由 shots[].order 决定，数组序只保证 order 唯一（validate.ts）。
  const ordered = [...project.shots].sort((a, b) => a.order - b.order);
  for (const [index, shot] of ordered.entries()) {
    const shotNumber = index + 1;
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) throw new Error(`镜头 ${shotNumber} 缺少 working version`);
    if (version.sceneSource.type !== "spec")
      throw new Error(
        `镜头 ${shotNumber} 的场景源不是 spec（${version.sceneSource.type}），P3-A 交互交付不支持`,
      );
    let spec;
    try {
      spec = validateSceneSpec(version.sceneSource.spec, defaultRegistry);
    } catch (error) {
      throw new Error(
        `镜头 ${shotNumber} scene_spec 校验失败: ${error.message}`,
      );
    }
    if (spec.durationMs !== version.durationMs)
      throw new Error(
        `镜头 ${shotNumber} spec.durationMs(${spec.durationMs}) 与版本时长(${version.durationMs})不一致，先在工作台修订对齐`,
      );

    let frameCount;
    let svg;
    try {
      const durationFrames = quantizeTimeline([version.durationMs], RENDER_FPS)
        .shots[0].frames;
      frameCount = sampledFrameCount(durationFrames, fps);
      // 提前换成 CLI 自己的话术：buildAnimatedSvg 的原文推荐 --frame，本 CLI 没有该选项。
      if (frameCount < 2)
        throw new Error(
          `采样帧数 ${frameCount} 不足 2，请降低 --fps 或延长镜头时长`,
        );
      const step = RENDER_FPS / fps;
      // 与 export-shot-svg.mjs 同一帧口径：量化帧号 + 注册表渲染 + 节点预算。
      const renderFrame = (frameIndex) => {
        const node = defaultRegistry
          .get(spec.componentId, spec.componentVersion)
          .render(spec, {
            frame: Math.round(frameIndex * step),
            fps: RENDER_FPS,
            durationFrames,
            width,
            height,
            random: seededRandom(spec.seed),
          });
        assertNodeBudget(node);
        return node;
      };
      ({ svg } = buildAnimatedSvg({
        renderFrame,
        frameCount,
        fps,
        width,
        height,
        background: spec.background,
      }));
    } catch (error) {
      // 逐镜头上下文：渲染/采样失败必须指名镜头号，否则多镜头项目无从定位。
      throw new Error(`镜头 ${shotNumber} 渲染失败: ${error.message}`);
    }

    steps.push({ svg });
    versionIds.push(version.versionId);
    frameMap.push(frameCount);
  }

  const html = buildPlayerHtml({ title: project.title, width, height, steps });
  const digest = createHash("sha256").update(html, "utf8").digest("hex");
  return { html, versionIds, frameMap, digest };
}

// —— CLI 主路径（纯逻辑以上，测试只碰纯逻辑；直接运行才执行） ——

function fail(message) {
  console.error(`[export-interactive] ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      out: { type: "string" },
      fps: { type: "string", default: "12" },
      aspect: { type: "string", default: "landscape" },
    },
  });
  if (!values.project)
    fail(
      "用法: node scripts/video/export-interactive.mjs --project <path.json> [--out <dir>] [--fps 12] [--aspect landscape|portrait]",
    );
  const fps = Number(values.fps);
  if (!Number.isInteger(fps)) fail(`--fps 必须是整数，收到 ${values.fps}`);
  const aspect = values.aspect;
  if (!Object.hasOwn(DIMENSIONS, aspect))
    fail(`--aspect 只认 landscape/portrait，收到 ${aspect}`);

  const projectPath = path.resolve(values.project);
  let project;
  try {
    project = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
  } catch (error) {
    fail(`项目校验失败: ${error.message}`);
  }

  let result;
  try {
    result = buildInteractiveExport({ project, fps, aspect });
  } catch (error) {
    fail(error.message);
  }

  const outDir = path.resolve(values.out ?? path.dirname(projectPath));
  mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, "index.html");
  writeFileSync(htmlPath, result.html);

  const { project: next, delivery } = appendDelivery(project, {
    versionIds: result.versionIds,
    renderIds: [],
    frameMap: result.frameMap,
    kind: "interactive-html",
    outputRef: "index.html",
    digest: result.digest,
  });
  writeFileSync(projectPath, `${JSON.stringify(next, null, 2)}\n`);
  const totalFrames = result.frameMap.reduce((sum, frames) => sum + frames, 0);
  console.log(
    `[export-interactive] 完成: ${htmlPath}（${result.versionIds.length} 步, 共 ${totalFrames} 帧, ${Buffer.byteLength(result.html, "utf8")} 字节）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 ${path.basename(projectPath)} (savedVersion=${next.savedVersion})`,
  );
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) await main();
