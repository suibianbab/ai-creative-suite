// W2 风格代表帧：用真实渲染器（Remotion still + SceneSpec 组合）为选定的
// 镜头/时间点渲染横竖两版 PNG 关键帧，落内容寻址证据（SHA-256）供确认
// 账本引用。渲染命令与 render-scene.mjs 的出片路径同源（同 bundle、同
// Chrome 回退、同 props 契约），不另起第二套渲染实现。
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  EXPORT_FPS,
  quantizeTimeline,
  type StyleBible,
  type VideoProject,
} from "@acs/video-document";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import { runRender, workspaceRoot } from "../render/render-local";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/;
const STILL_TIMEOUT_MS = 120_000;
const MIN_PNG_BYTES = 100;
// 与 render-scene.mjs 同款回退：系统 Chrome 存在就用它。
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

export const MAX_STYLE_FRAMES = 30;

export type StillRenderArgs = {
  aspect: "landscape" | "portrait";
  frameIndex: number;
  outPath: string;
  propsPath: string;
};
export type StillRenderer = (args: StillRenderArgs) => Promise<void>;

export function styleFrameRoot(): string {
  return path.join(workspaceRoot(), ".tools", "video-style-frames");
}

export function styleFramePath(frameId: string, aspect: string): string {
  if (!UUID.test(frameId) || !["landscape", "portrait"].includes(aspect))
    throw new Error("无效的关键帧编号或画幅");
  return path.join(styleFrameRoot(), frameId, `${aspect}.png`);
}

export function pruneOldestStyleFrames(
  root: string,
  max = MAX_STYLE_FRAMES,
): void {
  const resolved = path.resolve(root);
  if (!existsSync(resolved)) return;
  const entries = readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      mtime: statSync(path.join(resolved, entry.name)).mtimeMs,
    }))
    .sort((left, right) => left.mtime - right.mtime);
  while (entries.length > max) {
    const oldest = entries.shift();
    if (!oldest) break;
    const target = path.resolve(resolved, oldest.name);
    if (path.dirname(target) !== resolved || !UUID.test(oldest.name))
      throw new Error("关键帧缓存清理路径无效");
    rmSync(target, { recursive: true });
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// remotion still 单帧渲染：与 render-scene.mjs 同一 CLI、同一 bundle，但直接以
// node 执行 @remotion/cli 的 JS 入口（runRender 的首参是 process.execPath）——
// Windows 下 spawn pnpm shim 不带 shell 会把参数错传给 node（bad option）。
function remotionCliEntry(root: string): string {
  const engineDir = path.join(root, "packages", "remotion-engine");
  const { createRequire } = require("node:module") as typeof import("node:module");
  const requireFromEngine = createRequire(path.join(engineDir, "index.js"));
  const pkgPath = requireFromEngine.resolve("@remotion/cli/package.json");
  return path.join(path.dirname(pkgPath), "remotion-cli.js");
}

async function defaultStillRenderer(args: StillRenderArgs): Promise<void> {
  const root = workspaceRoot();
  const engineDir = path.join(root, "packages", "remotion-engine");
  const command = [
    remotionCliEntry(root),
    "still",
    "src/index.ts",
    `SceneSpec-${args.aspect === "landscape" ? "Landscape" : "Portrait"}`,
    args.outPath,
    `--props=${args.propsPath}`,
    `--frame=${args.frameIndex}`,
    "--image-format=png",
  ];
  if (existsSync(CHROME)) command.push(`--browser-executable=${CHROME}`);
  await runRender(command, engineDir, STILL_TIMEOUT_MS);
}

export async function renderStyleFrame(
  project: VideoProject,
  _bible: StyleBible,
  options: { shotId: string; frameMs: number; renderStill?: StillRenderer },
): Promise<{
  frameId: string;
  frameIndex: number;
  keyframes: Array<{
    aspect: "landscape" | "portrait";
    url: string;
    digest: string;
    bytes: number;
    outputRef: string;
  }>;
}> {
  const shot = project.shots.find((entry) => entry.shotId === options.shotId);
  if (!shot) throw new Error(`镜头 ${options.shotId} 不存在`);
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working) throw new Error("镜头工作版本缺失");
  if (working.sceneSource.type !== "spec") {
    throw new Error(
      "代表帧只能选程序化画面镜头（媒体/3D 镜头暂不支持关键帧确认）",
    );
  }
  const spec = validateSceneSpec(working.sceneSource.spec, defaultRegistry);
  if (
    !Number.isInteger(options.frameMs) ||
    options.frameMs < 0 ||
    options.frameMs >= working.durationMs
  ) {
    throw new Error(`frameMs 须为 0..${working.durationMs - 1} 的整数毫秒`);
  }
  const frames = quantizeTimeline([working.durationMs], EXPORT_FPS).shots[0]!
    .frames;
  const frameIndex = Math.min(
    Math.floor((options.frameMs * EXPORT_FPS) / 1000),
    frames - 1,
  );
  const root = styleFrameRoot();
  mkdirSync(root, { recursive: true });
  const frameId = randomUUID();
  const dir = path.join(root, frameId);
  mkdirSync(dir);
  const renderStill = options.renderStill ?? defaultStillRenderer;
  try {
    const keyframes = await Promise.all(
      (["landscape", "portrait"] as const).map(async (aspect) => {
        const propsPath = path.join(dir, `props-${aspect}.json`);
        writeFileSync(propsPath, JSON.stringify({ spec }));
        const outPath = path.join(dir, `${aspect}.png`);
        await renderStill({ aspect, frameIndex, outPath, propsPath });
        const bytes = statSync(outPath).size;
        if (bytes < MIN_PNG_BYTES) throw new Error(`${aspect} 关键帧为空`);
        return {
          aspect,
          url: `/api/video/style-frame/${frameId}/${aspect}`,
          digest: await sha256File(outPath),
          bytes,
          outputRef: `style-frame/${frameId}/${aspect}.png`,
        };
      }),
    );
    pruneOldestStyleFrames(root);
    return { frameId, frameIndex, keyframes };
  } catch (error) {
    // 失败不留半成品：整个作业目录清掉，证据只留完整的一对。
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (cleanupError) {
      console.warn("风格关键帧作业目录清理失败", dir, cleanupError);
    }
    throw error;
  }
}
