#!/usr/bin/env node
// 中立剪辑交换清单导出器：v2（C2）—— 在 v1 的无缝权威时间线之上，加入
// 转场合成窗口（渲染器已把 dip-to-black 叠进相邻镜头帧内，区间与总时长
// 不变）、逐镜切片方案（真实渲染源摘要 + 帧区间 + ffmpeg 命令模板）与
// 媒体仓素材核验。v1 清单仍可读（校验器双版本）；导出失败不留成功记录
// （原子写 + 校验后落盘），out 目录不得与任何源目录重叠（源资产不覆盖）。
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { quantizeTimeline, resolveTransitionWindows, validateVideoProject } =
  await import(
    pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
  );

const sha256File = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

// 目录重叠守卫：out 等于/嵌套于源目录，或源目录嵌套于 out，都拒绝——
// 导出物是派生数据，任何方向的重叠都可能让后续清理误删或覆盖源资产。
function assertNoSourceOverlap(outDir, sourceDirs) {
  for (const [label, source] of sourceDirs) {
    if (!source) continue;
    const relOut = path.relative(path.resolve(source), path.resolve(outDir));
    const relSource = path.relative(path.resolve(outDir), path.resolve(source));
    const nested = (rel) =>
      rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (nested(relOut))
      throw new Error(
        `--out 不得等于或嵌套在${label}源目录内（源资产不覆盖）：${source}`,
      );
    if (nested(relSource))
      throw new Error(
        `--out 不得包含${label}源目录（后续清理会误删源资产）：${source}`,
      );
  }
}

export function buildEditList(
  project,
  { fps = 24, narrationDir = null, renderDir = null, mediaStore = null } = {},
) {
  const working = (shot) =>
    shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  // —— 终审修复：帧量化与渲染器同一口径（quantizeTimeline，ADR 0003 §3.5
  // 累计边界取整）。逐镜头取整会随镜头数累积跨 fps 漂移，切片边界从此错帧。
  // 零帧镜头在此大声拒绝（与渲染器 ZeroFrameShotError 同源）。 ——
  const quantized = quantizeTimeline(
    project.shots.map((shot) => working(shot).durationMs),
    fps,
  ).shots;
  const timeline = [];
  for (const [index, shot] of project.shots.entries()) {
    const version = working(shot);
    const { startFrame, frames } = quantized[index];
    const entry = {
      shotId: shot.shotId,
      versionId: version.versionId,
      startFrame,
      endFrame: startFrame + frames,
      durationMs: version.durationMs,
      description: version.description,
      component: version.sceneSource.type,
      narrationText: version.narrationText ?? "",
    };
    if (version.sceneSource.type === "spec")
      entry.componentId = version.sceneSource.spec.componentId;
    if (version.sceneSource.type === "media-clip") {
      entry.mediaAssetId = version.sceneSource.mediaAssetId;
      entry.clip = {
        inMs: version.sceneSource.inMs,
        outMs: version.sceneSource.outMs,
        fit: version.sceneSource.fit,
      };
    }
    // 独立音轨引用：旁白 WAV 与字级时间戳（存在才引用，摘要入账）。
    if (narrationDir) {
      for (const ext of ["wav", "words.json"]) {
        const file = path.join(
          narrationDir,
          `${shot.shotId}-${version.versionId}.${ext}`,
        );
        if (existsSync(file))
          entry[ext === "wav" ? "audioTrack" : "wordTimings"] = {
            file: path.basename(file),
            bytes: readFileSync(file).length,
            sha256: sha256File(file),
          };
      }
    }
    // —— C2 逐镜切片方案：真实渲染源存在时，每镜给出两个画幅的精确帧区间 ——
    if (renderDir) {
      entry.sourceSpans = project.brief.aspectTargets.map((aspect) => {
        const file = `${aspect}.mp4`;
        if (!existsSync(path.join(renderDir, file)))
          throw new Error(`渲染源缺失：${path.join(renderDir, file)}`);
        return {
          aspect,
          file,
          startFrame: entry.startFrame,
          endFrame: entry.endFrame,
        };
      });
    }
    timeline.push(entry);
  }
  // —— C2 转场合成窗口：resolveTransitionWindows 的帧数学（与渲染器装配
  // 同式；借帧越界在这里大声拒绝）；窗口叠加在相邻镜头帧内，区间与总时长
  // 不变。spans 即上面的累计边界量化结果。 ——
  const windows = resolveTransitionWindows(
    project.transitions ?? [],
    quantized,
    fps,
  );
  const transitions = (project.transitions ?? []).map((transition, index) => ({
    boundary: transition.boundary,
    kind: transition.kind,
    durationMs: transition.durationMs,
    startFrame: windows[index].startFrame,
    frames: windows[index].frames,
    halfOut: windows[index].halfOut,
    halfIn: windows[index].halfIn,
    baked: true,
  }));
  const list = {
    format: "acs-edit-list",
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    projectId: project.id,
    savedVersion: project.savedVersion,
    authoritativeTimeline: "shots 按序拼接即为唯一权威终片时间线",
    fps,
    aspects: project.brief.aspectTargets,
    timeline,
    transitions,
    compositionNotes: [
      "转场在出片时已由渲染器合成为帧（dip-to-black 叠加在相邻镜头尾部/头部的借帧窗口内）；transitions 给出合成窗口，镜头帧区间与总时长不因转场改变。",
      "逐镜切片按 sourceSpans 首尾相接即可还原权威终片（切片内含转场变暗帧）；要修改或去掉某个转场，切片中无法恢复未变暗的原始帧，须回到项目重新出片。",
      "切片方案输出视频流；逐镜旁白以 audioTrack 的独立 WAV 为准（含字级时间戳），在编辑器内对位重合。",
    ],
    mediaAssets: (project.mediaAssets ?? []).map((asset) => {
      const entry = {
        assetId: asset.assetId,
        origin: asset.origin,
        original: asset.original,
      };
      // —— C2 素材核验：媒体仓给定即逐资产打开真实文件比对 SHA-256 ——
      if (mediaStore) {
        const file = path.join(mediaStore, "original", asset.original.storeKey);
        if (!existsSync(file))
          throw new Error(
            `素材 ${asset.assetId} 在媒体仓不可读：${file}（storeKey=${asset.original.storeKey}）`,
          );
        const actual = sha256File(file);
        if (actual !== asset.original.sha256)
          throw new Error(
            `素材 ${asset.assetId} 摘要不符：账本 ${asset.original.sha256} ≠ 实测 ${actual}`,
          );
        entry.verified = {
          file: `original/${asset.original.storeKey}`,
          bytes: readFileSync(file).length,
          sha256: actual,
        };
      }
      return entry;
    }),
  };
  if (renderDir) {
    list.renderSources = {};
    for (const aspect of project.brief.aspectTargets) {
      const file = path.join(renderDir, `${aspect}.mp4`);
      if (!existsSync(file)) throw new Error(`渲染源缺失：${file}`);
      list.renderSources[aspect] = {
        file: `${aspect}.mp4`,
        bytes: readFileSync(file).length,
        sha256: sha256File(file),
        totalFrames: timeline[timeline.length - 1].endFrame,
      };
    }
    list.slicePlan = {
      method: "ffmpeg 重编码切片（帧精度，按帧数截断）",
      commandTemplate:
        "ffmpeg -ss {startSeconds} -i {source} -frames:v {frames} -c:v libx264 -crf 18 -pix_fmt yuv420p -an {output}",
      params: {
        startSeconds: "startFrame / fps（条目或 sourceSpans 的 startFrame）",
        frames: "endFrame − startFrame（必须用 -frames:v，见 notes）",
        source: "renderSources[aspect].file（先按 sha256 校验源文件）",
        output: "建议 <shotIndex>-<shotId>-<aspect>.mp4",
      },
      notes: [
        "必须重编码（-c:v libx264）：流复制会吸附到关键帧，帧区间不精确。",
        "必须用 -frames:v 按帧数截断而非 -t 时长：实测 -t 4.01 会把下一镜首帧（恰在区间端点整秒处）多包进来（97≠96 帧）。",
        "切片只含视频流（-an）：逐镜旁白用条目的 audioTrack WAV 对位重合。",
        "本仓库 Remotion 内置 ffmpeg 不含部分滤镜；上述命令只用到基础转码，系统 ffmpeg 8.x 实测可用。",
      ],
    };
  }
  return list;
}

const isInteger = (value) => Number.isInteger(value);
const SHA256_HEX = /^[0-9a-f]{64}$/;
// renderSources/sourceSpans 文件名只允许受限相对名（无路径分隔、无 ..、
// 无绝对路径）——消费端可在受限根目录内安全解析（Codex 复核 Important#3）。
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_TIMELINE = 200;

export function validateEditList(list) {
  if (
    !list ||
    list.format !== "acs-edit-list" ||
    (list.formatVersion !== 1 && list.formatVersion !== 2) ||
    !Array.isArray(list.timeline) ||
    list.timeline.length === 0 ||
    typeof list.projectId !== "string" ||
    !Array.isArray(list.aspects) ||
    list.aspects.length === 0
  )
    throw new Error("edit-list 形状无效（支持 formatVersion 1 与 2）");
  if (list.timeline.length > MAX_TIMELINE)
    throw new Error(`timeline 超过 ${MAX_TIMELINE} 条上限`);
  if (!isInteger(list.fps) || list.fps < 1 || list.fps > 240)
    throw new Error("fps 须为 1..240 的整数");
  const totalFrames = list.timeline.at(-1).endFrame;
  // v2 且带切片引用时，renderSources 是消费端的路径/摘要信任根：
  // 逐画幅校验受限文件名、SHA-256、非负字节与总帧对账。
  if (list.formatVersion === 2 && list.renderSources !== undefined) {
    if (typeof list.renderSources !== "object" || list.renderSources === null)
      throw new Error("renderSources 须为对象");
    const referenced = new Set();
    for (const entry of list.timeline)
      for (const span of entry.sourceSpans ?? []) referenced.add(span.aspect);
    for (const aspect of referenced) {
      const source = list.renderSources[aspect];
      if (!source || typeof source !== "object")
        throw new Error(`renderSources[${aspect}] 缺失（被 sourceSpans 引用）`);
      if (typeof source.file !== "string" || !SAFE_FILENAME.test(source.file))
        throw new Error(
          `renderSources[${aspect}].file 须为受限相对文件名（无路径分隔/..）`,
        );
      if (typeof source.sha256 !== "string" || !SHA256_HEX.test(source.sha256))
        throw new Error(`renderSources[${aspect}].sha256 须为 64 位十六进制`);
      if (!isInteger(source.bytes) || source.bytes < 0)
        throw new Error(`renderSources[${aspect}].bytes 须为非负整数`);
      if (!isInteger(source.totalFrames) || source.totalFrames !== totalFrames)
        throw new Error(
          `renderSources[${aspect}].totalFrames 须与时间线总帧数一致（${totalFrames}）`,
        );
    }
  }
  let expectedStart = 0;
  const seenShots = new Set();
  for (const [index, entry] of list.timeline.entries()) {
    const field = `timeline[${index}]`;
    if (typeof entry.shotId !== "string" || seenShots.has(entry.shotId))
      throw new Error(`${field}.shotId 无效或重复`);
    seenShots.add(entry.shotId);
    if (entry.startFrame !== expectedStart)
      throw new Error(`${field}.startFrame 须无缝衔接（权威时间线）`);
    if (entry.endFrame <= entry.startFrame)
      throw new Error(`${field} 帧区间须为正`);
    if (list.formatVersion === 2 && entry.sourceSpans !== undefined) {
      if (!Array.isArray(entry.sourceSpans))
        throw new Error(`${field}.sourceSpans 须为数组`);
      for (const [spanIndex, span] of entry.sourceSpans.entries()) {
        const spanField = `${field}.sourceSpans[${spanIndex}]`;
        if (
          !span ||
          !list.aspects.includes(span.aspect) ||
          typeof span.file !== "string" ||
          span.startFrame !== entry.startFrame ||
          span.endFrame !== entry.endFrame
        )
          throw new Error(
            `${spanField} 须与条目帧区间一致并带画幅与文件名（sourceSpans）`,
          );
        if (
          list.renderSources?.[span.aspect] &&
          list.renderSources[span.aspect].file !== span.file
        )
          throw new Error(
            `${spanField}.file 未在 renderSources[${span.aspect}] 中（renderSources）`,
          );
      }
    }
    expectedStart = entry.endFrame;
  }
  if (list.formatVersion === 2) {
    if (!Array.isArray(list.transitions))
      throw new Error("v2 清单的 transitions 须为数组（无转场为空数组）");
    if (list.transitions.length > list.timeline.length)
      throw new Error("transitions 条数不得超过镜头数");
    const borrowed = list.timeline.map(() => 0);
    const seenBoundaries = new Set();
    for (const [index, transition] of list.transitions.entries()) {
      const field = `transitions[${index}]`;
      const left = list.timeline[transition.boundary];
      const right = list.timeline[Number(transition.boundary) + 1];
      if (
        !isInteger(transition.boundary) ||
        transition.boundary < 0 ||
        transition.boundary >= list.timeline.length - 1 ||
        transition.kind !== "fade" ||
        !isInteger(transition.startFrame) ||
        !isInteger(transition.frames)
      )
        throw new Error(`${field} 形状无效（boundary/kind/startFrame/frames）`);
      if (seenBoundaries.has(transition.boundary))
        throw new Error(`${field}.boundary 与前条重复（每边界至多一条转场）`);
      seenBoundaries.add(transition.boundary);
      if (
        !isInteger(transition.halfOut) ||
        !isInteger(transition.halfIn) ||
        transition.halfOut < 1 ||
        transition.halfIn < 1 ||
        transition.frames !== transition.halfOut + transition.halfIn
      )
        throw new Error(
          `${field} 借帧构成无效：frames 须为 halfOut+halfIn（各 ≥1 帧）`,
        );
      if (
        transition.halfOut >= left.endFrame - left.startFrame ||
        transition.halfIn >= right.endFrame - right.startFrame
      )
        throw new Error(
          `${field} 借帧超出相邻镜头（${transition.halfOut}+${transition.halfIn}）`,
        );
      if (transition.startFrame !== left.endFrame - transition.halfOut)
        throw new Error(
          `${field}.startFrame 须为左镜 endFrame − halfOut（合成窗口）`,
        );
      if (
        transition.startFrame + transition.frames !==
        right.startFrame + transition.halfIn
      )
        throw new Error(`${field} 窗口须止于右镜 startFrame + halfIn`);
      borrowed[transition.boundary] += transition.halfOut;
      borrowed[Number(transition.boundary) + 1] += transition.halfIn;
    }
    for (const [spanIndex, entry] of list.timeline.entries()) {
      const total = borrowed[spanIndex];
      const frames = entry.endFrame - entry.startFrame;
      if (total > 0 && total >= frames)
        throw new Error(
          `镜头 ${spanIndex + 1} 被相邻转场合计借帧 ${total} ≥ ${frames} 帧（窗口重叠）`,
        );
    }
  }
  return true;
}

// CLI：node export-edit-list.mjs --project <json> --out <dir> [--fps 24]
// [--narration <dir>] [--render <dir>] [--media-store <dir>]
// （导出文件 edit-list.v2.json，原子写；out 与源目录重叠即拒绝）。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      out: { type: "string" },
      fps: { type: "string" },
      narration: { type: "string" },
      render: { type: "string" },
      "media-store": { type: "string" },
    },
    strict: true,
  });
  if (!values.project || !values.out) {
    console.error(
      "用法：export-edit-list.mjs --project <json> --out <dir> [--fps 24] [--narration <dir>] [--render <dir>] [--media-store <dir>]",
    );
    process.exit(1);
  }
  const project = validateVideoProject(
    JSON.parse(readFileSync(values.project, "utf8")),
  );
  assertNoSourceOverlap(values.out, [
    ["narration", values.narration],
    ["render", values.render],
    ["media-store", values["media-store"]],
  ]);
  const fps = values.fps ? Number(values.fps) : 24;
  if (!Number.isInteger(fps) || fps <= 0) {
    console.error(`--fps 必须为正整数（收到：${values.fps}）`);
    process.exit(1);
  }
  const list = buildEditList(project, {
    fps,
    narrationDir: values.narration ?? null,
    renderDir: values.render ?? null,
    mediaStore: values["media-store"] ?? null,
  });
  validateEditList(list);
  mkdirSync(values.out, { recursive: true });
  const temp = path.join(values.out, ".edit-list.tmp.json");
  writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`);
  renameSync(temp, path.join(values.out, "edit-list.v2.json"));
  console.log(
    `edit-list v2 → ${path.join(values.out, "edit-list.v2.json")}（${list.timeline.length} 镜头 / ${list.transitions.length} 转场 / ${list.aspects.join("+")} / ${fps}fps${values.render ? " / 含切片方案" : ""}${values["media-store"] ? " / 素材已核验" : ""}）`,
  );
}
