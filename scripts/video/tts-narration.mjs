#!/usr/bin/env node
// D2 旁白合成 CLI：项目 JSON → 逐镜头 DashScope CosyVoice TTS。
//   产物：<out>/<shotId>-<versionId>.wav（PCM16 24k mono）+ .words.json（句/字时间戳）。
//   计费：每次调用 append artifacts/tts-usage.jsonl（用户授权累计 ≤¥50，超限即停）。
// 密钥纪律：DASHSCOPE_API_KEY 只从环境读，绝不写盘/入产物/入日志。
// 原子性：单镜头先完整合成再落盘——API 失败不产生半个资产；已完成的镜头保留。
// 用法: node scripts/video/tts-narration.mjs --project <path.json> --out <dir>
//       [--voice longanyang] [--model cosyvoice-v3-flash] [--budget-cny 50]
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  buildNarrationJobs,
  estimateTtsCostCny,
  parseTtsSse,
  parseUsageLedger,
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
  },
});
if (!values.project) fail("缺 --project <path.json>");
if (!values.out) fail("缺 --out <dir>");
const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) fail("缺环境变量 DASHSCOPE_API_KEY（密钥只走 env，不读文件）");
const model = values.model;
const voice = values.voice;

// scripts/ 不进 workspace 包图，按预检裁决用相对路径引 dist。
const { validateVideoProject } = await import(
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

for (const job of jobs) {
  const estimate = estimateTtsCostCny(job.text.length * 2, model); // 中文按每字 2 计费字符估算
  if (spent + estimate > BUDGET_CNY) {
    fail(
      `预算将超限：已计费 ¥${spent.toFixed(4)} + 本次估算 ¥${estimate.toFixed(4)} > ¥${BUDGET_CNY}，停止（免费路径见 D2 计划）`,
    );
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "enable",
      Accept: "text/event-stream",
    },
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
  if (!response.ok) {
    const detail = await response.text();
    fail(
      `镜头 ${job.shotIndex + 1}（${job.shotId}）TTS HTTP ${response.status}：${detail.slice(0, 500)}`,
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
  writeFileSync(`${base}.wav`, wav);
  writeFileSync(
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
