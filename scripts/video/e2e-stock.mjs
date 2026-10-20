#!/usr/bin/env node
// P2.5-T6 样例 e2e（VID-023，Wikimedia 素材源全链路，零 TTS 计费）：
//   浏览器新建→STEM 分镜（3 镜头 9s，主题云）→保存基线
//   →镜头 1 选媒体模板（media-clip，只露面板不应用）
//     →卡内在线素材面板搜 clouds →选固定片 File:Clouds-seloncourt.ogv 480p
//     →下载并应用（0-2000ms/cover/focal 0.5/mute，自动落成新工作版本）→保存
//   →导出 JSON（结构断言：origin 许可/作者/来源、original 尺寸/时长/storeKey/无 proxy、
//     镜头 1 media-clip 默认值、镜头 2/3 仍为 spec）
//   →返回列表→按标题重开→素材下拉回填同一 assetId→整片预览可解码（readyState≥2, 854 宽）
//     →拨到帧 12（500ms）并断言滑杆/暂停/currentTime 均就位
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致→镜头 1 第 24 帧非黑
//     （YAVG≥100；仅证明非黑帧，不构成素材身份校验）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（默认 http://127.0.0.1:3211，
//       经 scripts/dev/proxy-3211.mjs 代理到 3210；也可直起在 3211）；
//       dev server 必须带 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY=http://127.0.0.1:7890
//       才能访问 Wikimedia；e2e 与 dev server 共用同一仓外 ACS_MEDIA_STORE
//       （render-scene 按它找素材）；packages/{video-document,video-scene,media-store}
//       已 build；ffmpeg 在 PATH。
//       台账检查只观测本工作区 artifacts/tts-usage.jsonl（文件缺失按 0 行）。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印 `[e2e-stock] FAIL at <step>`。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { stockAssetViolations } from "./stock-asset-assertions.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-vid-023");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const BASELINE = path.join(OUT_DIR, "baseline.video-project.json");
const SENTENCE = "做一个9秒的STEM解说视频，主题是云，分3个镜头";
const PAGE_TITLE = "File:Clouds-seloncourt.ogv";
const DERIVATIVE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fb/Clouds-seloncourt.ogv/Clouds-seloncourt.ogv.480p.vp9.webm";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

// fail() 在退出前尽力关闭浏览器；模块级变量避免 TDZ（启动前失败时 browser 为 null）。
let browser = null;
let page = null;
const consoleErrors = [];

function describeError(err) {
  if (err === undefined || err === null) return "";
  if (typeof err === "string") return err;
  return err.message ?? String(err);
}

async function fail(step, err) {
  console.error(`[e2e-stock] FAIL at ${step}: ${describeError(err)}`);
  try {
    await browser?.close();
  } catch {
    // 关闭失败不掩盖原始失败原因。
  }
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
  } catch (err) {
    // 契约（spec §7）：文件缺失按 0 行计；其余读错误必须暴露，避免零计费断言失真。
    if (err?.code === "ENOENT") return 0;
    throw err;
  }
}

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径。
async function frameYavg(videoPath, frameNumber) {
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
    await fail("YAVG 提取", `${videoPath} 第 ${frameNumber} 帧无 YAVG 输出`);
  return Number(match[1]);
}

async function renderProject(projectPath, outDir, step) {
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
    await fail(step, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
}

async function waitForMessage(page, text, step, timeout = 10_000) {
  await page
    .locator(".editor-message", { hasText: text })
    .waitFor({ timeout })
    .catch((err) => fail(step, `未出现提示: ${text}（${describeError(err)}）`));
}

// 暂停整片预览并把滑杆设到指定帧（React 受控 range 需走原型 setter + input 事件）。
async function setPreviewFrame(page, frame) {
  try {
    await page.evaluate((value) => {
      const slider = document.querySelector(".preview-slider");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(slider, String(value));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
  } catch (err) {
    await fail("预览帧位", err);
  }
}

// 导出当前文档到指定路径（.editor-export 触发浏览器下载）。
async function exportProject(page, target) {
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.click(".editor-export"),
    ]);
    await download.saveAs(target);
    if (!existsSync(target)) await fail("导出", "下载文件未落盘");
    return JSON.parse(readFileSync(target, "utf8"));
  } catch (err) {
    await fail("导出", err);
  }
}

// 工作版本查找：缺失时按镜头号失败（不做裸 find 后的 undefined 解引用）。
async function workingVersionOf(shot, label) {
  const working = shot?.contentVersions?.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working) await fail(label, "工作版本不存在");
  return working;
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });
rmSync(BASELINE, { force: true });
let usageBefore;
try {
  usageBefore = usageLines();
} catch (err) {
  await fail("计费台账（读取前）", err);
}

// —— 启动浏览器 ——
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location()?.url ?? "";
    // 仅忽略非本源的资源加载失败（如 Wikimedia 缩略图）；同源资源错误与
    // JS 异常、其他控制台 error 仍照常失败。
    if (
      /^Failed to load resource/i.test(text) &&
      url &&
      !url.startsWith(BASE_URL)
    )
      return;
    consoleErrors.push(text.slice(0, 200));
  });
} catch (err) {
  await fail("启动浏览器", err);
}

// —— 去程：新建 → 分镜规划 → 确认应用 → 保存基线 ——
let baseline;
let baselineComponents;
try {
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch((err) =>
      fail(
        "打开工作台",
        `客户端未就绪（data-studio-ready 未出现）：${describeError(err)}`,
      ),
    );
  await page.click(".project-create");
  await page.fill("#planner-sentence", SENTENCE);
  await page.click(".planner-run");
  await page
    .locator(".storyboard-card")
    .waitFor({ timeout: 20_000 })
    .catch((err) => fail("分镜确认卡", `未出现：${describeError(err)}`));
  await page.click(".plan-apply");
  await waitForMessage(page, "首个 3 个镜头", "规划应用");
  await page
    .locator(".shot-list > li")
    .first()
    .waitFor({ timeout: 20_000 })
    .catch((err) =>
      fail("镜头时间线", `.shot-list > li 未出现：${describeError(err)}`),
    );
  await page.click(".editor-save");
  await waitForMessage(page, "已保存", "保存基线");
  // 基线导出：固定镜头 2/3 的组件 id，供换媒体后的一致性断言。
  baseline = await exportProject(page, BASELINE);
  baselineComponents = [];
  for (const index of [1, 2]) {
    const label = `基线镜头${index + 1}`;
    const working = await workingVersionOf(baseline.shots[index], label);
    if (working.sceneSource?.type !== "spec") await fail(label, "应为 spec");
    baselineComponents.push(working.sceneSource.spec.componentId);
  }
} catch (err) {
  await fail("去程（新建/规划/保存基线）", err);
}

// —— 镜头 1：换媒体模板（只播种 mediaDraft 并切到媒体臂，露出在线素材面板；
//     不点 .shot-apply——下载并应用自己会落成新的工作版本）→搜固定片→下载并应用 ——
try {
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
    .catch((err) =>
      fail(
        "素材检索",
        `未找到 ${PAGE_TITLE}（Wikimedia 不可达或候选漂移；前置：dev server 需 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY=http://127.0.0.1:7890）：${describeError(err)}`,
      ),
    );
  const derivativeSelect = candidate.locator(".stock-derivative-select");
  // 480p 是候选的默认档位：先断言默认值，避免只验证「能选到」。
  const defaultDerivative = await derivativeSelect.inputValue();
  if (defaultDerivative !== DERIVATIVE_URL)
    await fail("默认档位", `${defaultDerivative} ≠ ${DERIVATIVE_URL}`);
  await derivativeSelect.selectOption(DERIVATIVE_URL);
  // 导入状态观察必须在点击之前挂上，避免响应先于监听。
  const importResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/media/stock/import"),
      { timeout: 120_000 },
    )
    .catch((err) =>
      fail(
        "导入状态",
        `未观察到 /api/media/stock/import 响应：${describeError(err)}`,
      ),
    );
  await candidate.locator(".stock-download").click();
  // 固定 480p 档位实测 869,851 字节（≈0.83MB）；给足预算（含上游重试）。
  await waitForMessage(
    page,
    "素材已下载并应用（镜头 1）",
    "下载并应用",
    120_000,
  );
  const importResponse = await importResponsePromise;
  if (importResponse.status() !== 200)
    await fail("导入状态", String(importResponse.status()));
  await candidate
    .locator(".stock-badge-imported")
    .waitFor({ timeout: 10_000 })
    .catch((err) =>
      fail("下载并应用", `候选卡未出现「已入库」徽标：${describeError(err)}`),
    );
  await page.click(".editor-save");
  await waitForMessage(page, "已保存", "保存媒体镜头");
} catch (err) {
  await fail("素材导入（检索/下载/应用/保存）", err);
}

// —— 导出 + 文档结构断言 ——
let exported;
let asset;
try {
  exported = await exportProject(page, EXPORTED);
  if (exported.shots.length !== 3)
    await fail("镜头数", `exported.shots.length=${exported.shots.length} ≠ 3`);

  asset = exported.mediaAssets?.[0];
  if (!asset) await fail("账本", "mediaAssets 为空");
  const violations = stockAssetViolations(asset);
  if (violations.length) await fail(violations[0].step, violations[0].detail);

  const s1 = await workingVersionOf(exported.shots[0], "镜头1");
  if (!s1.sceneSource) await fail("镜头1", "sceneSource 缺失");
  if (s1.sceneSource.type !== "media-clip")
    await fail("镜头1类型", s1.sceneSource.type);
  const clip = s1.sceneSource; // media-clip 字段平铺在 sceneSource 上
  if (clip.mediaAssetId !== asset.assetId)
    await fail("mediaAssetId", clip.mediaAssetId);
  if (clip.inMs !== 0 || clip.outMs !== 2000)
    await fail("入出点", `${clip.inMs}-${clip.outMs}`);
  if (clip.fit !== "cover" || clip.focalX !== 0.5 || clip.audio !== "mute")
    await fail("默认值", JSON.stringify(clip));
  if (s1.durationMs !== 2000) await fail("镜头1时长", String(s1.durationMs));
  const s2 = await workingVersionOf(exported.shots[1], "镜头2");
  if (!s2.sceneSource) await fail("镜头2", "sceneSource 缺失");
  if (s2.sceneSource.type !== "spec") await fail("镜头2", "应为 spec");
  if (s2.sceneSource.spec.componentId !== baselineComponents[0])
    await fail(
      "镜头2",
      `组件 ${s2.sceneSource.spec.componentId} ≠ 基线 ${baselineComponents[0]}`,
    );
  const s3 = await workingVersionOf(exported.shots[2], "镜头3");
  if (!s3.sceneSource) await fail("镜头3", "sceneSource 缺失");
  if (s3.sceneSource.type !== "spec") await fail("镜头3", "应为 spec");
  if (s3.sceneSource.spec.componentId !== baselineComponents[1])
    await fail(
      "镜头3",
      `组件 ${s3.sceneSource.spec.componentId} ≠ 基线 ${baselineComponents[1]}`,
    );
  console.log(
    `[e2e-stock] 落库: 项目 ${exported.id} v${exported.savedVersion}，asset ${asset.assetId}，storeKey=${asset.original.storeKey}`,
  );
} catch (err) {
  await fail("导出与文档结构断言", err);
}

// —— 保存/重开/预览：返回列表 → 按标题打开同一项目 → 下拉回填 → 预览解码 ——
try {
  await page.click(".project-action");
  await page
    .locator(".project-import")
    .waitFor({ timeout: 10_000 })
    .catch((err) => fail("返回列表", `项目列表未出现：${describeError(err)}`));
  const row = page.locator(".project-table tr", { hasText: exported.title });
  await row
    .locator(".project-open")
    .click()
    .catch((err) =>
      fail(
        "重开项目",
        `列表行未找到标题 ${JSON.stringify(exported.title)}：${describeError(err)}`,
      ),
    );
  const reopened = page.locator(".shot-list > li").nth(0);
  await reopened
    .locator(".shot-edit-toggle")
    .waitFor({ timeout: 20_000 })
    .catch((err) => fail("重开项目", `镜头卡未出现：${describeError(err)}`));
  await reopened.locator(".shot-edit-toggle").click();
  const select = reopened.locator(".media-asset-select");
  await select
    .waitFor({ timeout: 10_000 })
    .catch((err) =>
      fail("重开素材", `.media-asset-select 未出现：${describeError(err)}`),
    );
  const reopenedAssetId = await select.inputValue();
  if (reopenedAssetId !== asset.assetId)
    await fail("重开素材", reopenedAssetId);
  // 媒体草稿字段也必须逐项回填（入出点/fit/focal/原声）。
  const mediaDraftExpectations = [
    [".media-in-input", "0"],
    [".media-out-input", "2000"],
    [".media-fit-select", "cover"],
    [".media-focal-input", "50"],
    [".media-audio-select", "mute"],
  ];
  for (const [selector, expected] of mediaDraftExpectations) {
    const field = reopened.locator(selector);
    await field
      .waitFor({ timeout: 10_000 })
      .catch((err) =>
        fail("重开草稿", `${selector} 未出现：${describeError(err)}`),
      );
    const actual = await field.inputValue();
    if (actual !== expected)
      await fail(
        "重开草稿",
        `${selector}=${JSON.stringify(actual)} ≠ ${expected}`,
      );
  }
  // 整片预览默认自动播放；先按 React 受控 range 的原型 setter 把帧拨到 12
  // （500ms，仍在镜头 1 的 0..47 帧域内，同时暂停）——既避免镜头 1（仅 2000ms）
  // 被播过去后 .media-stage 卸载，也强制 MediaStage 做一次 seek 取帧。
  await setPreviewFrame(page, 12);
  const video = page.locator(".media-stage").first();
  await video
    .waitFor({ timeout: 10_000 })
    .catch((err) => fail("预览", `.media-stage 未出现：${describeError(err)}`));
  await page
    .waitForFunction(
      () => (document.querySelector(".media-stage")?.readyState ?? 0) >= 2,
      { timeout: 10_000 },
    )
    .catch((err) =>
      fail(
        "预览",
        `readyState 未达 2（取不到当前帧数据）：${describeError(err)}`,
      ),
    );
  // 帧 12 → localFrame 12 → 预览 seek 目标 (0 + 12/24*1000)/1000 = 0.5s。
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector(".media-stage");
        return Boolean(el) && Math.abs(el.currentTime - 0.5) <= 0.25;
      },
      { timeout: 10_000 },
    )
    .catch((err) =>
      fail(
        "预览",
        `currentTime 未收敛到 0.5s±0.25s（帧 12 未就位）：${describeError(err)}`,
      ),
    );
  const sliderValue = await page
    .locator(".preview-slider")
    .inputValue()
    .catch((err) =>
      fail("预览帧位", `.preview-slider 不可读：${describeError(err)}`),
    );
  if (sliderValue !== "12")
    await fail(
      "预览帧位",
      `.preview-slider=${JSON.stringify(sliderValue)} ≠ "12"`,
    );
  const state = await video.evaluate((el) => ({
    readyState: el.readyState,
    w: el.videoWidth,
    duration: el.duration,
    err: el.error?.message ?? null,
    src: el.currentSrc || el.src,
    paused: el.paused,
    currentTime: el.currentTime,
  }));
  if (
    state.readyState < 2 ||
    state.w !== 854 ||
    !(state.duration > 28) ||
    state.err !== null
  )
    await fail("预览", JSON.stringify(state));
  if (state.paused !== true)
    await fail("预览暂停", `video.paused=${state.paused}（帧 12 应已暂停）`);
  if (Math.abs(state.currentTime - 0.5) > 0.25)
    await fail(
      "预览帧位",
      `video.currentTime=${state.currentTime}（期望 0.5±0.25）`,
    );
  if (!state.src.includes(asset.original.storeKey))
    await fail("预览 src", state.src);
  console.log(
    `[e2e-stock] 重开预览: assetId 回填一致，滑杆=${sliderValue}，paused=${state.paused}，currentTime=${state.currentTime.toFixed(3)}s，readyState=${state.readyState}，${state.w}px，${state.duration.toFixed(1)}s`,
  );
} catch (err) {
  await fail("保存/重开/预览", err);
}

// —— 出片：双画幅 + 双跑一致 + 镜头 1 帧亮度 ——
// 产物固定为 <out>/landscape.mp4 与 <out>/portrait.mp4（render-scene 双画幅）。
const RENDER_DIR = path.join(OUT_DIR, "render");
const RERUN_DIR = path.join(OUT_DIR, "rerun");
const renderHashes = {};
try {
  // 复跑清理：旧产物若残留，缺文件会被误当成本次出片。
  rmSync(RENDER_DIR, { recursive: true, force: true });
  rmSync(RERUN_DIR, { recursive: true, force: true });
  await renderProject(EXPORTED, RENDER_DIR, "出片 run1");
  await renderProject(EXPORTED, RERUN_DIR, "出片 run2");
  for (const aspect of ["landscape", "portrait"]) {
    const renderFile = path.join(RENDER_DIR, `${aspect}.mp4`);
    const rerunFile = path.join(RERUN_DIR, `${aspect}.mp4`);
    if (!existsSync(renderFile)) await fail("出片产物", renderFile);
    if (!existsSync(rerunFile)) await fail("出片产物", rerunFile);
    const hash = sha256(renderFile);
    if (hash !== sha256(rerunFile))
      await fail("确定性", `${aspect} 双跑哈希不同`);
    // 镜头 1 帧域 0..47（2000ms @24fps）：帧 24 = 1000ms，断言非黑帧。
    const yavg = await frameYavg(renderFile, 24);
    if (yavg < 100)
      await fail("非黑帧", `${aspect} 第 24 帧 YAVG=${yavg} < 100`);
    renderHashes[aspect] = hash;
    console.log(
      `[e2e-stock] ${aspect}: 双跑一致 ${hash}，帧 24 非黑 YAVG=${yavg}`,
    );
  }
} catch (err) {
  await fail("出片", err);
}

// —— 零计费与控制台 ——
let usageAfter;
try {
  usageAfter = usageLines();
} catch (err) {
  await fail("计费台账（读取后）", err);
}
if (usageAfter !== usageBefore)
  await fail("计费", `${usageBefore} → ${usageAfter}`);
if (consoleErrors.length > 0) await fail("控制台", consoleErrors.join(" | "));
console.log(
  `[e2e-stock] OK: 项目 ${exported.id} v${exported.savedVersion}，storeKey=${asset.original.storeKey}，台账 ${usageAfter} 行不变`,
);
for (const [aspect, hash] of Object.entries(renderHashes))
  console.log(`[e2e-stock] ${aspect} sha256 ${hash}`);
try {
  await browser.close();
} catch (err) {
  await fail("关闭浏览器", err);
}
