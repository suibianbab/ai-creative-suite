// D2 Task2：DashScope CosyVoice TTS 的纯函数层（零网络，可单测）。
// 事件形态镜像 spike 实录 artifacts/d2-tts-spike/stream-response.sse.txt：
//   data:{"output":{"sentence":{"index":0,"words":[…]},"audio":{"data":"<base64>"},
//         "finish_reason":"null","type":"sentence-begin|sentence-synthesis|sentence-end"},
//         "usage":{"characters":34},"request_id":"…"}
// 纪律：音频必须逐 chunk 解码（output.audio.data）后 Buffer.concat——
// 把整条流的 base64 先拼再解会得到损坏字节（spike 实测 8KB ≠ 223KB）。
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// scripts/ 不进 workspace 包图，按预检裁决用相对路径引 dist（与 render-scene
// 同款）。字幕 cue 构建必须与 web 预览同一实现源（spec R1 派生投影单一事实）。
const { buildSubtitleCues } = await import(
  pathToFileURL(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../packages/video-document/dist/index.js",
    ),
  ).href
);

// 计费估算：仅供台账预算 sanity，真实计费以服务端 usage.characters 为准
// （中文按每字 2 计费字符）。已知价目：cosyvoice-v3-flash ¥1/万字符。
const PRICE_CNY_PER_10K = {
  "cosyvoice-v3-flash": 1,
};

export function estimateTtsCostCny(characters, model) {
  const price = PRICE_CNY_PER_10K[model];
  if (price === undefined) {
    throw new Error(`未知模型 ${model}，无计费价目；拒绝估算以防预算失守`);
  }
  return (characters / 10000) * price;
}

// 解析一条完整 SSE 文本流（CLI 已读尽 body）→ 结构化结果。
// 容错：非 JSON 的 data: 行与注释行（:keep-alive）跳过；同句后到的
// sentence 事件覆盖先到的（sentence-end 的 words 是完整版）。
export function parseTtsSse(text) {
  const sentences = new Map();
  const audioChunks = [];
  let requestId = null;
  let usage = null;
  let finishReason = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue; // 非 JSON 行（心跳/空行残留）不致命
    }
    if (event.request_id) requestId = event.request_id;
    if (event.usage) usage = event.usage;
    const output = event.output ?? {};
    if (
      typeof output.finish_reason === "string" &&
      output.finish_reason !== "null"
    ) {
      finishReason = output.finish_reason;
    }
    const type = output.type;
    if (type === "sentence-synthesis") {
      const data = output.audio?.data ?? "";
      if (data) audioChunks.push(Buffer.from(data, "base64"));
    } else if (type === "sentence-begin" || type === "sentence-end") {
      const sentence = output.sentence;
      if (sentence) {
        const prev = sentences.get(sentence.index);
        // 后到者覆盖：sentence-end 的 words 完整（begin 可能只是前缀）
        if (
          !prev ||
          (sentence.words?.length ?? 0) >= (prev.words?.length ?? 0)
        ) {
          sentences.set(sentence.index, {
            index: sentence.index,
            words: sentence.words ?? [],
          });
        }
      }
    }
  }

  return {
    requestId,
    usage,
    finishReason,
    audioChunks,
    sentences: [...sentences.values()].sort((a, b) => a.index - b.index),
  };
}

// 旁白任务构建：working version 的 narrationText → 合成作业。
// 空/纯空白 narrationText 镜头跳过（空白不 trim 会花钱合成静音——终评 minor#7）；
// >2000 字符（ContentVersion 上限）在计费前拒绝，点名镜头序号与长度。
export function buildNarrationJobs(project) {
  if (project.shots.length === 0) {
    throw new Error("项目没有任何镜头，无可合成旁白");
  }
  const jobs = [];
  project.shots.forEach((shot, shotIndex) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const text = (working?.narrationText ?? "").trim();
    if (text.length === 0) return;
    if (text.length > 2000) {
      throw new Error(
        `镜头 ${shotIndex + 1}（${shot.shotId}）旁白 ${text.length} 字符超 2000 上限，拒绝合成`,
      );
    }
    jobs.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: working.versionId,
      text,
    });
  });
  return jobs;
}

// 计费台账解析（终评 Important#3）：jsonl 文本 → 逐行对象数组。
// 坏行（崩溃残留的半行）必须 throw 点名行号——静默吞掉会让预算闸读到偏小的
// 累计值，放行已超 ¥50 上限的调用。文件不存在 ≠ 坏行：不存在由调用方按
// 「首次调用从 0 起」处理。
export function parseUsageLedger(text) {
  const entries = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      throw new Error(
        `计费台账第 ${index + 1} 行损坏（疑似崩溃残留半行）: ${line.slice(0, 60)}`,
      );
    }
  }
  return entries;
}

// 旁白装配（Task4，render-scene 消费）：项目 + 资产目录 + 量化帧图 → 逐镜头
// 音轨 entries。纪律：
//  - 镜头 narrationText 为空 → 不装配（旁白以落档文本为准，目录里有没有 wav 不看）；
//  - 文本非空但 <shotId>-<versionId>.wav 缺失 → 不装配 + notice（缺资产不阻断出片）；
//  - wav 时长 > 镜头 span → overflow=true + warning（Sequence 播到 span 末截断）。
// probeWavMs 由 CLI 注入 ffprobe 实现，单测注入固定值——本函数零外部进程。
export function buildNarrationEntries(project, dir, timeline, fps, probeWavMs) {
  const entries = [];
  const notices = [];
  const warnings = [];
  for (const span of timeline.shots) {
    const shot = project.shots[span.shotIndex];
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    // 纯空白与空串同待遇（minor#7）：TTS 侧已 trim 跳过，这里不 trim 会报缺失噪音
    if ((version?.narrationText ?? "").trim().length === 0) continue;
    const base = `${shot.shotId}-${version.versionId}`;
    const wav = path.join(dir, `${base}.wav`);
    if (!existsSync(wav)) {
      notices.push(
        `镜头 ${span.shotIndex + 1}（${shot.shotId}）旁白资产缺失：${base}.wav，该镜头无音轨`,
      );
      continue;
    }
    const durationMs = probeWavMs(wav);
    const spanMs = (span.frames / fps) * 1000;
    const overflow = durationMs > spanMs;
    entries.push({
      shotIndex: span.shotIndex,
      audioSrc: wav,
      durationMs,
      spanMs,
      overflow,
    });
    if (overflow) {
      warnings.push(
        `镜头 ${span.shotIndex + 1} 旁白 ${durationMs}ms 超镜头 span ${spanMs}ms，播放将截断到 span 末`,
      );
    }
  }
  return { entries, notices, warnings };
}

// ── 终评 minor×7 补充 pass 的纯函数层 ────────────────────────────────────

// minor#1：URL 路径段安全解码。畸形 percent-encoding（/%zz）会让
// decodeURIComponent 抛 URIError——在 narration-server 的请求回调里抛出
// 会崩掉整个服务进程、连累当次渲染。返回 null，服务层据此回 400。
export function decodePathName(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

// minor#2：HTTP 失败的可对账描述。request_id 埋在 body JSON 里，DashScope
// 工单必填——显式点名，而不是指望它碰巧落在 body 前 500 字里可见。
export function describeHttpFailure(status, body) {
  let requestId = null;
  try {
    requestId = JSON.parse(body).request_id ?? null;
  } catch {
    // body 非 JSON（网关 502 页面等）——没有 request_id 可提
  }
  const prefix = requestId
    ? `HTTP ${status}（request_id=${requestId}）`
    : `HTTP ${status}（body 无 request_id）`;
  return `${prefix}: ${body.slice(0, 500)}`;
}

// minor#3：TTS 请求 init（认证 + SSE 头 + 超时）。裸跑 CLI 时 DashScope 挂起
// 会让无 signal 的 fetch 永等（e2e 包装有 300s 兜底，手工路径没有）。
export function ttsFetchInit(apiKey, timeoutMs = 120000) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "enable",
      Accept: "text/event-stream",
    },
    signal: AbortSignal.timeout(timeoutMs),
  };
}

// minor#4：原子落盘（tmp + rename）。直接写目标文件，崩溃在写盘中途会留半个
// wav 被下次装配当正常资产（装配只看文件存在）。rename 原子替换，崩溃最多
// 留下没用的 .tmp。Node 的 renameSync 在 Windows 上也覆盖已存在目标。
export function atomicWriteFile(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

// ── 时长对齐（spec R4 合成期兜底）───────────────────────────────────────

// WAV 实测时长：遍历 RIFF chunk，fmt 块记 byteRate、data 块记位置与 size。
// chunk 按 2 字节对齐（奇数 size 补 pad 字节，规范要求）。
// DashScope 流式合成在 data 头写占位 size（实测 0x7FFFFFFB）——data 字节数
// 必须按文件内实际剩余字节封顶（诚实 size 时 min 不改变结果）。
export function wavDurationMs(wav) {
  if (wav.subarray(0, 4).toString("ascii") !== "RIFF") {
    throw new Error("wavDurationMs: 非 RIFF 开头");
  }
  let byteRate = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString("ascii");
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      byteRate = wav.readUInt32LE(offset + 16); // fmt 体内 byteRate 字段
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("wavDurationMs: 无 data 块");
  if (byteRate <= 0) throw new Error("wavDurationMs: fmt 块缺失或 byteRate=0");
  const dataBytes = Math.min(dataSize, wav.length - dataOffset);
  return Math.round((dataBytes / byteRate) * 1000);
}

// 对齐计划：逐镜头比对 wav 实测时长 vs working version durationMs，
// 超出（含 50ms 尾样保护：wav+50 仍 > durationMs 才算安全）才入计划。
export function planDurationAlignments(project, wavMsByBase) {
  const plan = [];
  for (const [shotIndex, shot] of project.shots.entries()) {
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    if (!version) continue;
    const wavMs = wavMsByBase.get(`${shot.shotId}-${version.versionId}`);
    if (wavMs === undefined || wavMs + 50 <= version.durationMs) continue;
    plan.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: version.versionId,
      oldDurationMs: version.durationMs,
      wavMs,
      newDurationMs: Math.ceil(wavMs + 50),
    });
  }
  return plan;
}

// 字幕 cue 读取（spec R2/R3 + Review Focus #2/#3）：words.json 坏/缺/时间戳
// 全非法 → 均匀近似（fallback=true 供上层告警不阻断）；cue 越过 span 钳到
// span（--allow-truncate 路径音轨截断，字幕不能悬空显示到不存在的帧）。
export function readSubtitleCues(dir, base, narrationText, spanMs) {
  let words = [];
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(dir, `${base}.words.json`), "utf8"),
    );
    words = (parsed.sentences ?? []).flatMap((sentence) =>
      (sentence.words ?? []).map((word) => ({
        text: String(word.text ?? ""),
        beginMs: Number(word.begin_time),
        endMs: Number(word.end_time),
      })),
    );
  } catch {
    words = []; // 文件缺失/坏 JSON → 均匀回退
  }
  const built = buildSubtitleCues({ narrationText, words, spanMs });
  const fallback = words.length === 0 && narrationText.trim().length > 0;
  const cues = built
    .map((cue) => ({
      ...cue,
      startMs: Math.min(cue.startMs, spanMs),
      endMs: Math.min(cue.endMs, spanMs),
    }))
    .filter((cue) => cue.endMs > cue.startMs);
  return { cues, fallback };
}
