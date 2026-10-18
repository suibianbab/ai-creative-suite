#!/usr/bin/env node
// D2 旁白合成 CLI：项目 JSON → 逐镜头 DashScope CosyVoice TTS。
//   产物：<out>/<shotId>-<versionId>.wav（PCM16 24k mono）+ .words.json（句/字时间戳）。
//   计费：每次调用 append artifacts/tts-usage.jsonl（用户授权累计 ≤¥50，超限即停）。
// 密钥纪律：DASHSCOPE_API_KEY 只从环境读，绝不写盘/入产物/入日志。
// 原子性：单镜头先完整合成再落盘（tmp+rename 原子替换）——API 失败不产生半个
//   资产；写盘中途崩溃也只留 .tmp，不会被下次装配误用；已完成的镜头保留。
// 用法: node scripts/video/tts-narration.mjs --project <path.json> --out <dir>
//       [--voice longanyang] [--model cosyvoice-v3-flash]
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  atomicWriteFile,
  buildNarrationJobs,
  describeHttpFailure,
  estimateTtsCostCny,
  parseTtsSse,
  parseUsageLedger,
  planDurationAlignments,
  ttsFetchInit,
  wavDurationMs,
} from "./tts-sse.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const USAGE_LEDGER = path.join(ROOT, "artifacts", "tts-usage.jsonl");
const BUDGET_CNY = 50; // 用户授权的累计计费上限（会话裁决）

function fail(message) {
  console.error(`tts-narration: ${message}`);
  process.exit(1);
}

function ledgerTotalCny() {
  let text;
  try {
    text = readFileSync(USAGE_LEDGER, "utf8");
  } catch {
    return 0; /* 台账不存在 = 首次调用，从 0 起 */
  }
  // 坏行（崩溃残留半行）会 throw 点名行号——预算闸宁可停也不读偏小值放行超支
  return parseUsageLedger(text).reduce(
    (total, entry) => total + (entry.costCny ?? 0),
    0,
  );
}

function appendUsage(entry) {
  mkdirSync(path.dirname(USAGE_LEDGER), { recursive: true });
  appendFileSync(USAGE_LEDGER, `${JSON.stringify(entry)}\n`);
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    out: { type: "string" },
    voice: { type: "string", default: "longanyang" },
    model: { type: "string", default: "cosyvoice-v3-flash" },
    // spec R4：显式选择保留截断（跳过时长对齐，渲染期配合 --allow-truncate）
    allowTruncate: { type: "boolean" },
  },
});
if (!values.project) fail("缺 --project <path.json>");
if (!values.out) fail("缺 --out <dir>");
const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) fail("缺环境变量 DASHSCOPE_API_KEY（密钥只走 env，不读文件）");
const model = values.model;
const voice = values.voice;

// scripts/ 不进 workspace 包图，按预检裁决用相对路径引 dist。
const { assertAppendOnlyEvolution, validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

const project = JSON.parse(readFileSync(values.project, "utf8"));
validateVideoProject(project);

const jobs = buildNarrationJobs(project);
if (jobs.length === 0) {
  console.log("没有需要合成的旁白（所有镜头 narrationText 为空），退出");
  process.exit(0);
}
console.log(
  `旁白作业 ${jobs.length} 个（model=${model} voice=${voice}），输出 ${values.out}`,
);

let spent = ledgerTotalCny();
mkdirSync(values.out, { recursive: true });
// 时长对齐输入（spec R4 合成期兜底）：<shotId>-<versionId> → wav 实测毫秒
const wavMsByBase = new Map();

for (const job of jobs) {
  const estimate = estimateTtsCostCny(job.text.length * 2, model); // 中文按每字 2 计费字符估算
  if (spent + estimate > BUDGET_CNY) {
    fail(
      `预算将超限：已计费 ¥${spent.toFixed(4)} + 本次估算 ¥${estimate.toFixed(4)} > ¥${BUDGET_CNY}，停止（免费路径见 D2 计划）`,
    );
  }

  // ttsFetchInit：认证/SSE 头 + 120s AbortSignal——DashScope 挂起时掐断请求
  // 而非永等（裸跑 CLI 无 e2e 包装的 300s 兜底，终评 minor#3）
  let response;
  try {
    response = await fetch(ENDPOINT, {
      ...ttsFetchInit(apiKey),
      body: JSON.stringify({
        model,
        input: {
          text: job.text,
          voice,
          format: "wav",
          sample_rate: 24000,
          word_timestamp_enabled: true,
        },
      }),
    });
  } catch (error) {
    fail(
      `镜头 ${job.shotIndex + 1}（${job.shotId}）TTS 请求失败（120s 超时或网络错误）: ${error.message}`,
    );
  }
  if (!response.ok) {
    // request_id 显式点名（终评 minor#2）：DashScope 对账/工单必填
    fail(
      `镜头 ${job.shotIndex + 1}（${job.shotId}）TTS ${describeHttpFailure(response.status, await response.text())}`,
    );
  }

  const parsed = parseTtsSse(await response.text());
  if (parsed.finishReason !== "stop") {
    fail(
      `镜头 ${job.shotIndex + 1}（${job.shotId}）合成未正常结束：finish_reason=${parsed.finishReason ?? "缺失"} request_id=${parsed.requestId ?? "?"}`,
    );
  }
  const wav = Buffer.concat(parsed.audioChunks);
  if (wav.subarray(0, 4).toString("ascii") !== "RIFF") {
    fail(
      `镜头 ${job.shotIndex + 1}（${job.shotId}）音频字节异常（非 RIFF 开头，${wav.byteLength}B），拒绝落盘`,
    );
  }

  const base = path.join(values.out, `${job.shotId}-${job.versionId}`);
  // tmp+rename 原子写（终评 minor#4）：写盘中途崩溃只留 .tmp，
  // 不会留半个 wav 被下次装配当正常资产
  atomicWriteFile(`${base}.wav`, wav);
  atomicWriteFile(
    `${base}.words.json`,
    `${JSON.stringify(
      {
        requestId: parsed.requestId,
        model,
        voice,
        usage: parsed.usage,
        sentences: parsed.sentences,
      },
      null,
      2,
    )}\n`,
  );
  wavMsByBase.set(`${job.shotId}-${job.versionId}`, wavDurationMs(wav));

  const characters = parsed.usage?.characters ?? 0;
  const costCny = estimateTtsCostCny(characters, model);
  appendUsage({
    at: new Date().toISOString(),
    purpose: "video-studio-d2-narration",
    model,
    voice,
    shotId: job.shotId,
    versionId: job.versionId,
    requestId: parsed.requestId,
    characters,
    costCny,
  });
  spent += costCny;
  console.log(
    `镜头 ${job.shotIndex + 1}/${project.shots.length} ${job.shotId} → ${path.basename(base)}.wav ` +
      `(${wav.byteLength}B, ${parsed.sentences.length} 句, characters=${characters}, ¥${costCny.toFixed(4)}, 累计 ¥${spent.toFixed(4)})`,
  );
}

console.log(
  `完成 ${jobs.length} 个旁白资产；本次会话累计计费 ¥${spent.toFixed(4)}（预算 ¥${BUDGET_CNY}）`,
);

// —— 时长对齐（spec R4 合成期兜底）：wav 实测超出版本时长的镜头写新
// ContentVersion（同文案、durationMs=wav+50 尾样保护），workingVersionId 前移，
// wav/words.json rename 重键到新 versionId（rename 成功才写档——重键与版本构造
// 同批完成，不留「新版本无资产」的悬空态）。--allow-truncate 则跳过（保留
// 渲染期截断，那是显式选择）。
const alignments = planDurationAlignments(project, wavMsByBase);
if (alignments.length > 0) {
  if (values.allowTruncate) {
    for (const item of alignments) {
      console.warn(
        `[tts-narration] --allow-truncate：镜头 ${item.shotIndex + 1} 旁白 ${item.wavMs}ms 超版本时长 ${item.oldDurationMs}ms，保留截断（渲染期同样需 --allow-truncate）`,
      );
    }
  } else {
    for (const item of alignments) {
      const shot = project.shots[item.shotIndex];
      const old = shot.contentVersions.find(
        (version) => version.versionId === item.versionId,
      );
      const newVersionId = randomUUID();
      const aligned = structuredClone(old);
      aligned.versionId = newVersionId;
      aligned.createdAt = new Date().toISOString();
      aligned.durationMs = item.newDurationMs;
      aligned.description = `${old.description.slice(0, 160)}（时长对齐 ${item.newDurationMs}ms）`;
      if (aligned.sceneSource.type === "spec")
        aligned.sceneSource.spec.durationMs = item.newDurationMs;
      aligned.provenance = {
        engineId: "tts-duration-align",
        engineVersion: "1",
        parentVersionId: item.versionId,
      };
      shot.contentVersions.push(aligned);
      shot.events.push({
        kind: "submitted",
        versionId: newVersionId,
        at: aligned.createdAt,
        actor: "ai",
      });
      shot.workingVersionId = newVersionId;
      renameSync(
        path.join(values.out, `${item.shotId}-${item.versionId}.wav`),
        path.join(values.out, `${item.shotId}-${newVersionId}.wav`),
      );
      renameSync(
        path.join(values.out, `${item.shotId}-${item.versionId}.words.json`),
        path.join(values.out, `${item.shotId}-${newVersionId}.words.json`),
      );
      console.log(
        `[tts-narration] 镜头 ${item.shotIndex + 1} 时长对齐: ${item.oldDurationMs}ms → ${item.newDurationMs}ms（旁白实测 ${item.wavMs}ms），资产已重键`,
      );
    }
    project.savedVersion += 1;
    const previous = validateVideoProject(
      JSON.parse(readFileSync(values.project, "utf8")),
    );
    const next = validateVideoProject(project);
    assertAppendOnlyEvolution(previous, next);
    atomicWriteFile(values.project, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `[tts-narration] 项目回写 ${path.basename(values.project)}（savedVersion=${next.savedVersion}，时长对齐 ${alignments.length} 个镜头）`,
    );
  }
}
