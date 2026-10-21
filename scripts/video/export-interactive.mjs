#!/usr/bin/env node
// P3-A 交互交付（spec R1/R2/R4/R5/R6）：项目全部 spec 镜头按顺序成为步骤，
// 每步用既有 SVG 翻页册采样后拼进单个自包含 index.html，并落 DeliveryRecord。
// 纯函数只算不写盘；CLI 成功写 <out>/index.html、追加交付、回写项目。
// 用法: node scripts/video/export-interactive.mjs --project <path.json> [--out <dir>] [--fps 12] [--aspect landscape|portrait]
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      frameCount = sampledFrameCount(durationFrames, fps, RENDER_FPS);
      // 提前换成 CLI 自己的话术：buildAnimatedSvg 的原文推荐 --frame，本 CLI 没有该选项。
      if (frameCount < 2)
        throw new Error(
          `采样帧数 ${frameCount} 不足 2，请提高 --fps 或延长镜头时长`,
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
  // parseArgs 的未知参数异常会带 ERR_PARSE_ARGS_* 堆栈；统一收口成 CLI 中文前缀。
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        project: { type: "string" },
        out: { type: "string" },
        fps: { type: "string", default: "12" },
        aspect: { type: "string", default: "landscape" },
      },
    }));
  } catch (error) {
    fail(`参数解析失败: ${error.message}`);
  }
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

  // 输出目标在构建前就确定：若项目文件恰好是 <out>/index.html，落账与两次
  // rename 会让账本和产物互相覆盖（第二次 rename 用项目 JSON 覆盖刚写出的
  // HTML），所以必须在 appendDelivery 与任何写盘之前失败。
  const outDir = path.resolve(values.out ?? path.dirname(projectPath));
  const htmlPath = path.join(outDir, "index.html");
  // 只比路径字符串；软/硬链接别名未覆盖（挂账，不做真实身份检查）。
  const comparablePath = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (comparablePath(projectPath) === comparablePath(htmlPath)) {
    fail(
      "--project 与输出冲突: 项目文件不能是 <out>/index.html，请改 --out 或重命名项目文件",
    );
  }

  let result;
  try {
    result = buildInteractiveExport({ project, fps, aspect });
  } catch (error) {
    fail(error.message);
  }

  // 先落账校验、后写盘（P3-A 修复 I-2）：appendDelivery 会重校验项目，
  // 1000 条交付上限等失败必须发生在任何文件被改写之前。
  let next;
  let delivery;
  try {
    ({ project: next, delivery } = appendDelivery(project, {
      versionIds: result.versionIds,
      renderIds: [],
      frameMap: result.frameMap,
      kind: "interactive-html",
      outputRef: "index.html",
      digest: result.digest,
    }));
  } catch (error) {
    fail(`落账失败: ${error.message}`);
  }

  // 写入临时文件再 rename（同卷覆盖原子）：两步都成功才算交付成功；项目
  // rename 失败时把 index.html 恢复成旧字节（原本不存在则删除新产物）。
  const htmlTmp = path.join(outDir, `.index.html.${randomUUID()}.tmp`);
  const projectTmp = `${projectPath}.${randomUUID()}.tmp`;
  let writeError;
  try {
    mkdirSync(outDir, { recursive: true });
    let previousHtml;
    try {
      previousHtml = readFileSync(htmlPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    writeFileSync(htmlTmp, result.html);
    writeFileSync(projectTmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(htmlTmp, htmlPath);
    try {
      renameSync(projectTmp, projectPath);
    } catch (projectError) {
      if (previousHtml === undefined) {
        rmSync(htmlPath, { force: true });
      } else {
        // 恢复也走「临时文件 + rename」，避免原地截断写一半留下坏 HTML。
        const restoreTmp = path.join(
          outDir,
          `.index.html.${randomUUID()}.restore.tmp`,
        );
        try {
          writeFileSync(restoreTmp, previousHtml);
          renameSync(restoreTmp, htmlPath);
        } catch (restoreError) {
          throw new Error(
            `恢复旧 index.html 失败（项目写入失败: ${projectError.message}）: ${restoreError.message}`,
          );
        } finally {
          rmSync(restoreTmp, { force: true });
        }
      }
      throw projectError;
    }
  } catch (error) {
    writeError = error;
  } finally {
    rmSync(htmlTmp, { force: true });
    rmSync(projectTmp, { force: true });
  }
  if (writeError) fail(`写盘失败: ${writeError.message}`);
  const totalFrames = result.frameMap.reduce((sum, frames) => sum + frames, 0);
  console.log(
    `[export-interactive] 完成: ${htmlPath}（${result.versionIds.length} 步, 共 ${totalFrames} 帧, ${Buffer.byteLength(result.html, "utf8")} 字节）; DeliveryRecord ${delivery.deliveryId.slice(0, 8)} 已回写 ${path.basename(projectPath)} (savedVersion=${next.savedVersion})`,
  );
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) await main();
