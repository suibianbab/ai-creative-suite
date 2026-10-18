#!/usr/bin/env node
// P1-A 端到端闭环验收（真实工作台链路，非 DevTools 手工取数）：
//   浏览器新建→规划确认→保存→导出 JSON
//   → CLI render-scene 双画幅出片并回写 RenderRecord
//   → 浏览器导入同一 JSON → 重开看到渲染记录，项目 ID/版本 ID 贯穿不变。
// 前置: @acs/web dev server 已在 BASE_URL（默认 http://localhost:3210）；
//       packages/{video-document,video-scene} 已 build。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-e2e");
const EXPORTED = path.join(OUT_DIR, "exported.video-project.json");
const SENTENCE = "做一个4秒的文字动画，标题是闭环验收，副标题是E2E";

function fail(step, detail) {
  console.error(`[e2e-closed-loop] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(page, selector, step) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${selector}`));
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

// —— 去程：新建 → 规划 → 确认 → 保存 → 导出 ——
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
await expectVisible(page, ".plan-card", "规划确认卡");
const renderHint = await page.locator(".plan-render-hint").textContent();
if (!/标题「闭环验收」/.test(renderHint ?? ""))
  fail("确认卡内容预告", `renderHint 未点名标题: ${renderHint}`);
await page.click(".plan-apply");
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
const versionId = exported.shots?.[0]?.workingVersionId;
if (!projectId || !versionId) fail("导出", "导出件缺 id/workingVersionId");
console.log(
  `[e2e-closed-loop] 去程完成: 项目 ${projectId} v${exported.savedVersion}`,
);

// —— CLI：双画幅出片 + RenderRecord 回写（写回同一 JSON） ——
const render = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    EXPORTED,
    "--out",
    path.join(OUT_DIR, "render"),
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
);
if (render.status !== 0)
  fail("CLI 渲染", `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
const rendered = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (rendered.id !== projectId) fail("CLI 渲染", "项目 ID 被改写");
if (rendered.savedVersion !== exported.savedVersion + 1)
  fail("CLI 渲染", `savedVersion 应 +1，实际 ${rendered.savedVersion}`);
if (rendered.renderRecords.length !== exported.renderRecords.length + 2)
  fail("CLI 渲染", "RenderRecord 未按双画幅追加 2 条");
const cliVersions = rendered.shots[0].contentVersions.map((v) => v.versionId);
if (!cliVersions.includes(versionId)) fail("CLI 渲染", "内容版本 ID 未贯穿");
console.log(
  `[e2e-closed-loop] CLI 完成: v${rendered.savedVersion}，RenderRecord ×${rendered.renderRecords.length}`,
);

// —— 回程：导入同一 JSON → 编辑器看到渲染记录 → 列表显示新版本 ——
await page.click(".project-action"); // 返回列表
await expectVisible(page, ".project-import", "返回列表");
await page.setInputFiles('input[type="file"]', EXPORTED);
await page
  .locator(".editor-message", { hasText: "已导入" })
  .waitFor({ timeout: 15_000 })
  .catch(() => fail("导入", "未出现 已导入 提示"));
await expectVisible(page, ".render-records", "导入后渲染记录区块");
const recordsText = await page.locator(".render-records").textContent();
for (const expect of ["1280×720", "720×1280"])
  if (!recordsText?.includes(expect))
    fail("导入后渲染记录", `缺少 ${expect} 记录: ${recordsText}`);
await page.screenshot({
  path: path.join(OUT_DIR, "imported-editor.png"),
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
  `[e2e-closed-loop] OK: 项目 ${projectId} 贯穿全程，工作台 v${exported.savedVersion} → 导入 v${rendered.savedVersion}，渲染记录可见`,
);
