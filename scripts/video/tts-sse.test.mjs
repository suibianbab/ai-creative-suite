// D2 Task2：DashScope TTS SSE 解析/计费估算/旁白任务构建的纯函数单测（零网络）。
// fixture 镜像 spike 抓到的真实事件形态（artifacts/d2-tts-spike/stream-response.sse.txt）：
//  - sentence-begin 带 words（可能只是前缀）与空 audio.data；
//  - sentence-synthesis 带 base64 audio.data（必须逐 chunk 解码，拼接 base64 再解会损坏）；
//  - sentence-end 带该句完整 words；
//  - task-finished 带 finish_reason:"stop" 与最终 usage；
//  - 行前缀 id:/event:/:HTTP_STATUS/data:，finish_reason 中间事件是字符串 "null"。

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNarrationJobs,
  estimateTtsCostCny,
  parseTtsSse,
} from "./tts-sse.mjs";

// 两个合成 chunk + 一句 begin/end：镜像真实流的字段结构（字节量缩小）。
const WAV_HEAD = Buffer.from(
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0Yf////8=",
  "base64",
); // RIFF 头 + 4 字节静音数据（合成用，内容任意）

function sseLine(data) {
  return `data:${JSON.stringify(data)}\n\n`;
}

function sentenceEvent(index, words, audioBase64, type) {
  return {
    output: {
      sentence: { index, words },
      audio: { data: audioBase64 ?? "" },
      finish_reason: "null",
      type,
    },
    request_id: "req-fixture",
  };
}

const WORDS_S0 = [
  { text: "水", begin_index: 0, end_index: 1, begin_time: 320, end_time: 600 },
  { text: "循", begin_index: 1, end_index: 2, begin_time: 600, end_time: 800 },
];

function fixtureStream() {
  const chunks = [
    sentenceEvent(0, WORDS_S0.slice(0, 1), "", "sentence-begin"),
    sentenceEvent(
      0,
      [],
      WAV_HEAD.subarray(0, 22).toString("base64"),
      "sentence-synthesis",
    ),
    sentenceEvent(
      0,
      [],
      WAV_HEAD.subarray(22).toString("base64"),
      "sentence-synthesis",
    ),
    sentenceEvent(0, WORDS_S0, "", "sentence-end"),
    {
      output: { finish_reason: "stop" },
      usage: { characters: 4 },
      request_id: "req-fixture",
    },
  ];
  // 混入非 JSON 行与注释行，解析必须容错跳过
  return (
    "id:1\nevent:result\n:HTTP_STATUS/200\n" +
    chunks.map(sseLine).join("") +
    ":keep-alive\n\nnot-json\n\n"
  );
}

test("parseTtsSse：逐 chunk 解码拼接音频、保留字级时间戳、提取 usage/request_id", () => {
  const parsed = parseTtsSse(fixtureStream());
  assert.equal(parsed.requestId, "req-fixture");
  assert.equal(parsed.usage.characters, 4);
  assert.equal(
    parsed.audioChunks.length,
    2,
    "只有 synthesis 事件贡献音频 chunk",
  );
  const wav = Buffer.concat(parsed.audioChunks);
  assert.deepEqual(wav, WAV_HEAD, "逐 chunk 解码后拼接必须还原原字节");
  assert.equal(
    wav.subarray(0, 4).toString("ascii"),
    "RIFF",
    "拼出的字节是 WAV",
  );
  assert.equal(parsed.sentences.length, 1);
  assert.equal(parsed.sentences[0].index, 0);
  assert.deepEqual(
    parsed.sentences[0].words,
    WORDS_S0,
    "sentence-end 的完整 words 覆盖 begin 的前缀",
  );
});

test("parseTtsSse：finish_reason 非 stop 时带出，供 CLI 判失败", () => {
  const stream = sseLine({
    output: { finish_reason: "cancelled" },
    usage: { characters: 0 },
    request_id: "req-x",
  });
  const parsed = parseTtsSse(stream);
  assert.equal(parsed.finishReason, "cancelled");
});

test("estimateTtsCostCny：v3-flash 按服务端计费口径（汉字=2）估算 ¥1/万字符", () => {
  // 服务端 usage.characters 对中文按每字 2 计：spike 18 个可见字符 → usage 34。
  assert.equal(estimateTtsCostCny(34, "cosyvoice-v3-flash"), 0.0034);
  assert.equal(estimateTtsCostCny(10000, "cosyvoice-v3-flash"), 1);
  assert.equal(estimateTtsCostCny(0, "cosyvoice-v3-flash"), 0);
});

// buildNarrationJobs 输入 = VideoProject 形状（只取用到的字段）。
function shot(shotId, versionId, narrationText) {
  return {
    shotId,
    order: 0,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: "2026-10-18T00:00:00.000Z",
        durationMs: 7500,
        description: "",
        narrationText,
        sceneSource: { type: "spec", spec: {} },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [],
  };
}

function project(shots) {
  return {
    schemaVersion: 1,
    id: "p1",
    title: "t",
    brief: { sentence: "s", aspectTargets: ["landscape"] },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

test("buildNarrationJobs：取 working version 的 narrationText，空文本镜头被过滤", () => {
  const jobs = buildNarrationJobs(
    project([
      shot("s1", "v1", "勾股定理。"),
      shot("s2", "v2", ""),
      shot("s3", "v3", "谢谢观看。"),
    ]),
  );
  assert.deepEqual(
    jobs.map((j) => j.shotId),
    ["s1", "s3"],
  );
  assert.equal(jobs[0].versionId, "v1");
  assert.equal(jobs[0].text, "勾股定理。");
  assert.equal(
    jobs[0].shotIndex,
    0,
    "shotIndex 是项目内镜头下标（含被过滤者）",
  );
  assert.equal(jobs[1].shotIndex, 2);
});

test("buildNarrationJobs：无镜头项目 throw；>2000 字符 throw 点名镜头", () => {
  assert.throws(() => buildNarrationJobs(project([])), /镜头/);
  const long = "水".repeat(2001);
  assert.throws(
    () => buildNarrationJobs(project([shot("s9", "v9", long)])),
    /镜头 1.*2001/,
    "错误必须点名镜头序号与实际长度",
  );
  // 2000 恰好合法（ContentVersion 上限）
  const ok = buildNarrationJobs(project([shot("s8", "v8", "水".repeat(2000))]));
  assert.equal(ok.length, 1);
});
