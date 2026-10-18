#!/usr/bin/env node
// P1 多镜头端到端闭环验收（真实工作台链路）：
//   浏览器新建→STEM 分镜规划→分镜确认卡→追加应用（4 镜头）→时间线/整片预览
//   →保存→导出 JSON→CLI 整片双画幅出片（含干跑）并回写 RenderRecord×8
//   →浏览器导入同一 JSON→镜头时间线+渲染记录可见，项目 ID/版本 ID 贯穿不变。
// 前置: @acs/web dev server 已在 BASE_URL（默认 http://localhost:3210）；
//       packages/{video-document,video-scene} 已 build。
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
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-multishot");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const SHOT_COUNT = 4;

function fail(step, detail) {
  console.error(`[e2e-multishot] FAIL at ${step}: ${detail ?? ""}`);
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

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });

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

// —— 去程：新建 → 分镜规划 → 确认卡 → 追加应用 → 时间线/整片预览 → 保存 → 导出 ——
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
const shotLabels = await page.locator(".plan-shot-label").allTextContents();
if (shotLabels.length !== SHOT_COUNT)
  fail("分镜确认卡", `预告镜头数 ${shotLabels.length} ≠ ${SHOT_COUNT}`);
if (!/开场/.test(shotLabels[0] ?? "") || !/结语/.test(shotLabels.at(-1) ?? ""))
  fail("分镜确认卡", `开场/结语镜头缺失: ${shotLabels.join(" / ")}`);
const storyboardHint = await page
  .locator(".plan-shot-hint")
  .first()
  .textContent();
if (!/标题「水循环」/.test(storyboardHint ?? ""))
  fail("分镜确认卡", `首镜头预告未点名标题: ${storyboardHint}`);
await page.click(".plan-apply");
await page
  .locator(".editor-message", { hasText: "首个 4 个镜头" })
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("追加应用", "未出现 首个镜头 提示"));

// 时间线与整片预览就位
await expectVisible(page, ".editor-shots", "镜头时间线");
const spanCount = await page.locator(".timeline-span").count();
if (spanCount !== SHOT_COUNT)
  fail("镜头时间线", `时间条 span 数 ${spanCount} ≠ ${SHOT_COUNT}`);
const cardCount = await page.locator(".shot-card").count();
if (cardCount !== SHOT_COUNT)
  fail("镜头时间线", `镜头卡数 ${cardCount} ≠ ${SHOT_COUNT}`);
await expectVisible(page, ".piece-preview", "整片预览");

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
const versionIds = exported.shots.map((shot) => shot.workingVersionId);
if (!projectId || versionIds.length !== SHOT_COUNT)
  fail("导出", `导出件缺 id 或镜头数 ≠ ${SHOT_COUNT}`);
const totalMs = exported.shots.reduce(
  (acc, shot) => acc + shot.contentVersions[0].durationMs,
  0,
);
if (totalMs !== 8000) fail("导出", `镜头时长之和 ${totalMs} ≠ 8000`);
console.log(
  `[e2e-multishot] 去程完成: 项目 ${projectId} v${exported.savedVersion}，${SHOT_COUNT} 镜头 Σ8s`,
);

// —— CLI：整片双画幅出片（含逐帧干跑）+ RenderRecord×8 回写同一 JSON ——
const render = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    EXPORTED,
    "--out",
    path.join(OUT_DIR, "e2e-render"),
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
);
if (render.status !== 0)
  fail("CLI 整片渲染", `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
const rendered = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (rendered.id !== projectId) fail("CLI 整片渲染", "项目 ID 被改写");
if (rendered.savedVersion !== exported.savedVersion + 1)
  fail("CLI 整片渲染", `savedVersion 应 +1，实际 ${rendered.savedVersion}`);
if (rendered.renderRecords.length !== exported.renderRecords.length + 8)
  fail(
    "CLI 整片渲染",
    `RenderRecord 应 +8，实际 +${rendered.renderRecords.length - exported.renderRecords.length}`,
  );
for (const versionId of versionIds) {
  const kept = rendered.shots
    .flatMap((shot) => shot.contentVersions.map((v) => v.versionId))
    .includes(versionId);
  if (!kept) fail("CLI 整片渲染", `内容版本 ${versionId} 未贯穿`);
}
console.log(
  `[e2e-multishot] CLI 完成: v${rendered.savedVersion}，RenderRecord ×${rendered.renderRecords.length}（4 镜头 × 2 画幅）`,
);

// —— 回程：导入同一 JSON → 时间线+渲染记录可见 → 列表显示新版本 ——
await page.click(".project-action"); // 返回列表
await expectVisible(page, ".project-import", "返回列表");
await page.setInputFiles('input[type="file"]', EXPORTED);
await page
  .locator(".editor-message", { hasText: "已导入" })
  .waitFor({ timeout: 15_000 })
  .catch(() => fail("导入", "未出现 已导入 提示"));
await expectVisible(page, ".render-records", "导入后渲染记录区块");
const recordRows = await page.locator(".render-records li").count();
if (recordRows !== 8) fail("导入后渲染记录", `记录条数 ${recordRows} ≠ 8`);
const recordsText = await page.locator(".render-records").textContent();
for (const expect of ["1280×720", "720×1280"])
  if (!recordsText?.includes(expect))
    fail("导入后渲染记录", `缺少 ${expect} 记录: ${recordsText}`);
const importedCards = await page.locator(".shot-card").count();
if (importedCards !== SHOT_COUNT)
  fail("导入后时间线", `镜头卡数 ${importedCards} ≠ ${SHOT_COUNT}`);
await page.screenshot({
  path: path.join(OUT_DIR, "multishot-editor.png"),
  fullPage: true,
});
await page.click(".project-action"); // 返回列表核对版本号
await page
  .locator(".project-table td", { hasText: `v${rendered.savedVersion}` })
  .first()
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("列表核对", `列表未显示 v${rendered.savedVersion}`));

if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));

await browser.close();
console.log(
  `[e2e-multishot] OK: 项目 ${projectId} 贯穿全程，v${exported.savedVersion} → v${rendered.savedVersion}，${SHOT_COUNT} 镜头整片（横竖）出片，RenderRecord×8 可见`,
);
console.log("[e2e-multishot] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "e2e-render/landscape.mp4",
  "e2e-render/portrait.mp4",
  "multishot-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
