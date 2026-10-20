#!/usr/bin/env node
// P2.5-T6 样例 e2e（VID-023，Wikimedia 素材源全链路，零 TTS 计费）：
//   浏览器新建→STEM 分镜（3 镜头 9s，主题云）→保存基线
//   →镜头 1 选媒体模板（media-clip，只露面板不应用）
//     →卡内在线素材面板搜 clouds →选固定片 File:Clouds-seloncourt.ogv 480p
//     →下载并应用（0-2000ms/cover/focal 0.5/mute，自动落成新工作版本）→保存
//   →导出 JSON（结构断言：origin 许可/作者/来源、original 尺寸/时长/storeKey/无 proxy、
//     镜头 1 media-clip 默认值、镜头 2/3 仍为 spec）
//   →返回列表→按标题重开→素材下拉回填同一 assetId→整片预览可解码（readyState≥2, 854 宽）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致→镜头 1 第 24 帧 YAVG≥100
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
//       dev server 需 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY 才能访问 Wikimedia；
//       e2e 与 dev server 共用同一仓外 ACS_MEDIA_STORE（render-scene 按它找素材）；
//       packages/{video-document,video-scene,media-store} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-vid-023");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个9秒的STEM解说视频，主题是云，分3个镜头";
const PAGE_TITLE = "File:Clouds-seloncourt.ogv";
const DERIVATIVE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fb/Clouds-seloncourt.ogv/Clouds-seloncourt.ogv.480p.vp9.webm";
const SOURCE_PAGE =
  "https://commons.wikimedia.org/wiki/File:Clouds-seloncourt.ogv";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-stock] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function usageLines() {
  try {
    return readFileSync(USAGE_LEDGER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径。
function frameYavg(videoPath, frameNumber) {
  const out = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      videoPath,
      "-vf",
      `select='eq(n,${frameNumber})',signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  const match = `${out.stderr}`.match(/YAVG=([0-9.]+)/);
  if (!match)
    fail("YAVG 提取", `${videoPath} 第 ${frameNumber} 帧无 YAVG 输出`);
  return Number(match[1]);
}

function renderProject(projectPath, outDir, step) {
  mkdirSync(outDir, { recursive: true });
  const render = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/render-scene.mjs"),
      "--project",
      projectPath,
      "--out",
      outDir,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  if (render.status !== 0)
    fail(step, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
}

async function waitForMessage(page, text, step, timeout = 10_000) {
  await page
    .locator(".editor-message", { hasText: text })
    .waitFor({ timeout })
    .catch(() => fail(step, `未出现提示: ${text}`));
}

// 暂停整片预览并把滑杆设到指定帧（React 受控 range 需走原型 setter + input 事件）。
async function setPreviewFrame(page, frame) {
  await page.evaluate((value) => {
    const slider = document.querySelector(".preview-slider");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });
const usageBefore = usageLines();

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

// —— 去程：新建 → 分镜规划 → 确认应用 → 保存基线 ——
await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await page
  .locator(".storyboard-card")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("分镜确认卡", "未出现"));
await page.click(".plan-apply");
await waitForMessage(page, "首个 3 个镜头", "规划应用");
await page
  .locator(".shot-list > li")
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("镜头时间线", ".shot-list > li 未出现"));
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存基线");

// —— 镜头 1：换媒体模板（只播种 mediaDraft 并切到媒体臂，露出在线素材面板；
//     不点 .shot-apply——下载并应用自己会落成新的工作版本）→搜固定片→下载并应用 ——
const card1 = page.locator(".shot-list > li").nth(0);
await card1.locator(".shot-edit-toggle").click();
await card1.locator(".chart-template-select").selectOption("media-clip");
await card1.locator(".stock-search-input").fill("clouds");
await card1.locator(".stock-search-button").first().click();
const candidate = card1.locator(".stock-candidate", {
  hasText: "Clouds-seloncourt",
});
await candidate
  .waitFor({ timeout: 60_000 })
  .catch(() =>
    fail("素材检索", `未找到 ${PAGE_TITLE}（Wikimedia 不可达或候选漂移）`),
  );
await candidate
  .locator(".stock-derivative-select")
  .selectOption(DERIVATIVE_URL);
await candidate.locator(".stock-download").click();
// 首次下载约 7s（6.6MB），给足预算（含上游重试）。
await waitForMessage(page, "素材已下载并应用（镜头 1）", "下载并应用", 120_000);
await candidate
  .locator(".stock-badge-imported")
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("下载并应用", "候选卡未出现「已入库」徽标"));
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存媒体镜头");

// —— 导出 + 文档结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
if (!existsSync(EXPORTED)) fail("导出", "下载文件未落盘");
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));

const asset = exported.mediaAssets?.[0];
if (!asset) fail("账本", "mediaAssets 为空");
if (
  asset.origin.kind !== "stock-source" ||
  asset.origin.sourceId !== "wikimedia"
)
  fail("origin", JSON.stringify(asset.origin));
if (asset.origin.sourcePageUrl !== SOURCE_PAGE)
  fail("sourcePageUrl", asset.origin.sourcePageUrl);
if (asset.origin.license.name !== "CC BY 2.0")
  fail("license", asset.origin.license.name);
// 契约（types.ts）：作者属于 license.author，不在 origin 顶层。
if (asset.origin.license.author !== "Thomas Bresson")
  fail("author", asset.origin.license.author);
if (Number.isNaN(Date.parse(asset.origin.retrievedAt)))
  fail("retrievedAt", asset.origin.retrievedAt);
if (asset.original.width !== 854 || asset.original.height !== 480)
  fail("尺寸", `${asset.original.width}x${asset.original.height}`);
if (asset.original.durationMs !== 28600)
  fail("时长", String(asset.original.durationMs));
if (asset.original.hasAudio !== false)
  fail("hasAudio", String(asset.original.hasAudio));
if (asset.original.storeKey !== `${asset.original.sha256.slice(0, 16)}.webm`)
  fail("storeKey", asset.original.storeKey);
if (asset.original.proxy !== undefined) fail("proxy", "不应生成 proxy");

const s1 = exported.shots[0].contentVersions.find(
  (version) => version.versionId === exported.shots[0].workingVersionId,
);
if (s1.sceneSource.type !== "media-clip")
  fail("镜头1类型", s1.sceneSource.type);
const clip = s1.sceneSource; // media-clip 字段平铺在 sceneSource 上
if (clip.mediaAssetId !== asset.assetId)
  fail("mediaAssetId", clip.mediaAssetId);
if (clip.inMs !== 0 || clip.outMs !== 2000)
  fail("入出点", `${clip.inMs}-${clip.outMs}`);
if (clip.fit !== "cover" || clip.focalX !== 0.5 || clip.audio !== "mute")
  fail("默认值", JSON.stringify(clip));
if (s1.durationMs !== 2000) fail("镜头1时长", String(s1.durationMs));
const s2 = exported.shots[1].contentVersions.find(
  (version) => version.versionId === exported.shots[1].workingVersionId,
);
if (s2.sceneSource.type !== "spec") fail("镜头2", "应为 spec");
const s3 = exported.shots[2].contentVersions.find(
  (version) => version.versionId === exported.shots[2].workingVersionId,
);
if (s3.sceneSource.type !== "spec") fail("镜头3", "应为 spec");
console.log(
  `[e2e-stock] 落库: 项目 ${exported.id} v${exported.savedVersion}，asset ${asset.assetId}，storeKey=${asset.original.storeKey}`,
);

// —— 保存/重开/预览：返回列表 → 按标题打开同一项目 → 下拉回填 → 预览解码 ——
await page.click(".project-action");
await page
  .locator(".project-import")
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("返回列表", "项目列表未出现"));
const row = page.locator(".project-table tr", { hasText: exported.title });
await row
  .locator(".project-open")
  .click()
  .catch(() =>
    fail("重开项目", `列表行未找到标题 ${JSON.stringify(exported.title)}`),
  );
const reopened = page.locator(".shot-list > li").nth(0);
await reopened
  .locator(".shot-edit-toggle")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("重开项目", "镜头卡未出现"));
await reopened.locator(".shot-edit-toggle").click();
const select = reopened.locator(".media-asset-select");
await select
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("重开素材", ".media-asset-select 未出现"));
if ((await select.inputValue()) !== asset.assetId)
  fail("重开素材", await select.inputValue());
// 整片预览默认自动播放；先按 React 受控 range 的原型 setter 把帧拨到 12
// （500ms，仍在镜头 1 的 0..47 帧域内，同时暂停）——既避免镜头 1（仅 2000ms）
// 被播过去后 .media-stage 卸载，也强制 MediaStage 做一次 seek 取帧。
await setPreviewFrame(page, 12);
const video = page.locator(".media-stage").first();
await video
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("预览", ".media-stage 未出现"));
await page
  .waitForFunction(
    () => (document.querySelector(".media-stage")?.readyState ?? 0) >= 2,
    { timeout: 10_000 },
  )
  .catch(() => fail("预览", "readyState 未达 2（取不到当前帧数据）"));
const state = await video.evaluate((el) => ({
  readyState: el.readyState,
  w: el.videoWidth,
  duration: el.duration,
  err: el.error?.message ?? null,
  src: el.currentSrc || el.src,
}));
if (
  state.readyState < 2 ||
  state.w !== 854 ||
  !(state.duration > 28) ||
  state.err !== null
)
  fail("预览", JSON.stringify(state));
if (!state.src.includes(asset.original.storeKey)) fail("预览 src", state.src);
console.log(
  `[e2e-stock] 重开预览: assetId 回填一致，readyState=${state.readyState}，${state.w}px，${state.duration.toFixed(1)}s`,
);

// —— 出片：双画幅 + 双跑一致 + 镜头 1 帧亮度 ——
// 产物固定为 <out>/landscape.mp4 与 <out>/portrait.mp4（render-scene 双画幅）。
const RENDER_DIR = path.join(OUT_DIR, "render");
const RERUN_DIR = path.join(OUT_DIR, "rerun");
const renderHashes = {};
renderProject(EXPORTED, RENDER_DIR, "出片 run1");
renderProject(EXPORTED, RERUN_DIR, "出片 run2");
for (const aspect of ["landscape", "portrait"]) {
  const hash = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  if (hash !== sha256(path.join(RERUN_DIR, `${aspect}.mp4`)))
    fail("确定性", `${aspect} 双跑哈希不同`);
  // 镜头 1 帧域 0..47（2000ms @24fps）：帧 24 = 1000ms，素材应可见。
  const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), 24);
  if (yavg < 100) fail("素材帧", `${aspect} 第 24 帧 YAVG=${yavg} < 100`);
  renderHashes[aspect] = hash;
  console.log(`[e2e-stock] ${aspect}: 双跑一致 ${hash}，帧 24 YAVG=${yavg}`);
}

// —— 零计费与控制台 ——
const usageAfter = usageLines();
if (usageAfter !== usageBefore) fail("计费", `${usageBefore} → ${usageAfter}`);
if (consoleErrors.length > 0) fail("控制台", consoleErrors.join(" | "));
console.log(
  `[e2e-stock] OK: 项目 ${exported.id} v${exported.savedVersion}，storeKey=${asset.original.storeKey}，台账 ${usageAfter} 行不变`,
);
for (const [aspect, hash] of Object.entries(renderHashes))
  console.log(`[e2e-stock] ${aspect} sha256 ${hash}`);
await browser.close();
