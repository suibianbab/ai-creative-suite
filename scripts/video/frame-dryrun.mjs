#!/usr/bin/env node
// 逐帧干跑门禁（P2-A 补齐，ADR 0003 §2.4 资源上限的运行时侧）：
// 出片前对每 (镜头×帧) 在 worker 隔离里执行 render，单帧预算默认 500ms，
// 超时（同步死循环）/抛错/模块加载失败 → 非零退出并点名镜头与帧。
// 用法: node scripts/video/frame-dryrun.mjs --project <path.json> [--budget-ms 500]
// 依赖: packages/{video-document,video-scene} 已 build。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
// Worker 构造器要绝对路径（file:// URL 在 Windows 上被拒），动态 import 要 file:// URL
const WORKER_PATH = path.join(HERE, "frame-dryrun-worker.mjs");
const SPEC_FRAME_RENDERER_URL = pathToFileURL(
  path.join(HERE, "spec-frame-renderer.mjs"),
).href;
export const DEFAULT_BUDGET_MS = 500;

export const DRY_RUN_FPS = 24;

// jobs: Array<{ label: string; frames: number; moduleUrl: string; fn: string; args: unknown }>
// → { ok: boolean; failures: Array<{ label: string; frame: number; reason: string }> }
export function dryRunJobs(jobs, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
  return new Promise((resolve) => {
    const failures = [];
    const worker = new Worker(WORKER_PATH, { workerData: { jobs } });
    let timer = null;
    let current = null; // 最近一个 frame-start（超时/崩溃时点名用）
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve({ ok: failures.length === 0, failures });
    };
    worker.on("message", (message) => {
      if (message.type === "frame-start") {
        current = { label: message.label, frame: message.frame };
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          failures.push({
            ...current,
            reason: `单帧渲染超过 ${budgetMs}ms 预算（worker 已终止）`,
          });
          finish();
        }, budgetMs);
      } else if (message.type === "frame-done") {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        current = null;
      } else if (message.type === "frame-error") {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        failures.push({
          label: message.label,
          frame: message.frame,
          reason: message.message,
        });
        current = null;
      } else if (message.type === "all-done") {
        finish();
      }
    });
    worker.on("error", (error) => {
      failures.push({
        label: current?.label ?? "（未知镜头）",
        frame: current?.frame ?? 0,
        reason: `worker 异常: ${error.message}`,
      });
      finish();
    });
    worker.on("exit", (code) => {
      if (!settled) {
        failures.push({
          label: current?.label ?? "（未知镜头）",
          frame: current?.frame ?? 0,
          reason: `worker 提前退出（code ${code}）`,
        });
        finish();
      }
    });
  });
}

// 项目 → 干跑 jobs：帧数取量化帧图的 span（与出片一致）。
// 返回 { jobs, timeline }；镜头不满足出片前提时抛带人话的错误。
// P2.5-T4（D1）：帧图量化覆盖全部镜头（帧保真——媒体镜头占位帧数与出片
// 一致），干跑作业只给 spec span（媒体渲染在 render-scene 走 OffthreadVideo，
// 无需 spec 干跑）；全媒体项目 → 空 jobs 合法。未知类型大声抛错（未来通道
// 接入时显式改）。
// P3-B Task 4：three 镜头与媒体同待遇——3D 画面由烘焙门禁（bake-three）覆盖，
// 干跑不产 SVG 作业；帧图量化仍为其占位（span 与出片一致）。
export async function buildProjectDryRunJobs(project) {
  const { quantizeTimeline } = await import(
    pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
  );
  const entries = [];
  project.shots.forEach((shot, index) => {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) throw new Error(`镜头 ${index + 1} 缺少 working version`);
    entries.push({ version, label: `镜头 ${index + 1}` });
  });
  if (entries.length === 0) throw new Error("项目没有镜头，无帧可干跑");
  const timeline = quantizeTimeline(
    entries.map((entry) => entry.version.durationMs),
    DRY_RUN_FPS,
  );
  const jobs = [];
  for (const span of timeline.shots) {
    const entry = entries[span.shotIndex];
    const sceneSource = entry.version.sceneSource;
    if (sceneSource.type === "spec") {
      jobs.push({
        label: `${entry.label}（${span.frames} 帧）`,
        frames: span.frames,
        moduleUrl: SPEC_FRAME_RENDERER_URL,
        fn: "renderSpecFrame",
        args: {
          spec: sceneSource.spec,
          fps: DRY_RUN_FPS,
          durationFrames: span.frames,
          width: 1280,
          height: 720,
        },
      });
    } else if (
      sceneSource.type !== "media-clip" &&
      sceneSource.type !== "three"
    ) {
      throw new Error(
        `镜头 ${span.shotIndex + 1} 的 sceneSource 既非 spec、media-clip 也非 three`,
      );
    }
  }
  return { jobs, timeline };
}

// —— CLI 入口 ——
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      "budget-ms": { type: "string" },
    },
  });
  if (!values.project) {
    console.error(
      "用法: node scripts/video/frame-dryrun.mjs --project <path.json> [--budget-ms 500]",
    );
    process.exit(1);
  }
  const { validateVideoProject } = await import(
    pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
  );
  const budgetMs = values["budget-ms"]
    ? Number(values["budget-ms"])
    : DEFAULT_BUDGET_MS;
  try {
    const projectPath = path.resolve(values.project);
    if (!existsSync(projectPath)) throw new Error(`文件不存在: ${projectPath}`);
    const project = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
    const { jobs, timeline } = await buildProjectDryRunJobs(project);
    console.log(
      `[frame-dryrun] 干跑 ${timeline.totalFrames} 帧（预算 ${budgetMs}ms/帧）…`,
    );
    if (jobs.length === 0)
      console.log(
        "[frame-dryrun] 干跑 0 作业（镜头全部为媒体或 3D，出片走 render-scene）",
      );
    const result = await dryRunJobs(jobs, { budgetMs });
    if (!result.ok) {
      for (const failure of result.failures) {
        console.error(
          `[frame-dryrun] ${failure.label} 第 ${failure.frame} 帧: ${failure.reason}`,
        );
      }
      process.exit(1);
    }
    console.log("[frame-dryrun] 全部帧通过");
  } catch (error) {
    console.error(`frame-dryrun: ${error.message}`);
    process.exit(1);
  }
}
