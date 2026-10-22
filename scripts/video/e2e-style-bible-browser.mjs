#!/usr/bin/env node
// D 浏览器闭环：四镜头创建 → 独立风格 → 保存/重开 → 新版/切回 → 单镜编辑。
// 前置：web dev server 在 BASE_URL。项目和 sidecar 下载至 .tools，不计费。
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, ".tools/video-style-bible-browser");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("console", (event) => {
  if (event.type() === "error") errors.push(event.text());
});
async function saveAndExport(name) {
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const file = path.join(OUT, `${name}.video-project.json`);
  await download.saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
}
try {
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-create").click();
  await page
    .locator("#planner-sentence")
    .fill("做一个8秒的STEM解说视频，主题是水循环，分4个镜头");
  await page.locator(".planner-run").click();
  await page.locator(".storyboard-card").waitFor();
  await page.locator(".plan-apply").click();
  assert.equal(await page.locator(".shot-card").count(), 4);

  const panel = page.locator(".style-bible-panel");
  await panel.getByRole("button", { name: "创建并应用风格规范" }).click();
  await page
    .locator(".editor-message", { hasText: "Style Bible 已创建并应用" })
    .waitFor();
  const first = await saveAndExport("first");
  assert(first.styleBibleRef);
  assert.equal(first.shots.length, 4);
  assert.equal(first.shots[0].contentVersions.length, 2);
  const [styleDownload] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "导出风格规范 JSON" }).click(),
  ]);
  const styleFile = path.join(OUT, "style-bible.json");
  await styleDownload.saveAs(styleFile);
  const style = JSON.parse(readFileSync(styleFile, "utf8"));
  assert.equal(style.id, first.styleBibleRef.bibleId);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  // 刷新后回列表，从已保存项目重开。
  await page.locator(".project-open").first().click();
  assert.match(await panel.textContent(), /Style Bible/);
  await panel.locator('input[type="color"]').first().fill("#26344a");
  await panel
    .getByRole("button", { name: "将当前颜色保存为新版本并应用" })
    .click();
  await page.locator(".editor-message", { hasText: "风格版本 v2" }).waitFor();
  const second = await saveAndExport("second");
  assert.notEqual(
    second.styleBibleRef.versionId,
    first.styleBibleRef.versionId,
  );
  assert.equal(second.shots[0].contentVersions.length, 3);
  const [updatedDownload] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "导出风格规范 JSON" }).click(),
  ]);
  const updatedStyleFile = path.join(OUT, "style-bible-v2.json");
  await updatedDownload.saveAs(updatedStyleFile);
  assert.equal(
    JSON.parse(readFileSync(updatedStyleFile, "utf8")).versions.length,
    2,
  );

  await panel
    .getByLabel("选用已有版本")
    .selectOption(first.styleBibleRef.versionId);
  await panel.getByRole("button", { name: "切换并应用选中版本" }).click();
  await page
    .locator(".editor-message", { hasText: "已切换并应用风格版本 v1" })
    .waitFor();
  const switched = await saveAndExport("switched");
  assert.equal(switched.styleBibleRef.versionId, first.styleBibleRef.versionId);
  const otherWorking = switched.shots
    .slice(1)
    .map((shot) => shot.workingVersionId);

  const card = page.locator(".shot-card").first();
  await card.locator(".shot-edit-toggle").click();
  await card.locator(".shot-title-input").fill("风格内单镜修改");
  await card.locator(".shot-apply").click();
  await page.locator(".editor-message", { hasText: "镜头 1 已修订" }).waitFor();
  const edited = await saveAndExport("edited");
  assert.deepEqual(
    edited.shots.slice(1).map((shot) => shot.workingVersionId),
    otherWorking,
  );
  assert.equal(edited.styleBibleRef.versionId, first.styleBibleRef.versionId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  assert.match(await panel.textContent(), /Style Bible/);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    `[e2e-style-bible-browser] PASS project=${first.id} versions=2 saved=${edited.savedVersion} consoleErrors=0`,
  );
} finally {
  await browser.close();
}
