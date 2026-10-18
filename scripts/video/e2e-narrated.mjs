#!/usr/bin/env node
// D2 有声端到端闭环验收（真实工作台链路 + 真实计费 TTS）：
//   浏览器新建→STEM 分镜规划→分镜确认卡→追加应用（4 镜头，旁白文本镜头卡可见）
//   →保存→导出 JSON→tts-narration CLI（DashScope 计费合成 wav+字级时间戳）
//   →render-scene --narration 整片双画幅出片（aac 音轨 + 字幕烧录）→浏览器导入
//   同一 JSON →旁白文本与渲染记录回显。字幕双核验：manifest cue 摘要 +
//   底带暗像素（cue 时刻 vs pre-cue 时刻）。控制台零 error；SHA-256 与计费
//   台账逐笔打印。
// 前置: @acs/web dev server 已在 BASE_URL（默认 http://localhost:3210）；
//       packages/{video-document,video-scene} 已 build；env DASHSCOPE_API_KEY（只从
//       环境读，绝不落盘）；ffprobe 在 PATH。
// exit 0 = 有声闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
// cue 时刻从首镜头字级时间戳推导，必须与渲染器同一实现源（spec R1 单一事实）
import { readSubtitleCues } from "./tts-sse.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-narrated");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const NARRATION_DIR = path.join(OUT_DIR, "narration");
const RENDER_DIR = path.join(OUT_DIR, "e2e-render");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const SHOT_COUNT = 4;
const FPS = 24;

if (!process.env.DASHSCOPE_API_KEY) {
  console.error(
    "[e2e-narrated] 缺少 env DASHSCOPE_API_KEY（只从环境读，不落盘）",
  );
  process.exit(1);
}

function fail(step, detail) {
  console.error(`[e2e-narrated] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(page, selector, step) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${selector}`));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// ffprobe 音轨核对（独立于 render-scene 的内置检查，双重证据）
function probeAudio(video, step) {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      video,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) fail(step, `ffprobe 失败: ${r.stderr}`);
  const meta = JSON.parse(r.stdout);
  return {
    codec: meta.streams?.[0]?.codec_name,
    duration: Number(meta.format?.duration),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });
rmSync(NARRATION_DIR, { recursive: true, force: true });
rmSync(RENDER_DIR, { recursive: true, force: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});

// —— 去程：新建 → 分镜规划 → 确认卡 → 追加应用 → 旁白可见 → 保存 → 导出 ——
await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
// 客户端就绪：SSR 的 HTML 里按钮已可见 ≠ React 已接管点击（外部复核实测
// domcontentloaded 后立即点击会被丢、随后输入框超时）。html[data-studio-ready]
// 由水合后的 useEffect 设置，是确定性就绪信号。
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await expectVisible(page, ".project-create", "打开工作台");
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await expectVisible(page, ".storyboard-card", "分镜确认卡");
await page.click(".plan-apply");
await page
  .locator(".editor-message", { hasText: "首个 4 个镜头" })
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("追加应用", "未出现 首个镜头 提示"));

// 旁白文本在镜头卡可见（D2 Task5：工作台不藏旁白）
await expectVisible(page, ".editor-shots", "镜头时间线");
const narrationTexts = await page
  .locator(".shot-card .shot-narration")
  .allTextContents();
if (narrationTexts.length !== SHOT_COUNT)
  fail("镜头卡旁白", `旁白行数 ${narrationTexts.length} ≠ ${SHOT_COUNT}`);
for (const [index, text] of narrationTexts.entries()) {
  if (text.trim().length === 0)
    fail("镜头卡旁白", `镜头 ${index + 1} 旁白为空`);
}
if (!/水循环/.test(narrationTexts[0] ?? ""))
  fail("镜头卡旁白", `首镜头未点名主题: ${narrationTexts[0]}`);
if (!/谢谢观看/.test(narrationTexts.at(-1) ?? ""))
  fail("镜头卡旁白", `末镜头非结语: ${narrationTexts.at(-1)}`);

await page.click(".editor-save");
await page
  .locator(".editor-message", { hasText: "已保存" })
  .waitFor({ timeout: 15_000 })
  .catch(() => fail("保存", "未出现 已保存 提示"));

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
if (!existsSync(EXPORTED)) fail("导出", "下载文件未落盘");

const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const projectId = exported.id;
const versions = exported.shots.map((shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId),
);
if (!projectId || versions.length !== SHOT_COUNT)
  fail("导出", `导出件缺 id 或镜头数 ≠ ${SHOT_COUNT}`);
for (const [index, version] of versions.entries()) {
  if (!version?.narrationText)
    fail("导出", `镜头 ${index + 1} narrationText 缺失`);
}
if (versions.at(-1)?.narrationText !== "谢谢观看。")
  fail("导出", `末镜头旁白 ≠ 谢谢观看。: ${versions.at(-1)?.narrationText}`);
console.log(
  `[e2e-narrated] 去程完成: 项目 ${projectId} v${exported.savedVersion}，${SHOT_COUNT} 镜头旁白齐备`,
);

// —— CLI：DashScope TTS 合成（真实计费）→ wav + 字级时间戳 ——
const tts = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/tts-narration.mjs"),
    "--project",
    EXPORTED,
    "--out",
    NARRATION_DIR,
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 300_000 },
);
if (tts.status !== 0)
  fail("TTS 合成", `${tts.stdout ?? ""}\n${tts.stderr ?? ""}`);
const wavs = readdirSync(NARRATION_DIR).filter((f) => f.endsWith(".wav"));
const words = readdirSync(NARRATION_DIR).filter((f) =>
  f.endsWith(".words.json"),
);
if (wavs.length !== SHOT_COUNT || words.length !== SHOT_COUNT)
  fail(
    "TTS 合成",
    `wav ${wavs.length} / words ${words.length} ≠ ${SHOT_COUNT}`,
  );
let billedCharacters = 0;
for (const wordsFile of words) {
  const meta = JSON.parse(
    readFileSync(path.join(NARRATION_DIR, wordsFile), "utf8"),
  );
  if (!meta.requestId || !(meta.usage?.characters > 0))
    fail("TTS 合成", `${wordsFile} 缺 requestId/usage`);
  if (!Array.isArray(meta.sentences) || meta.sentences.length === 0)
    fail("TTS 合成", `${wordsFile} 缺字级时间戳`);
  billedCharacters += meta.usage.characters;
}
console.log(
  `[e2e-narrated] TTS 完成: ${wavs.length} wav + ${words.length} 字级时间戳，计费字符 ${billedCharacters}`,
);

// TTS 后项目可能被时长对齐回写（spec R4 合成期兜底）：重读落盘件核对——
// 资产键必须 = working versionId（对齐发生时 tts-narration 已 rename 重键），
// 对齐版本时长只增不减且 provenance 点名 tts-duration-align。
const afterTts = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (afterTts.id !== projectId) fail("TTS 时长对齐", "项目 ID 被改写");
let alignedCount = 0;
for (const [index, shot] of afterTts.shots.entries()) {
  const working = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  if (!working?.narrationText)
    fail("TTS 时长对齐", `镜头 ${index + 1} working version 旁白缺失`);
  const base = `${shot.shotId}-${shot.workingVersionId}`;
  if (!existsSync(path.join(NARRATION_DIR, `${base}.wav`)))
    fail("TTS 时长对齐", `对齐后资产键脱节: ${base}.wav 缺失`);
  const original = versions[index];
  if (working.versionId !== original.versionId) {
    alignedCount += 1;
    if (working.durationMs <= original.durationMs)
      fail("TTS 时长对齐", `镜头 ${index + 1} 对齐版本时长未增长`);
    if (working.provenance?.engineId !== "tts-duration-align")
      fail("TTS 时长对齐", `镜头 ${index + 1} 对齐版本 provenance 异常`);
  }
}
console.log(
  `[e2e-narrated] 时长对齐: ${alignedCount} 个镜头${alignedCount > 0 ? `（v${exported.savedVersion} → v${afterTts.savedVersion}）` : "（语速预估已覆盖，无需对齐）"}`,
);

// —— CLI：整片双画幅出片（含逐帧干跑）+ 旁白音轨装配 + RenderRecord×8 回写 ——
const render = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    EXPORTED,
    "--out",
    RENDER_DIR,
    "--narration",
    NARRATION_DIR,
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 900_000 },
);
if (render.status !== 0)
  fail("CLI 整片渲染", `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
const rendered = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (rendered.id !== projectId) fail("CLI 整片渲染", "项目 ID 被改写");
if (rendered.savedVersion !== afterTts.savedVersion + 1)
  fail(
    "CLI 整片渲染",
    `savedVersion 应比对齐后再 +1（${afterTts.savedVersion} → ${rendered.savedVersion}）`,
  );
if (rendered.renderRecords.length !== exported.renderRecords.length + 8)
  fail(
    "CLI 整片渲染",
    `RenderRecord 应 +8，实际 +${rendered.renderRecords.length - exported.renderRecords.length}`,
  );

// 独立音轨核对：双画幅都要 aac + 时长与视频一致（±0.1s）。
// 整片时长 = Σ working version durationMs（对齐版本在最后，contentVersions[0]
// 是规划版本——T5 后不能再按下标 0 取），从实际值推导不写死秒数。
const totalMs = rendered.shots.reduce((acc, shot) => {
  const working = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  return acc + working.durationMs;
}, 0);
const plannedTotalMs = versions.reduce((acc, v) => acc + v.durationMs, 0);
if (plannedTotalMs <= 8000)
  fail(
    "时长推导",
    `speech-aware 规划总时长 ${plannedTotalMs}ms 未超过 8s 目标`,
  );
if (totalMs < plannedTotalMs)
  fail(
    "时长推导",
    `整片 ${totalMs}ms < 规划 ${plannedTotalMs}ms（对齐只增不减）`,
  );
console.log(
  `[e2e-narrated] 时长: 规划 ${plannedTotalMs}ms（speech-aware）→ 出片 ${totalMs}ms`,
);
const expectedSeconds = Math.round((totalMs / 1000) * FPS) / FPS;
for (const aspect of ["landscape", "portrait"]) {
  const video = path.join(RENDER_DIR, `${aspect}.mp4`);
  const audio = probeAudio(video, `音轨核对 ${aspect}`);
  if (audio.codec !== "aac")
    fail(`音轨核对 ${aspect}`, `codec ${audio.codec} ≠ aac`);
  if (Math.abs(audio.duration - expectedSeconds) > 0.1)
    fail(
      `音轨核对 ${aspect}`,
      `时长 ${audio.duration}s 与视频 ${expectedSeconds}s 不一致`,
    );
}
const manifest = JSON.parse(
  readFileSync(path.join(RENDER_DIR, "render-manifest.json"), "utf8"),
);
for (const aspect of ["landscape", "portrait"]) {
  const narration = manifest.aspects[aspect]?.narration;
  if (!Array.isArray(narration) || narration.length !== SHOT_COUNT)
    fail("manifest 旁白", `${aspect}.narration 缺失或镜头数 ≠ ${SHOT_COUNT}`);
}

// 字幕烧录核验之一（spec R5）：manifest 摘要——逐镜头 cue 数 + 文本 SHA-256。
for (const aspect of ["landscape", "portrait"]) {
  const summary = manifest.aspects[aspect]?.subtitleCues;
  if (!Array.isArray(summary) || summary.length !== SHOT_COUNT)
    fail(
      "manifest 字幕",
      `${aspect}.subtitleCues 缺失或镜头数 ≠ ${SHOT_COUNT}`,
    );
  const cueTotal = summary.reduce((acc, item) => acc + item.cues, 0);
  if (cueTotal < 3) fail("manifest 字幕", `${aspect} cue 总数 ${cueTotal} < 3`);
  for (const item of summary) {
    if (!/^[0-9a-f]{64}$/.test(item.textSha256 ?? ""))
      fail("manifest 字幕", `镜头 ${item.shotIndex + 1} textSha256 异常`);
  }
}

// 字幕烧录核验之二：底带暗像素。药丸底 rgba(27,25,23,.55) 叠白底 ≈ 灰度 130，
// <200 计暗；cue 进行中底带（80%~90% 高度）必有暗像素，首字之前应为纯背景。
// cue 时刻从首镜头 words.json 推导（取最长 cue 中点，必在轨上）——首镜头旁白
// 仅 4 字，写死 1.5s 会落在 cue 结束后的空窗。
function bottomBandDarkRatio(mp4, tSeconds) {
  const out = path.join(OUT_DIR, `band-${tSeconds}.gray`);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(tSeconds),
      "-i",
      mp4,
      "-frames:v",
      "1",
      "-vf",
      "crop=iw:ih*0.10:0:ih*0.80,format=gray",
      "-f",
      "rawvideo",
      out,
    ],
    { stdio: "ignore" },
  );
  if (r.status !== 0) fail("字幕像素核验", `ffmpeg 失败 @${tSeconds}s`);
  const buf = readFileSync(out);
  rmSync(out, { force: true });
  let dark = 0;
  for (const byte of buf) if (byte < 200) dark += 1;
  return dark / buf.length;
}
const firstWorking = afterTts.shots[0].contentVersions.find(
  (v) => v.versionId === afterTts.shots[0].workingVersionId,
);
const firstCues = readSubtitleCues(
  NARRATION_DIR,
  `${afterTts.shots[0].shotId}-${afterTts.shots[0].workingVersionId}`,
  firstWorking.narrationText ?? "",
  firstWorking.durationMs,
).cues;
if (firstCues.length === 0)
  fail("字幕像素核验", "首镜头无 cue，无法取采样时刻");
const longestCue = firstCues.reduce((a, b) =>
  b.endMs - b.startMs > a.endMs - a.startMs ? b : a,
);
const cueTime = (longestCue.startMs + longestCue.endMs) / 2 / 1000;
const preCueTime = 0.1; // TTS 首字有自然起音静音段（实测 ~0.36s），0.1s 必在轨前
const landscapeMp4 = path.join(RENDER_DIR, "landscape.mp4");
const cueRatio = bottomBandDarkRatio(landscapeMp4, cueTime);
const preRatio = bottomBandDarkRatio(landscapeMp4, preCueTime);
if (cueRatio <= 0.01)
  fail(
    "字幕像素核验",
    `cue ${cueTime.toFixed(2)}s 底带暗像素比 ${(cueRatio * 100).toFixed(2)}% ≤ 1%`,
  );
if (preRatio >= 0.005)
  fail(
    "字幕像素核验",
    `pre-cue ${preCueTime}s 底带暗像素比 ${(preRatio * 100).toFixed(2)}% ≥ 0.5%`,
  );
// 证据存档：cue 时刻底部 38% 带区裁片（含药丸全貌）
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    String(cueTime),
    "-i",
    landscapeMp4,
    "-frames:v",
    "1",
    "-vf",
    "crop=iw:ih*0.38:0:ih*0.62",
    path.join(OUT_DIR, "subtitle-band-cue.png"),
  ],
  { stdio: "ignore" },
);
console.log(
  `[e2e-narrated] 字幕像素: cue ${cueTime.toFixed(2)}s（最长 cue「${longestCue.text}」中点）暗带比 ${(cueRatio * 100).toFixed(2)}%，pre-cue ${preCueTime}s ${(preRatio * 100).toFixed(2)}%`,
);
console.log(
  `[e2e-narrated] CLI 完成: v${rendered.savedVersion}，双画幅 aac 音轨 + manifest.narration ×${SHOT_COUNT}`,
);

// —— 回程：导入同一 JSON → 旁白文本回显 + 渲染记录可见 ——
await page.click(".project-action"); // 返回列表
await expectVisible(page, ".project-import", "返回列表");
await page.setInputFiles('input[type="file"]', EXPORTED);
await page
  .locator(".editor-message", { hasText: "已导入" })
  .waitFor({ timeout: 15_000 })
  .catch(() => fail("导入", "未出现 已导入 提示"));
const echoNarrations = await page
  .locator(".shot-card .shot-narration")
  .allTextContents();
if (echoNarrations.length !== SHOT_COUNT)
  fail("导入回显", `旁白回显 ${echoNarrations.length} ≠ ${SHOT_COUNT}`);
if (!/谢谢观看/.test(echoNarrations.at(-1) ?? ""))
  fail("导入回显", `末镜头旁白未回显: ${echoNarrations.at(-1)}`);
const recordRows = await page.locator(".render-records li").count();
if (recordRows !== 8) fail("导入后渲染记录", `记录条数 ${recordRows} ≠ 8`);
// 预览近似标注（spec R3 近似路径的诚实性）：预览字幕是均匀分布，必须告诉
// 用户出片才按字级时间戳——不标等于让用户拿预览对出片节奏。
const previewNote = await page
  .locator(".piece-preview .preview-subtitle-note")
  .textContent()
  .catch(() => null);
if (
  !previewNote ||
  !/预览近似/.test(previewNote) ||
  !/字级时间戳/.test(previewNote)
)
  fail(
    "预览近似标注",
    `整片预览缺「预览近似，出片按字级时间戳」: ${previewNote}`,
  );
await page.screenshot({
  path: path.join(OUT_DIR, "narrated-editor.png"),
  fullPage: true,
});

if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));

await browser.close();
console.log(
  `[e2e-narrated] OK: 项目 ${projectId} 有声闭环，v${exported.savedVersion} → v${rendered.savedVersion}，${SHOT_COUNT} 镜头旁白（横竖）出片，导入回显成立`,
);

// —— 证据：SHA-256 + 计费台账逐笔 ——
console.log("[e2e-narrated] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  ...wavs.map((wav) => `narration/${wav}`),
  "e2e-render/landscape.mp4",
  "e2e-render/portrait.mp4",
  "e2e-render/render-manifest.json",
  "subtitle-band-cue.png",
  "narrated-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
const usagePath = path.join(ROOT, "artifacts/tts-usage.jsonl");
const usageLines = readFileSync(usagePath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const runUsage = usageLines.slice(-SHOT_COUNT);
console.log("[e2e-narrated] 本次计费台账:");
for (const entry of runUsage) {
  console.log(
    `  ${entry.at} ${entry.model}/${entry.voice} characters=${entry.characters} ¥${entry.costCny.toFixed(4)} (${entry.requestId.slice(0, 8)})`,
  );
}
const totalCny = usageLines.reduce((acc, entry) => acc + entry.costCny, 0);
console.log(`[e2e-narrated] 累计计费 ¥${totalCny.toFixed(4)}（预算 ¥50）`);
