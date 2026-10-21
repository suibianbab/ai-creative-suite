#!/usr/bin/env node
// 出片脚本：项目 JSON → 整片双尺寸 MP4 + render-manifest.json + RenderRecord 回写。
// P1 起支持多镜头：量化帧图拼成单文件整片（Timeline-* 合成），单镜头是 N=1 特例。
// 渲染前先跑逐帧干跑门禁（worker 隔离 + 单帧预算，P2-A 补齐），--skip-dryrun 可跳。
// 用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir> [--narration <dir>] [--skip-dryrun] [--budget-ms 500]
// 依赖: packages/{video-document,video-scene} 已 build（pnpm -r build）；ffprobe 在 PATH。
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { bakeThreeShots, buildBakeJobs } from "./bake-three.mjs";
import { browserLabel } from "./env-info.mjs";
import {
  buildProjectDryRunJobs,
  DEFAULT_BUDGET_MS,
  dryRunJobs,
} from "./frame-dryrun.mjs";
import {
  buildHasAudioTrack,
  buildManifestMedia,
  buildShotAssetDigests,
  collectMediaShots,
  isBlackTail,
  parseTailYavg,
  verifyMediaAssets,
} from "./render-scene.media.mjs";
import {
  buildTimelineProps,
  DIMENSIONS,
  findMissingThreeBakes,
} from "./render-scene.props.mjs";
import { sha256File } from "./sha256-file.mjs";
import { validateThreeSpec } from "./three/spec.mjs";
import { buildNarrationEntries, readSubtitleCues } from "./tts-sse.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FONT_REL =
  "packages/remotion-engine/src/assets/fonts/NotoSansSC-Regular.woff";
const FPS = 24;

// scripts/ 不进 workspace 包图，按预检裁决用相对路径引 dist。
const { canonicalJson, quantizeTimeline, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);
const { defaultRegistry, validateSceneSpec } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-scene/dist/index.js")).href
);
const { resolveStoreRoot } = await import(
  pathToFileURL(path.join(ROOT, "packages/media-store/dist/index.js")).href
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

// P2.5-T4：文件服务端口等待共体（旁白/媒体两用；10s 超时 + 提前退出竞速 +
// 定时器清理——自 D2 旁白块原样提取，行为零变化）。
async function awaitServerPort(serverProcess, label) {
  let output = "";
  serverProcess.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const serverDead = new Promise((_, reject) => {
    serverProcess.on("exit", () =>
      reject(new Error(`${label}提前退出: ${output}`)),
    );
  });
  let portTimer;
  const portLine = new Promise((resolve, reject) => {
    serverProcess.stdout.on("data", function onChunk(chunk) {
      const match = /"port":(\d+)/.exec(`${chunk}`);
      if (match) {
        serverProcess.stdout.off("data", onChunk);
        resolve(Number(match[1]));
      }
    });
    portTimer = setTimeout(
      () => reject(new Error(`${label}端口上报超时`)),
      10000,
    );
  });
  // 端口已定（或已败）就清掉 10s 定时器——否则它是进程退出前最后一只
  // 持有事件循环的句柄，快跑完的运行也会多挂最多 10 秒
  return await Promise.race([portLine, serverDead]).finally(() =>
    clearTimeout(portTimer),
  );
}

// 旁白 wav 时长（ffprobe 秒 → ms 整数）
function probeWavMs(wav) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    fail(`ffprobe 旁白失败: ${result.stderr}\n  wav: ${wav}`);
  return Math.round(Number(result.stdout.trim()) * 1000);
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

// P3-B（R7）：RenderRecord.three 证据——七个字段与 video-document 的校验逐项
// 对齐；componentId/componentVersion 取规范化 spec，其余来自烘焙层。
function buildThreeRecordEvidence(spec, baked, shotIndex, aspect) {
  if (!baked) fail(`镜头 ${shotIndex + 1} 缺少 ${aspect} 画幅的 3D 烘焙结果`);
  return {
    componentId: spec.componentId,
    componentVersion: spec.componentVersion,
    threeVersion: baked.threeVersion,
    chromiumVersion: baked.chromiumVersion,
    glRenderer: baked.glRenderer,
    framesDigest: baked.framesDigest,
    clipSha256: baked.clipSha256,
  };
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    out: { type: "string" },
    narration: { type: "string" },
    "skip-dryrun": { type: "boolean" },
    "budget-ms": { type: "string" },
    // spec R4 渲染期防线：旁白溢出默认拒绝渲染；--allow-truncate 显式选择
    // 保留旧行为（告警 + Sequence 截断），与 tts-narration 的同名旗标配套。
    "allow-truncate": { type: "boolean" },
  },
});
if (!values.project || !values.out)
  fail(
    "用法: node scripts/video/render-scene.mjs --project <path.json> --out <dir> [--narration <dir>] [--skip-dryrun] [--budget-ms 500] [--allow-truncate]",
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

// 2. 全镜头 working version 的 spec | media-clip | three（多镜头整片；单镜头是 N=1 特例）
// P2.5-T4：媒体镜头不验 spec（无 params），资产核验在下方 G3 块统一做。
// P3-B Task 4：three 镜头验注册表深度，烘焙在干跑之后、Remotion 之前。
const shotEntries = project.shots.map((shot, index) => {
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  if (!version) fail(`镜头 ${index + 1} 缺少 working version`);
  if (version.sceneSource.type === "spec") {
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
  }
  if (version.sceneSource.type === "media-clip") {
    return { shot, version, media: version.sceneSource };
  }
  // P3-B Task 4：three 镜头做注册表深度校验（结构规则已在 validateVideoProject
  // 唯一实现）；durationMs 等式与 spec 镜头同口径再核一次。
  if (version.sceneSource.type === "three") {
    let spec;
    try {
      spec = validateThreeSpec(version.sceneSource.spec);
    } catch (error) {
      fail(`镜头 ${index + 1} 3D 场景校验失败: ${error.message}`);
    }
    if (spec.durationMs !== version.durationMs)
      fail(
        `镜头 ${index + 1} 3D spec.durationMs(${spec.durationMs}) 与 ContentVersion.durationMs(${version.durationMs}) 不一致`,
      );
    return { shot, version, three: spec };
  }
  fail(
    `镜头 ${index + 1} 的 sceneSource 既非 spec、media-clip 也非 three（出片仅支持这三种）`,
  );
});
if (shotEntries.length === 0) fail("项目没有镜头，无法出片");

// 3. 帧图（累计边界量化）+ 字体指纹 + 浏览器标识（ADR §2.5 确定性输入）
const timeline = quantizeTimeline(
  shotEntries.map((entry) => entry.version.durationMs),
  FPS,
);
const totalFrames = timeline.totalFrames;

// P2.5-T4 G1/G3：媒体镜头装配 + 渲染前仓核验（账本→仓：存在性 + sha256 双查；
// 任何问题大声拒——不 spawn 服务、不渲染、不写 RenderRecord，修订文档 §3 行 6）。
const { entries: mediaShots, problems: mediaProblems } = collectMediaShots(
  project,
  project.mediaAssets ?? [],
);
if (mediaProblems.length > 0)
  fail(`媒体镜头装配失败，拒绝渲染：\n  ${mediaProblems.join("\n  ")}`);
const mediaStoreRoot = resolveStoreRoot();
const verifyProblems = await verifyMediaAssets(mediaShots, {
  storeRoot: mediaStoreRoot,
  existsSync,
  hashFile: sha256File,
});
if (verifyProblems.length > 0)
  fail(
    `媒体仓核验失败，拒绝渲染（不写 RenderRecord）：\n  ${verifyProblems.join("\n  ")}`,
  );
const mediaByShot = new Map(
  mediaShots.map((entry) => [entry.shotIndex, entry]),
);

// D2 旁白装配：--narration <dir> 指向 tts-narration.mjs 的资产目录。
// 缺资产=该镜头无音轨（提示不阻断）；超 span 的音频 Sequence 自然截断（告警）。
// narrationServer = 独立进程文件服务（见下方探针裁决注释）。
let narrationEntries = [];
let narrationServer = null;
if (values.narration) {
  const assembled = buildNarrationEntries(
    project,
    path.resolve(values.narration),
    timeline,
    FPS,
    probeWavMs,
  );
  narrationEntries = assembled.entries;
  for (const notice of assembled.notices)
    console.log(`[render-scene] 旁白提示: ${notice}`);
  for (const warning of assembled.warnings)
    console.warn(`[render-scene] 旁白警告: ${warning}`);
  // spec R4 渲染期防线：溢出默认拒绝——静默截断只经 --allow-truncate 到达。
  if (assembled.warnings.length > 0 && !values["allow-truncate"]) {
    fail(
      `旁白溢出未对齐，拒绝渲染（${assembled.warnings.length} 个镜头）：\n  ${assembled.warnings.join("\n  ")}\n` +
        "出路二选一：先跑 tts-narration 重合成（自动时长对齐写新版本），或显式加 --allow-truncate 接受截断",
    );
  }
  if (narrationEntries.length > 0) {
    console.log(
      `[render-scene] 旁白音轨 ${narrationEntries.length}/${timeline.shots.length} 镜头`,
    );
  }
  // 终评 Important#1：0 条旁白（目录空/资产全缺/narrationText 全空）不 spawn
  // 服务——空 --files 会让子进程用法错误退出，把「缺资产=提示不阻断」变成渲染中止。
  // 探针裁决（Task4 Step3）：Remotion CLI 渲染的 <Audio src> 只认 http(s)——
  //   绝对路径（file:///）→「Can only download URLs starting with http://」；
  //   data URI → 静默无声（资产未进下载队列，最危险的失败模式）；
  //   --public-dir → 文件不进 bundle 服务目录，localhost 404。
  // 解法：独立进程 narration-server.mjs 托管旁白 wav（白名单 + CORS，127.0.0.1
  // 随机端口）。不能同进程起服务——渲染 spawnSync 会冻住事件循环（探针实测：
  // TCP 建连但请求永不响应）。props 注入 http URL，失败会响（下载报错）。
  if (narrationEntries.length > 0) {
    const names = narrationEntries.map((entry) =>
      encodeURIComponent(path.basename(entry.audioSrc)),
    );
    narrationServer = spawn(
      process.execPath,
      [
        path.join(ROOT, "scripts/video/narration-server.mjs"),
        "--dir",
        path.resolve(values.narration),
        "--files",
        names.map(decodeURIComponent).join(","),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    // 终评 Important#2：fail() 走 process.exit(1)，若不在退出钩子里收尾，
    // 服务进程会带着 ACAO:* 的监听孤儿化（重复失败渲染会累积）。exit 钩子
    // 覆盖所有退出路径（fail/正常/未捕获异常），kill 幂等。
    process.on("exit", () => narrationServer?.kill());
    const port = await awaitServerPort(narrationServer, "narration-server");
    for (const [index, entry] of narrationEntries.entries()) {
      entry.propsSrc = `http://127.0.0.1:${port}/${names[index]}`;
    }
  }
}

// P2.5-T4（B1）：媒体仓托管服务——OffthreadVideo 资产下载链只认 http(s)。
// 与旁白服务同生命周期纪律：exit 钩子兜杀（幂等 kill），白名单只放行本片
// 涉及的 storeKey（去重）。
let mediaServer = null;
let mediaUrlBase = null;
if (mediaShots.length > 0) {
  mediaServer = spawn(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/media-server.mjs"),
      "--root",
      mediaStoreRoot,
      "--files",
      [...new Set(mediaShots.map((entry) => entry.asset.storeKey))].join(","),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  process.on("exit", () => mediaServer?.kill());
  const mediaPort = await awaitServerPort(mediaServer, "media-server");
  mediaUrlBase = `http://127.0.0.1:${mediaPort}`;
  console.log(
    `[render-scene] 媒体镜头 ${mediaShots.length}/${timeline.shots.length}（仓 ${mediaStoreRoot}，端口 ${mediaPort}）`,
  );
}
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

// 3.6 P3-B Task 4：three 镜头烘焙（干跑之后、Remotion 之前，一次烘完所有画幅）。
// 产物落在独立临时目录（<root>/original/<storeKey>.mp4），由第二台 media-server
// 以 http 托管给 OffthreadVideo（与媒体仓服务同款白名单 + exit 钩子兜杀）。
// 清理必须挂 process.on("exit")：fail() 走 process.exit(1)，成功路径也是顶层
// 脚本自然退出——没有一处 finally 能覆盖全部退出路径。
const aspects = project.brief.aspectTargets;
const threeJobs = buildBakeJobs({ project, aspects });
let threeTempDir = null;
let threeServer = null;
let threeUrlBase = null;
let threeResult = new Map(); // `${aspect}:${shotIndex}` → 烘焙结果
if (threeJobs.length > 0) {
  threeTempDir = mkdtempSync(path.join(tmpdir(), "acs-three-"));
  process.on("exit", () => threeServer?.kill());
  process.on("exit", () => {
    if (threeTempDir) rmSync(threeTempDir, { recursive: true, force: true });
  });
  const threeShotCount = new Set(threeJobs.map((job) => job.shotIndex)).size;
  console.log(
    `[render-scene] 3D 镜头 ${threeShotCount}/${timeline.shots.length} × ${aspects.length} 画幅烘焙中…`,
  );
  let baked;
  try {
    baked = await bakeThreeShots({ jobs: threeJobs, outDir: threeTempDir });
  } catch (error) {
    fail(`3D 镜头烘焙失败: ${error.message}`);
  }
  threeResult = new Map(
    baked.map((item) => [`${item.aspect}:${item.shotIndex}`, item]),
  );
  threeServer = spawn(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/media-server.mjs"),
      "--root",
      threeTempDir,
      "--files",
      [...new Set(baked.map((item) => item.storeKey))].join(","),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const threePort = await awaitServerPort(threeServer, "three-media-server");
  threeUrlBase = `http://127.0.0.1:${threePort}`;
  console.log(
    `[render-scene] 3D 片段 ${baked.length} 个已烘焙并托管（端口 ${threePort}）`,
  );
}

// 4. 逐 aspect 渲染整片 + ffprobe 校验
const manifest = {
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  remotion: remotionVersion,
  browser,
  fontDigests,
  aspects: {},
};
// Timeline props 组装已抽成纯函数（render-scene.props.mjs，Ruling 3）：量化帧图 +
// 逐镜头 spec | media | three（TimelineScene 要求 spans 连续无缝）。
// 旁白（若有）：audioSrc 用装配块注入的 http://127.0.0.1:<port>/ URL（见上方探针裁决）。
// 字幕（spec R3）：words.json 字级时间戳 → 镜头本地 cue（asset-backed 旁白轨的
// 派生投影，缺 words → 均匀近似告警不阻断；cue 越界钳到 span）。读取副作用留在
// 调用方，props 只收预算好的 { cues }。
const narrationByShot = new Map(
  narrationEntries.map((entry) => [entry.shotIndex, entry]),
);
const subtitlesByShot = new Map();
const subtitleSummary = [];
if (values.narration) {
  for (const span of timeline.shots) {
    if (!narrationByShot.has(span.shotIndex)) continue;
    const entry = narrationByShot.get(span.shotIndex);
    const spanMs = Math.round((span.frames / FPS) * 1000);
    const subtitle = readSubtitleCues(
      path.resolve(values.narration),
      path.basename(entry.audioSrc).replace(/\.wav$/, ""),
      shotEntries[span.shotIndex].version.narrationText ?? "",
      spanMs,
    );
    if (subtitle.fallback) {
      console.warn(
        `[render-scene] 镜头 ${span.shotIndex + 1} 无有效字级时间戳，字幕按均匀近似（出片对齐以 words.json 为准）`,
      );
    }
    if (subtitle.cues.length > 0) {
      subtitlesByShot.set(span.shotIndex, { cues: subtitle.cues });
      subtitleSummary.push({
        shotIndex: span.shotIndex,
        cues: subtitle.cues.length,
        textSha256: sha256(subtitle.cues.map((cue) => cue.text).join("\n")),
      });
    }
  }
}

// P1 转场（Feature ④ spec R3）：project 级编排元数据透传（回读已过
// validateVideoProject）。缺省/空不加键：props 文件与无转场现状逐字节一致
// （A1 金标准）。manifest 摘要与画幅无关，记顶层：逐边界 kind/durationMs/换算帧窗。
const transitions = project.transitions;
if (Array.isArray(transitions) && transitions.length > 0) {
  manifest.transitions = transitions.map((transition) => {
    const left = timeline.shots[transition.boundary];
    const total = Math.round((transition.durationMs * FPS) / 1000);
    const halfOut = Math.ceil(total / 2);
    return {
      boundary: transition.boundary,
      kind: transition.kind,
      durationMs: transition.durationMs,
      startFrame: left.startFrame + left.frames - halfOut,
      frames: total,
    };
  });
}

for (const aspect of aspects) {
  const compositionId = `Timeline-${aspect === "landscape" ? "Landscape" : "Portrait"}`;
  const videoPath = path.join(outDir, `${aspect}.mp4`);
  const propsPath = path.join(outDir, `props-${aspect}.json`);
  // 本画幅的 three 烘焙结果：拼接 span 帧数供 outMs 换算（画幅不同 → src/端口
  // 相同但素材尺寸与出点不同，故 props 按画幅生成）。
  const threeByShot = new Map();
  for (const [key, baked] of threeResult) {
    const separator = key.indexOf(":");
    if (key.slice(0, separator) !== aspect) continue;
    const shotIndex = Number(key.slice(separator + 1));
    threeByShot.set(shotIndex, {
      ...baked,
      frames: timeline.shots[shotIndex].frames,
    });
  }
  // Codex 复核 D：3D 镜头缺本画幅烘焙结果时提前点名镜头号与画幅——不让
  // undefined 流进 props 组装后才以难以定位的方式失败。
  const missingThreeBakes = findMissingThreeBakes({
    timeline,
    shotEntries,
    threeByShot,
    aspect,
  });
  if (missingThreeBakes.length > 0) fail(missingThreeBakes.join("；"));
  const timelineProps = buildTimelineProps({
    timeline,
    shotEntries,
    mediaByShot,
    threeByShot,
    mediaUrlBase,
    threeUrlBase,
    narrationByShot,
    subtitlesByShot,
    transitions,
    fps: FPS,
  });
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
  // 旁白资产来自本进程的 127.0.0.1 文件服务（跨源）：关掉渲染浏览器的同源策略
  // （Remotion 官方 CORS 出口）。只影响这次渲染的临时 Chrome，不影响别的。
  // P2.5-T4（G8）：有旁白/媒体/3D 片段即加——媒体虽走服务端下载，放宽无代价。
  if (
    narrationEntries.length > 0 ||
    mediaShots.length > 0 ||
    threeJobs.length > 0
  )
    command.push("--disable-web-security");
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

  // P2.5-T4（B6/G5）：末帧黑帧检测——所有渲染（纯 spec 亦然）。signalstats 的
  // YAVG ≤16 判黑（transitions e2e 实测纯黑=16，内容帧 220+）。黑帧 = 装配/时长
  // 事故，大声拒收（此时 mp4 已写但 RenderRecord 未写——失败语义见修订文档
  // §3 行 6「退出码 0 ≠ 成功」的反向：这里让失败真的以非 0 退出）。
  const tail = spawnSync(
    "ffmpeg",
    [
      "-sseof",
      "-0.2",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "signalstats,metadata=print",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const tailYavg = parseTailYavg(`${tail.stdout}${tail.stderr}`);
  if (tailYavg === null)
    fail(
      `${aspect}.mp4 末帧黑帧检测失败：无法解析 YAVG（ffmpeg status=${tail.status}）`,
    );
  console.log(`[render-scene] ${aspect}.mp4 末帧 YAVG=${tailYavg}`);
  if (isBlackTail(tailYavg))
    fail(
      `${aspect}.mp4 末帧为黑帧（YAVG=${tailYavg}）：疑似镜头装配/时长事故，拒绝收片`,
    );

  // D2：带旁白出片时核对音轨——必须有 aac 流。
  // 注意 probe() 用了 -select_streams v:0，其 streams 里永远不会出现音频流，
  // 音轨必须单独探（探针实测：用 probe() 的输出查音频=结构性误报「无音频流」）。
  // 容器时长不再复查：上方 ±0.05s 视频检查更严，会先拦（终评 minor#5 删冗余）。
  // P2.5-T4（G4）：四象限——有旁白或有媒体原声（audio=keep）即必须有 aac 流。
  if (buildHasAudioTrack(narrationEntries, mediaShots)) {
    const audioProbe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "csv=p=0",
        videoPath,
      ],
      { encoding: "utf8" },
    );
    const audioCodec = `${audioProbe.stdout}`.trim();
    if (audioCodec !== "aac") {
      fail(`${aspect}.mp4 期望 aac 音轨但得到: ${audioCodec || "无音频流"}`);
    }
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
      componentId: shotEntries[span.shotIndex].media
        ? "media-clip"
        : shotEntries[span.shotIndex].three
          ? shotEntries[span.shotIndex].three.componentId
          : shotEntries[span.shotIndex].spec.componentId,
      startFrame: span.startFrame,
      frames: span.frames,
      contentDigest: contentDigests[span.shotIndex],
    })),
    // D2 旁白证据：逐镜头资产指纹与时长（wordsFile 同命名约定的字级时间戳档案）
    ...(narrationEntries.length > 0
      ? {
          narration: narrationEntries.map((entry) => ({
            shotIndex: entry.shotIndex,
            versionId: shotEntries[entry.shotIndex].version.versionId,
            audioBytes: statSync(entry.audioSrc).size,
            durationMs: entry.durationMs,
            wordsFile: path
              .basename(entry.audioSrc)
              .replace(/\.wav$/, ".words.json"),
          })),
        }
      : {}),
    // P2.5-T4（G6）：媒体镜头逐条证据（素材指纹/入出点/源内起始帧/原声通道）
    ...(mediaShots.length > 0
      ? { media: buildManifestMedia(mediaShots, timeline, FPS) }
      : {}),
    // P3-B Task 4：3D 镜头逐条证据（逐帧哈希 + 片段摘要 + 渲染器/版本）；无
    // three 镜头的项目不得多键（manifest 与旧输出一致）。
    ...(threeByShot.size > 0
      ? {
          three: {
            shots: [...threeByShot.entries()]
              .sort(([left], [right]) => left - right)
              .map(([shotIndex, baked]) => ({
                shotIndex,
                componentId: shotEntries[shotIndex].three.componentId,
                componentVersion: shotEntries[shotIndex].three.componentVersion,
                threeVersion: baked.threeVersion,
                chromiumVersion: baked.chromiumVersion,
                glRenderer: baked.glRenderer,
                frameHashes: baked.frameHashes,
                framesDigest: baked.framesDigest,
              })),
          },
        }
      : {}),
    // P1 字幕证据（spec R5）：逐镜头 cue 数与文本 SHA-256（烧进画面的派生投影摘要）
    ...(subtitleSummary.length > 0 ? { subtitleCues: subtitleSummary } : {}),
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
      // P2.5-T4（G7）：媒体镜头专属证据——渲染源（original）的 sha256 逐资产钉死
      ...(entry.media
        ? {
            assetDigests: buildShotAssetDigests(
              mediaByShot.get(span.shotIndex),
            ),
          }
        : {}),
      // P3-B（R7）：3D 镜头专属证据——组件版本/渲染器/逐帧摘要/片段摘要。
      ...(entry.three
        ? {
            three: buildThreeRecordEvidence(
              entry.three,
              threeByShot.get(span.shotIndex),
              span.shotIndex,
              aspect,
            ),
          }
        : {}),
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
if (narrationServer) narrationServer.kill();
if (mediaServer) mediaServer.kill();
if (threeServer) threeServer.kill();
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
