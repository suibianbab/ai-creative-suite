// D2 Task2：DashScope TTS SSE 解析/计费估算/旁白任务构建的纯函数单测（零网络）。
// fixture 镜像 spike 抓到的真实事件形态（artifacts/d2-tts-spike/stream-response.sse.txt）：
//  - sentence-begin 带 words（可能只是前缀）与空 audio.data；
//  - sentence-synthesis 带 base64 audio.data（必须逐 chunk 解码，拼接 base64 再解会损坏）；
//  - sentence-end 带该句完整 words；
//  - task-finished 带 finish_reason:"stop" 与最终 usage；
//  - 行前缀 id:/event:/:HTTP_STATUS/data:，finish_reason 中间事件是字符串 "null"。

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  atomicWriteFile,
  buildNarrationJobs,
  decodePathName,
  describeHttpFailure,
  estimateTtsCostCny,
  parseTtsSse,
  parseUsageLedger,
  planDurationAlignments,
  readSubtitleCues,
  ttsFetchInit,
  wavDurationMs,
} from "./tts-sse.mjs";

// minor#4 原子写的落盘目录（测完即清）
const ATOMIC_DIR = mkdtempSync(path.join(tmpdir(), "acs-atomic-"));
test.after(() => rmSync(ATOMIC_DIR, { recursive: true, force: true }));

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

// 终评 Important#3：台账半行（崩溃残留）不能被静默吞掉——那会让 ¥50 预算闸
// 读到偏小的累计值而放行超支。坏行必须点名报错，由 CLI fail-fast。
test("parseUsageLedger：合法逐行求和；坏行 throw 点名行号，不静默截断", () => {
  const good = [
    '{"at":"t1","costCny":0.0034}',
    "",
    '{"at":"t2","costCny":0.0009}',
  ].join("\n");
  const entries = parseUsageLedger(good);
  assert.equal(entries.length, 2, "空行跳过");
  assert.ok(Math.abs(entries[1].costCny - 0.0009) < 1e-12);
  const corrupt = [
    '{"at":"t1","costCny":0.0034}',
    '{"at":"t2","costCny":0.00', // 崩溃残留半行
    '{"at":"t3","costCny":0.0009}',
  ].join("\n");
  assert.throws(
    () => parseUsageLedger(corrupt),
    /第 2 行/,
    "坏行必须点名行号（其后条目不得被静默丢弃）",
  );
});

// ── 终评 minor×7 补充 pass（用户裁决全修） ──────────────────────────────

// minor#7：纯空白 narrationText 是 schema 合法但 planner 不产的输入——
// 不 trim 会真金白银合成一段静音。合成/计费必须按 trim 后文本。
test("buildNarrationJobs：纯空白旁白跳过；首尾空白 trim 后再合成计费", () => {
  const jobs = buildNarrationJobs(
    project([shot("s1", "v1", "   "), shot("s2", "v2", "  要点。 ")]),
  );
  assert.deepEqual(
    jobs.map((j) => j.shotId),
    ["s2"],
    "纯空白镜头被过滤，不产生计费作业",
  );
  assert.equal(jobs[0].text, "要点。", "合成与计费按 trim 后文本");
});

// minor#1：narration-server 收到畸形 percent-encoding（如 /%zz）时
// decodeURIComponent 抛 URIError 会把服务进程带崩、连累当次渲染——
// 必须降级为 400。纯函数层返回 null，服务层据此回 400。
test("decodePathName：正常名还原；畸形 percent-encoding 返回 null（服务回 400 不崩）", () => {
  assert.equal(decodePathName("a-b.wav"), "a-b.wav");
  assert.equal(decodePathName("%E6%B0%B4.wav"), "水.wav");
  assert.equal(decodePathName("%zz.wav"), null);
  assert.equal(decodePathName("%"), null);
});

// minor#2：HTTP 失败时 request_id 埋在 body 里，排障要对账（DashScope 工单
// 必填）——必须显式点名，而不是指望它在 body 前 500 字里碰巧可见。
test("describeHttpFailure：JSON body 提取 request_id 单独点名；非 JSON body 不炸", () => {
  const msg = describeHttpFailure(
    429,
    '{"request_id":"req-abc","message":"throttled"}',
  );
  assert.match(msg, /HTTP 429/);
  assert.match(msg, /request_id=req-abc/);
  const plain = describeHttpFailure(502, "<html>Bad Gateway");
  assert.match(plain, /HTTP 502/);
  assert.match(plain, /Bad Gateway/);
});

// minor#3：裸跑 CLI 时 DashScope 挂起会让 fetch 永等（e2e 包装有 300s 兜底，
// 手工路径没有）——请求必须自带 AbortSignal 超时。
test("ttsFetchInit：带认证/SSE 头与 AbortSignal 超时（挂起调用被掐断而非永等）", () => {
  const init = ttsFetchInit("sk-test", 60000);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer sk-test");
  assert.equal(init.headers.Accept, "text/event-stream");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
});

// minor#4：直接写目标文件，崩溃在写盘中途会留半个 wav 被下次装配当正常资产
// （装配只看文件存在）——tmp+rename 让崩溃最多留下没用的 .tmp。
test("atomicWriteFile：tmp+rename 落盘完整内容，不留 .tmp 残留；覆盖写生效", () => {
  const file = path.join(ATOMIC_DIR, "s1-v1.wav");
  atomicWriteFile(file, Buffer.from("RIFF-full"));
  assert.equal(readFileSync(file, "utf8"), "RIFF-full");
  assert.equal(existsSync(`${file}.tmp`), false, "rename 后不留临时文件");
  atomicWriteFile(file, Buffer.from("RIFF-full-v2"));
  assert.equal(readFileSync(file, "utf8"), "RIFF-full-v2", "重写覆盖旧内容");
});

// —— 时长对齐（spec R4 合成期兜底）——

// 构造最小合法 WAV 头（RIFF/fmt PCM16/mono/24k + data 块）
function wavBuffer(dataBytes, byteRate = 48000) {
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

test("wavDurationMs：PCM16 24k mono 头解析；非 RIFF/无 data 拒绝", () => {
  assert.equal(wavDurationMs(wavBuffer(48000 * 2)), 2000); // 2 秒
  assert.equal(wavDurationMs(wavBuffer(24000)), 500);
  assert.throws(() => wavDurationMs(Buffer.from("NOTAWAV!")), /非 RIFF/);
  assert.throws(() => wavDurationMs(wavBuffer(0).subarray(0, 40)), /无 data/);
});

// e2e 实录（Task 7）：DashScope 流式合成在 data 头写占位 size 0x7FFFFFFB，
// 63404B 文件被算成 44739241ms（~44.7 天）→ 对齐版本 durationMs 超 schema
// 上限被 validate 拒绝。真实时长必须按文件内实际 data 字节换算。
test("wavDurationMs：data 头 size 为流式哨兵（超文件长度）时按实际字节换算", () => {
  const sentinel = wavBuffer(63360); // 63360B @48000B/s = 1320ms
  sentinel.writeUInt32LE(0x7ffffffb, 40); // 覆写 data size 为流式占位
  assert.equal(wavDurationMs(sentinel), 1320);
  // 诚实 size 的结果不变（min 语义不改变合法输入）
  assert.equal(wavDurationMs(wavBuffer(48000)), 1000);
});

test("planDurationAlignments：只报超出的镜头，newDurationMs=wav+50 尾样保护", () => {
  const project = {
    shots: [
      {
        shotId: "s1",
        workingVersionId: "v1",
        contentVersions: [
          { versionId: "v1", durationMs: 2000, narrationText: "水循环。" },
        ],
      },
      {
        shotId: "s2",
        workingVersionId: "v2",
        contentVersions: [
          { versionId: "v2", durationMs: 3000, narrationText: "谢谢观看。" },
        ],
      },
    ],
  };
  const overflow = new Map([
    ["s1-v1", 2640],
    ["s2-v2", 1500],
  ]);
  const plan = planDurationAlignments(project, overflow);
  assert.equal(plan.length, 1, "只报超出版本时长的镜头");
  assert.equal(plan[0].shotIndex, 0);
  assert.equal(plan[0].shotId, "s1");
  assert.equal(plan[0].versionId, "v1");
  assert.equal(plan[0].oldDurationMs, 2000);
  assert.equal(plan[0].wavMs, 2640);
  assert.equal(plan[0].newDurationMs, 2690);
  // 恰好等长（2640+50 > 2690?否——2640+50=2690 === 2690 不算超出）
  const edge = new Map([
    ["s1-v1", 1950],
    ["s2-v2", 1500],
  ]);
  assert.equal(planDurationAlignments(project, edge).length, 0);
  // 无对应 wav 记录的镜头不报（未合成）
  assert.equal(planDurationAlignments(project, new Map()).length, 0);
});

// ── 终评 fix pass（Important#2/#5）────────────────────────────────────

// 终评 Important#5：words.json 存在但时间戳全非法（Number("x")=NaN、倒挂）
// 时，旧判据 words.length === 0 漏判 → fallback 不置位，上层无法告警
// 「字幕走了均匀近似」。合法性必须与 buildSubtitleCues 同一谓词。
const WORDS_DIR = mkdtempSync(path.join(tmpdir(), "acs-words-"));
test.after(() => rmSync(WORDS_DIR, { recursive: true, force: true }));

test("readSubtitleCues：时间戳全非法（NaN/倒挂）→ fallback=true 走均匀近似", () => {
  writeFileSync(
    path.join(WORDS_DIR, "s1-v1.words.json"),
    JSON.stringify({
      sentences: [
        {
          words: [
            { text: "水", begin_time: "x", end_time: "y" }, // Number → NaN
            { text: "循", begin_time: 800, end_time: 600 }, // 倒挂 end<begin
          ],
        },
      ],
    }),
  );
  const bad = readSubtitleCues(WORDS_DIR, "s1-v1", "水循环。", 1200);
  assert.equal(bad.fallback, true, "全非法时间戳必须置 fallback 供上层告警");
  assert.equal(bad.cues.length, 1, "回退均匀：整句一条");
  assert.equal(bad.cues[0].text, "水循环。");
  assert.equal(bad.cues[0].endMs, 1200);

  // 合法时间戳 → fallback=false（判据收紧不能误伤正常路径）
  writeFileSync(
    path.join(WORDS_DIR, "s2-v1.words.json"),
    JSON.stringify({
      sentences: [
        {
          words: [{ text: "水", begin_time: 0, end_time: 400 }],
        },
      ],
    }),
  );
  const ok = readSubtitleCues(WORDS_DIR, "s2-v1", "水。", 1200);
  assert.equal(ok.fallback, false, "合法字级时间戳不是近似");
  assert.equal(ok.cues[0].text, "水。");
});

// 终评 Important#2：对齐版本的构造/校验必须先于落盘与资产 rename——
// 旧序在循环里先 rename，validate 抛出时 4 对 wav/words 已离键成孤儿
//（e2e 里靠 rmSync 自愈，真实使用会「旁白资产缺失」）。纯函数层先证
// 明「构造+校验」可独立通过，CLI 再按 写档→rename 的次序消费。
// validateVideoProject 可过的最小项目（UUID/description 齐全）——
// applyDurationAlignments 的校验在函数内完成，fixture 必须本身合法。
const SHOT_ID = "11111111-1111-4111-8111-111111111111";
const VER_ID = "22222222-2222-4222-8222-222222222222";

function alignableProject(durationMs = 2000) {
  return {
    schemaVersion: 1,
    id: "33333333-3333-4333-8333-333333333333",
    title: "水循环",
    brief: { sentence: "做一个水循环短片", aspectTargets: ["landscape"] },
    shots: [
      {
        shotId: SHOT_ID,
        order: 0,
        locked: false,
        workingVersionId: VER_ID,
        contentVersions: [
          {
            versionId: VER_ID,
            createdAt: "2026-10-18T00:00:00.000Z",
            durationMs,
            description: "开场：点名主题",
            narrationText: "水循环。",
            sceneSource: { type: "spec", spec: { durationMs } },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [],
      },
    ],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

test("applyDurationAlignments：纯函数追加新版本+前移 working+返回重键清单，不 mutate 入参", async () => {
  const { applyDurationAlignments } = await import("./tts-sse.mjs");
  const src = alignableProject();
  const plan = [
    {
      shotIndex: 0,
      shotId: SHOT_ID,
      versionId: VER_ID,
      oldDurationMs: 2000,
      wavMs: 2640,
      newDurationMs: 2690,
    },
  ];
  const NEW_ID = "44444444-4444-4444-8444-444444444444";
  const { project: out, renames } = applyDurationAlignments(
    src,
    plan,
    () => NEW_ID,
  );
  assert.equal(renames.length, 1, "rename 清单与计划一一对应");
  assert.equal(renames[0].shotId, SHOT_ID);
  assert.equal(renames[0].fromVersionId, VER_ID);
  assert.equal(renames[0].toVersionId, NEW_ID);

  const aligned = out.shots[0].contentVersions.find(
    (v) => v.versionId === NEW_ID,
  );
  assert.equal(aligned.durationMs, 2690, "wav+50 尾样保护");
  assert.equal(aligned.narrationText, "水循环。", "同文案只调时长");
  assert.equal(
    aligned.provenance.engineId,
    "tts-duration-align",
    "演进来源留痕",
  );
  assert.equal(
    aligned.provenance.parentVersionId,
    VER_ID,
    "父版本指向旧版本（只追加演进的链）",
  );
  assert.equal(out.shots[0].workingVersionId, NEW_ID, "working 前移");
  assert.equal(out.shots[0].contentVersions.length, 2, "只追加不改写旧版本");
  assert.equal(out.savedVersion, src.savedVersion + 1, "回写档位 +1");

  assert.equal(
    src.shots[0].workingVersionId,
    VER_ID,
    "入参未被 mutate（CLI 依此做写前校验）",
  );
  assert.equal(src.shots[0].contentVersions.length, 1);
});

test("applyDurationAlignments：荒谬时长过不了 validateVideoProject → throw（磁盘 untouched 由调用方次序保证）", async () => {
  const { applyDurationAlignments } = await import("./tts-sse.mjs");
  const src = alignableProject();
  const plan = [
    {
      shotIndex: 0,
      shotId: SHOT_ID,
      versionId: VER_ID,
      oldDurationMs: 2000,
      wavMs: 44739241 - 50,
      newDurationMs: 44739241, // e2e 实录的流式哨兵时长（~44.7 天）
    },
  ];
  assert.throws(
    () =>
      applyDurationAlignments(
        src,
        plan,
        () => "55555555-5555-4555-8555-555555555555",
      ),
    /durationMs must be an integer between 1 and 600000/,
    "schema 上限必须在校验层拦住，而不是等落盘后渲染失败",
  );
  assert.equal(src.shots[0].contentVersions.length, 1, "throw 后入参原样");
});
