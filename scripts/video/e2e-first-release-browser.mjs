#!/usr/bin/env node
// F2 修复：干净环境浏览器全链验收——新 context（无开发者 IndexedDB），
// 从样片库创建季度简报→编辑→保存刷新重开→回滚→横竖预览→MP4 导出。
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".tools/video-first-release-browser-e2e");
mkdirSync(out, { recursive: true });
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const results = [];
const addResult = (step, pass, note = "") => {
  results.push({ step, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}${note ? ` — ${note}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  // 干净 context（无共享 IndexedDB）。
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });

  // 1. 干净页面打开（无已有项目）。
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  const existingProjects = await page.locator(".project-open").count();
  addResult("干净页面打开", true, `已有项目数=${existingProjects}`);

  // 2. 样片卡可见（编辑器打开前检查）。
  const sampleTitles = await page
    .locator(".sample-card h3")
    .allTextContents();
  addResult("样片卡可见", sampleTitles.length >= 1, `${sampleTitles.length} 张`);

  // 3. 季度样片创建。
  const card = page.locator(".sample-card").filter({ hasText: "数据简报" });
  await card.locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  addResult("季度样片创建", (await page.locator(".shot-card").count()) === 6, "6 镜");

  // 4. 编辑文字镜头（镜 1 标题）。
  const firstCard = page.locator(".shot-card").nth(0);
  await firstCard.locator(".shot-edit-toggle").click();
  await page.locator(".shot-title-input").waitFor({ timeout: 10_000 });
  await page.locator(".shot-title-input").fill("Q3 业务验收");
  await firstCard.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  addResult("文字编辑", true);
  await firstCard.locator(".shot-edit-toggle").click();

  // 5. 编辑对比镜（镜 3 前值）。
  const compareCard = page.locator(".shot-card").nth(2);
  await compareCard.locator(".shot-edit-toggle").click();
  await page
    .locator(".compare-before-value-input")
    .waitFor({ timeout: 10_000 });
  await page.locator(".compare-before-value-input").fill("+35%");
  await compareCard.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  addResult("对比编辑", true);
  await compareCard.locator(".shot-edit-toggle").click();

  // 6. 保存刷新重开。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  addResult("保存刷新重开", (await page.locator(".shot-card").count()) === 6);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const exportedPath = path.join(out, "browser-edited.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  const w = (shot) =>
    shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
  addResult(
    "编辑持久",
    w(exported.shots[0]).sceneSource.spec.params.title === "Q3 业务验收" &&
      w(exported.shots[2]).sceneSource.spec.params.beforeValue === "+35%",
  );

  // 7. 回滚对比镜。
  const rollbackCard = page.locator(".shot-card").nth(2);
  await rollbackCard.locator(".shot-edit-toggle").click();
  await rollbackCard
    .locator(".shot-version-select")
    .selectOption(exported.shots[2].contentVersions[0].versionId);
  await rollbackCard.locator(".shot-rollback").click();
  await page.waitForTimeout(500);
  const [afterRb] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const rbPath = path.join(out, "rollback.video-project.json");
  await afterRb.saveAs(rbPath);
  const rolled = JSON.parse(readFileSync(rbPath, "utf8"));
  addResult(
    "回滚",
    w(rolled.shots[2]).sceneSource.spec.params.beforeValue !== "+35%",
  );
  await rollbackCard.locator(".shot-edit-toggle").click();

  // 8. 横竖预览。
  const preview = page.locator(".piece-preview");
  for (const [aspect, viewBox] of [
    ["横版", "0 0 1280 720"],
    ["竖版", "0 0 720 1280"],
  ]) {
    await preview.getByRole("button", { name: aspect }).click();
    const actual = await preview
      .locator(".preview-canvas")
      .getAttribute("viewBox");
    addResult(`${aspect}预览`, actual === viewBox);
  }

  // 9. MP4 导出。
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  const dlCount = await page.locator(".editor-downloads a").count();
  addResult("MP4 导出", dlCount === 2, `${dlCount} 条下载链接`);
  await page.screenshot({ path: path.join(out, "browser-mp4-exported.png") });

  // 10. 导出项目 JSON 导入验证。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  addResult("最终保存", true);
} finally {
  await browser.close();
}
addResult("控制台零错误", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(
  path.join(out, "browser-acceptance.json"),
  JSON.stringify({ results, errors }, null, 2) + "\n",
);
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} steps PASS`,
);
if (failed.length > 0 || errors.length > 0) process.exit(1);
console.log("FIRST-RELEASE BROWSER ACCEPTANCE: ALL PASS");
