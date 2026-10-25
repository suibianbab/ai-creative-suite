#!/usr/bin/env node
// Codex 复核 P2-5：家装样片的完整浏览器验收——从样片库一键创建 →
// 修改对比数值和时间轴节点 → 保存重开 → 双画幅真实出片。
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.B2G_EVIDENCE_DIR ??
    path.join(root, ".tools/video-b2-gallery-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
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
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });

  // 从样片库一键创建家装项目。
  const card = page
    .locator(".sample-card")
    .filter({ hasText: "家装方案" });
  await card.locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  assert.equal(await page.locator(".shot-card").count(), 7, "家装七镜");

  // 修改对比镜（第 2 镜）的非标题字段。
  const compareShot = page.locator(".shot-card").nth(1);
  await compareShot.locator(".shot-edit-toggle").click();
  await page.locator(".compare-before-value-input").waitFor({ timeout: 10_000 });
  await page.locator(".compare-before-value-input").fill("旧两房");
  await page.locator(".compare-after-value-input").fill("新三房");
  await compareShot.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await compareShot.locator(".shot-edit-toggle").click();

  // 修改时间轴镜（第 4 镜）的节点标签与状态。
  const timelineShot = page.locator(".shot-card").nth(3);
  await timelineShot.locator(".shot-edit-toggle").click();
  await page.locator(".timeline-label-3").waitFor({ timeout: 10_000 });
  await page.locator(".timeline-label-3").fill("验收交付");
  await page.locator(".timeline-status-2").selectOption("pending");
  await timelineShot.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await timelineShot.locator(".shot-edit-toggle").click();

  // 保存刷新重开。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".shot-card").count(), 7, "重开七镜");

  // 导出验证编辑值持久。
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const exportedPath = path.join(out, "gallery-edited.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  const working = (shot) =>
    shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  const compareParams = working(exported.shots[1]).sceneSource.spec.params;
  assert.equal(compareParams.beforeValue, "旧两房", "对比前值持久");
  const timelineParams = working(exported.shots[3]).sceneSource.spec.params;
  assert.equal(timelineParams.milestones[3].label, "验收交付", "节点标签持久");
  assert.equal(timelineParams.milestones[2].status, "pending", "节点状态持久");

  // 双画幅真实出片。
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 2);
  await page.screenshot({ path: path.join(out, "gallery-mp4-exported.png") });
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
console.log(`Batch-2 gallery sample e2e: PASS → ${out}`);
