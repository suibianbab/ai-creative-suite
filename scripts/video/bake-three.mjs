#!/usr/bin/env node
// P3-B Task 3：three 镜头烘焙内核——无头 Chromium（强制 SwiftShader）逐帧 PNG
// → ffmpeg 编码 mp4，产出逐帧摘要与片段摘要，供 Task 4 装配进既有出片链路。
// 用法: node scripts/video/bake-three.mjs --project <path.json> [--out <dir>]
// 无 three 镜头时打印「无 3D 镜头」并 exit 0；--out 缺省为临时目录并在退出时清理。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { sha256File } from "./sha256-file.mjs";
import { validateThreeSpec } from "./three/spec.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");
const THREE_DIR = path.join(SCRIPT_DIR, "three");
const THREE_BUILD_DIR = path.dirname(
  createRequire(import.meta.url).resolve("three"),
);

export const BAKE_FPS = 24;
const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };
const PNG_PREFIX = "data:image/png;base64,";
const REQUEST_TIMEOUT_MS = 30_000;

const { quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

// three 版本来源：require.resolve("three") 指向 build/three.cjs，取同级
// ../package.json（直接 require("three/package.json") 会被 exports 限制拒绝）。
const threeVersion = JSON.parse(
  readFileSync(path.join(THREE_BUILD_DIR, "../package.json"), "utf8"),
).version;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function jobPrefix(job) {
  return `${job.label}（${job.aspect} ${job.width}x${job.height}）`;
}

// Node 侧 0.186.1 → 页面 THREE.REVISION 186。major 非 0 时拼成 major+minor。
function expectedRevision(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (!match) return version;
  return match[1] === "0" ? String(Number(match[2])) : `${match[1]}${match[2]}`;
}

const THREE_REVISION = expectedRevision(threeVersion);

// —— 静态文件服务：只读、127.0.0.1、白名单路由（无目录遍历）——
// three 构建产物有两个文件：three.module.js 内部 import './three.core.js'；
// 只放行这两个，其余 build 文件一律 404。
export async function createThreeServer({ root = THREE_DIR } = {}) {
  const routes = new Map([
    ["/", path.join(root, "harness.html")],
    ["/harness.html", path.join(root, "harness.html")],
    ["/harness.js", path.join(root, "harness.js")],
    [
      "/vendor/three/three.module.js",
      path.join(THREE_BUILD_DIR, "three.module.js"),
    ],
    [
      "/vendor/three/three.core.js",
      path.join(THREE_BUILD_DIR, "three.core.js"),
    ],
  ]);

  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("method not allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      );
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("bad request");
      return;
    }
    let filePath = routes.get(pathname);
    if (!filePath) {
      // /scene/<componentId>.mjs → 注册表组件文件（组件 id 形状即安全边界）。
      const match = /^\/scene\/([a-z][a-zA-Z0-9]{0,63})\.mjs$/.exec(pathname);
      if (match) filePath = path.join(root, "components", `${match[1]}.mjs`);
    }
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    let body;
    try {
      body = readFileSync(filePath);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type":
        MIME[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-length": body.length,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/harness.html` };
}

// —— 纯函数：项目 + 画幅 → 烘焙任务（帧数取 accumulate-then-round 的 span）——
export function buildBakeJobs({ project, aspects }) {
  const entries = project.shots.map((shot, shotIndex) => {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) {
      throw new Error(`镜头 ${shotIndex + 1} 缺少 working version，无法烘焙`);
    }
    return { shot, version, shotIndex };
  });
  if (entries.length === 0) return [];
  const timeline = quantizeTimeline(
    entries.map((entry) => entry.version.durationMs),
    BAKE_FPS,
  );

  const jobs = [];
  for (const aspect of aspects) {
    const dimension = DIMENSIONS[aspect];
    if (!dimension) {
      throw new Error(
        `画幅 ${aspect} 未知（仅支持 landscape | portrait），无法烘焙 3D 镜头`,
      );
    }
    const [width, height] = dimension;
    for (const entry of entries) {
      if (entry.version.sceneSource.type !== "three") continue;
      const label = `镜头 ${entry.shotIndex + 1}`;
      let spec;
      try {
        spec = validateThreeSpec(entry.version.sceneSource.spec);
      } catch (error) {
        throw new Error(
          `${label}（${aspect} ${width}x${height}）3D 场景校验失败：${error.message}`,
          { cause: error },
        );
      }
      if (spec.durationMs !== entry.version.durationMs) {
        throw new Error(
          `${label}（${aspect} ${width}x${height}）spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${entry.version.durationMs}) 不一致`,
        );
      }
      jobs.push({
        aspect,
        shotIndex: entry.shotIndex,
        label,
        spec,
        width,
        height,
        frames: timeline.shots[entry.shotIndex].frames,
      });
    }
  }
  return jobs;
}

// 编码超时：ffmpeg 卡死（坏帧/磁盘挂起）不得无限挂住出片进程。
export const ENCODE_TIMEOUT_MS = 120_000;

// shell:true 时 Node 把参数数组用空格拼接、且不加引号——"a b" 会被拆成两个
// token，含空格的帧目录/输出路径因此被截断。这里预先给每个元素加平台引号，
// 保证 shell 始终把每个元素当成单个 token。
export function quoteShellArg(arg) {
  const text = String(arg);
  if (process.platform === "win32") {
    // cmd.exe：双引号包裹，内嵌 " 以 "" 转义。结尾的反斜杠须加倍——CRT 把
    // `\"` 当作转义引号，`"C:\dir\"` 会吞掉收尾引号、把后续 token 并进来。
    const escaped = text.replaceAll('"', '""').replace(/(\\+)$/, "$1$1");
    return `"${escaped}"`;
  }
  // POSIX sh：单引号包裹，内嵌 ' 以 '\'' 转义（单引号内反斜杠无特殊含义）。
  return `'${text.replaceAll("'", "'\\''")}'`;
}

// —— 默认编码器：pnpm 调 Remotion 自带的 ffmpeg（不依赖 PATH 里的 ffmpeg）——
// spawn 可注入（单测用假实现，不跑 ffmpeg 进程）。
export function runEncoder(framesDir, fps, outFile, spawn = spawnSync) {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    path.join(framesDir, "%04d.png"),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
    outFile,
  ];
  // 逐项预加引号：含空格路径在 shell 拼接后仍是单 token（见 quoteShellArg）。
  const result = spawn(
    quoteShellArg("pnpm"),
    [
      "--filter",
      "@acs/remotion-engine",
      "exec",
      "remotion",
      "ffmpeg",
      ...args,
    ].map(quoteShellArg),
    {
      cwd: ROOT,
      shell: true,
      encoding: "utf8",
      timeout: ENCODE_TIMEOUT_MS,
    },
  );
  if (result.error || result.status !== 0) {
    const tail = `${result.stderr ?? ""}`
      .trimEnd()
      .split(/\r?\n/)
      .slice(-20)
      .join("\n");
    const reason = result.error
      ? result.error.code === "ETIMEDOUT"
        ? `超时（timeout=${ENCODE_TIMEOUT_MS}ms），进程已终止`
        : `进程错误：${result.error.message}`
      : `status=${result.status ?? "signal"}`;
    throw new Error(
      `ffmpeg 编码失败（${reason}）：\n${tail || "（无 stderr 输出）"}`,
    );
  }
  return outFile;
}

async function closeQuietly(target) {
  if (!target) return;
  try {
    await target.close();
  } catch {
    // 清理路径上的关闭失败不应掩盖原始错误。
  }
}

// —— 烘焙主流程：每个 job 一个 context/page，失败信息带镜头号与画幅 ——
export async function bakeThreeShots({ jobs, outDir, deps = {} }) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const {
    launchBrowser = () =>
      chromium.launch({
        headless: true,
        args: ["--use-angle=swiftshader", "--disable-gpu-sandbox"],
      }),
    hashFile = sha256File,
    encode = runEncoder,
  } = deps;

  mkdirSync(path.join(outDir, "original"), { recursive: true });
  const { server, url } = await createThreeServer({ root: THREE_DIR });
  let browser;
  try {
    browser = await launchBrowser();
    const results = [];
    for (const job of jobs) {
      results.push(
        await bakeOneShot({ job, outDir, url, browser, hashFile, encode }),
      );
    }
    return results;
  } finally {
    await closeQuietly(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function bakeOneShot({ job, outDir, url, browser, hashFile, encode }) {
  let context;
  let page;
  try {
    context = await browser.newContext({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.addInitScript(
      (config) => {
        window.__THREE_SCENE_CONFIG__ = config;
      },
      {
        componentId: job.spec.componentId,
        componentVersion: job.spec.componentVersion,
        width: job.width,
        height: job.height,
        background: job.spec.background,
        seed: job.spec.seed,
        params: job.spec.params,
        fps: BAKE_FPS,
        durationMs: job.spec.durationMs,
      },
    );
    await page.goto(url, {
      waitUntil: "load",
      timeout: REQUEST_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () => Boolean(window.bakeInfo?.ready === true || window.bakeError),
      null,
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const state = await page.evaluate(() => ({
      info: window.bakeInfo ?? null,
      error: window.bakeError ?? null,
    }));
    if (state.error) throw new Error(`页面初始化失败：${state.error}`);
    assertBakeInfo(state.info, job);
    if (consoleErrors.length > 0) {
      throw new Error(`页面 console 报错：${consoleErrors[0]}`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`页面脚本异常：${pageErrors[0]}`);
    }

    const framesDir = path.join(
      outDir,
      "frames",
      `${job.aspect}-shot-${job.shotIndex + 1}`,
    );
    mkdirSync(framesDir, { recursive: true });
    const frameHashes = [];
    for (let frameIndex = 0; frameIndex < job.frames; frameIndex += 1) {
      const dataUrl = await page.evaluate(
        (frame) => window.bakeFrame(frame),
        frameIndex,
      );
      if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_PREFIX)) {
        throw new Error(
          `第 ${frameIndex} 帧未返回 PNG data URL（已得 ${frameHashes.length}/${job.frames} 帧）`,
        );
      }
      const bytes = Buffer.from(dataUrl.slice(PNG_PREFIX.length), "base64");
      writeFileSync(
        path.join(framesDir, `${String(frameIndex).padStart(4, "0")}.png`),
        bytes,
      );
      frameHashes.push(sha256(bytes));
    }
    if (frameHashes.length !== job.frames) {
      throw new Error(
        `帧数与任务不符：期望 ${job.frames} 帧，实际 ${frameHashes.length} 帧`,
      );
    }
    if (consoleErrors.length > 0) {
      throw new Error(`页面 console 报错：${consoleErrors[0]}`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`页面脚本异常：${pageErrors[0]}`);
    }

    const encodedPath = path.join(framesDir, "clip.mp4");
    await encode(framesDir, BAKE_FPS, encodedPath);
    const clipSha256 = await hashFile(encodedPath);
    const storeKey = `${clipSha256.slice(0, 16)}.mp4`;
    const clipPath = path.join(outDir, "original", storeKey);
    // 两个镜头字节相同 → 同 storeKey：直接复用已有片段，不重写、不报错。
    if (!existsSync(clipPath)) copyFileSync(encodedPath, clipPath);

    return {
      shotIndex: job.shotIndex,
      aspect: job.aspect,
      storeKey,
      clipPath,
      framesDigest: sha256(frameHashes.join("\n")),
      frameHashes,
      clipSha256,
      threeVersion,
      chromiumVersion: browser.version(),
      glRenderer: state.info.glRenderer,
    };
  } catch (error) {
    throw new Error(`${jobPrefix(job)}烘焙失败：${error.message}`, {
      cause: error,
    });
  } finally {
    await closeQuietly(page);
    await closeQuietly(context);
  }
}

function assertBakeInfo(info, job) {
  if (!info || info.ready !== true) {
    throw new Error("页面未上报 ready 的 bakeInfo");
  }
  if (info.width !== job.width || info.height !== job.height) {
    throw new Error(
      `画布尺寸不符：页面 ${info.width}x${info.height}，期望 ${job.width}x${job.height}`,
    );
  }
  if (
    typeof info.glRenderer !== "string" ||
    !info.glRenderer.includes("SwiftShader")
  ) {
    throw new Error(
      `渲染器未使用 SwiftShader：${info.glRenderer}，3D 输出不可复现，已拒绝`,
    );
  }
  if (info.antialias !== false)
    throw new Error("页面未关闭抗锯齿（antialias）");
  if (info.preserveDrawingBuffer !== true) {
    throw new Error("页面未开启 preserveDrawingBuffer");
  }
  if (info.dpr !== 1) throw new Error(`页面像素比不为 1：${info.dpr}`);
  if (String(info.threeVersion) !== THREE_REVISION) {
    throw new Error(
      `页面 THREE.REVISION=${info.threeVersion} 与 Node 侧 three@${threeVersion} 不一致`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.project) {
    throw new Error(
      "用法: node scripts/video/bake-three.mjs --project <path.json> [--out <dir>]",
    );
  }

  let project;
  try {
    project = validateVideoProject(
      JSON.parse(readFileSync(path.resolve(values.project), "utf8")),
    );
  } catch (error) {
    throw new Error(`项目校验失败：${error.message}`);
  }

  const jobs = buildBakeJobs({
    project,
    aspects: project.brief.aspectTargets,
  });
  if (jobs.length === 0) {
    console.log("无 3D 镜头");
    return;
  }

  const explicitOut = Boolean(values.out);
  const outDir = explicitOut
    ? path.resolve(values.out)
    : mkdtempSync(path.join(tmpdir(), "acs-three-"));
  try {
    const results = await bakeThreeShots({ jobs, outDir });
    for (const result of results) {
      const job = jobs.find(
        (candidate) =>
          candidate.shotIndex === result.shotIndex &&
          candidate.aspect === result.aspect,
      );
      console.log(
        `[bake-three] ${result.aspect} ${job.width}x${job.height} ${job.label} ${job.frames} 帧 → ${result.storeKey}`,
      );
      console.log(
        `[bake-three] framesDigest=${result.framesDigest} clipSha256=${result.clipSha256}`,
      );
      console.log(
        `[bake-three] 渲染器=${result.glRenderer}｜Chromium=${result.chromiumVersion}｜three=${result.threeVersion}`,
      );
    }
    console.log(
      `[bake-three] 完成：${results.length} 个 3D 镜头片段 → ${outDir}`,
    );
  } finally {
    if (!explicitOut) rmSync(outDir, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(`bake-three: ${error.message}`);
    process.exitCode = 1;
  }
}
