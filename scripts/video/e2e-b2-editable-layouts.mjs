#!/usr/bin/env node
// Batch-2 Task 1 验收：compare-split 与 timeline-milestones 在工作台的完整
// 编辑链——从配方创建→修改非标题字段→保存刷新重开→回滚→双画幅出片。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.B2_EVIDENCE_DIR ??
    path.join(root, ".tools/video-b2-editable-layouts-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let exportedPath = "";
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
  await page.locator(".project-create").click();

  // 创建 compare-split 镜头。
  await page.locator(".recipe-catalog").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const compareCard = page
    .locator(".recipe-card")
    .filter({ hasText: "前后对比" });
  await compareCard.scrollIntoViewIfNeeded();
  await compareCard.locator(".recipe-toggle").click();
  await page.waitForTimeout(500);
  await compareCard.locator(".recipe-title-input").fill("上线前后对比");
  await compareCard.locator(".recipe-subtitle-input").fill("8.2 秒");
  await compareCard.locator(".recipe-labels-input").fill("1.4 秒");
  await compareCard.locator(".recipe-apply").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });

  // 创建 timeline-milestones 镜头。
  await page.locator(".recipe-catalog").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const timelineCard = page
    .locator(".recipe-card")
    .filter({ hasText: "里程碑时间轴" });
  await timelineCard.scrollIntoViewIfNeeded();
  await timelineCard.locator(".recipe-toggle").click();
  await page.waitForTimeout(500);
  await timelineCard.locator(".recipe-title-input").fill("产品里程碑");
  await timelineCard
    .locator(".recipe-labels-input")
    .fill("立项, 开发, 测试, 上线");
  await timelineCard.locator(".recipe-apply").click();
  await page.locator(".shot-card").nth(1).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".shot-card").count(), 2);

  // === 编辑 compare-split 的非标题字段 ===
  const compareShot = page.locator(".shot-card").nth(0);
  await compareShot.locator(".shot-edit-toggle").click();
  await page
    .locator(".compare-before-value-input")
    .waitFor({ timeout: 10_000 });
  await page.locator(".compare-before-value-input").fill("99.9 秒");
  await page.locator(".compare-delta-positive-select").selectOption("false");
  await page.locator(".compare-delta-text-input").fill("99.9 → 1.4 秒");
  await compareShot.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await compareShot.locator(".shot-edit-toggle").click();

  // === 编辑 timeline-milestones 的非标题字段 ===
  const timelineShot = page.locator(".shot-card").nth(1);
  await timelineShot.locator(".shot-edit-toggle").click();
  await page.locator(".timeline-date-0").waitFor({ timeout: 10_000 });
  await page.locator(".timeline-date-0").fill("2026Q1");
  await page.locator(".timeline-label-2").fill("集成测试");
  await page.locator(".timeline-status-3").selectOption("active");
  await timelineShot.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await timelineShot.locator(".shot-edit-toggle").click();

  // 保存刷新重开→数据持久。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".shot-card").count(), 2, "重开两镜持久");

  // 导出项目 JSON 验证编辑值。
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  exportedPath = path.join(out, "editable-layouts.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  const working = (shot) =>
    shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  const compareParams = working(exported.shots[0]).sceneSource.spec.params;
  assert.equal(compareParams.beforeValue, "99.9 秒", "编辑的前值持久");
  assert.equal(compareParams.deltaPositive, false, "差值方向持久");
  assert.equal(compareParams.deltaText, "99.9 → 1.4 秒", "差值文字持久");
  const timelineParams = working(exported.shots[1]).sceneSource.spec.params;
  assert.equal(timelineParams.milestones[0].date, "2026Q1", "节点日期持久");
  assert.equal(timelineParams.milestones[2].label, "集成测试", "节点标签持久");
  assert.equal(timelineParams.milestones[3].status, "active", "节点状态持久");

  // 回滚 compare-split 镜头到配方版本。
  const rollbackCard = page.locator(".shot-card").nth(0);
  await rollbackCard.locator(".shot-edit-toggle").click();
  const beforeVersionId = exported.shots[0].contentVersions[0].versionId;
  await rollbackCard
    .locator(".shot-version-select")
    .selectOption(beforeVersionId);
  await rollbackCard.locator(".shot-rollback").click();
  await page.waitForTimeout(1000);
  const [afterRollback] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const rollbackPath = path.join(out, "rollback-check.video-project.json");
  await afterRollback.saveAs(rollbackPath);
  const rolled = JSON.parse(readFileSync(rollbackPath, "utf8"));
  const rolledParams = working(rolled.shots[0]).sceneSource.spec.params;
  assert.equal(
    rolledParams.beforeValue,
    exported.shots[0].contentVersions[0].sceneSource.spec.params.beforeValue,
    "回滚恢复配方原值",
  );
  await rollbackCard.locator(".shot-edit-toggle").click();

  // 双画幅真实出片。
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 2);
  await page.screenshot({ path: path.join(out, "mp4-exported.png") });
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);

// 抽帧验证可读性。
const renderDir = path.join(out, "render");
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    exportedPath,
    "--out",
    renderDir,
  ],
  { cwd: root, stdio: "inherit" },
);
for (const aspect of ["landscape", "portrait"]) {
  for (const [shot, at] of [
    [1, 2.0],
    [2, 5.0],
  ]) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      path.join(renderDir, `${aspect}.mp4`),
      "-frames:v",
      "1",
      path.join(out, `${aspect}-shot${shot}.png`),
    ]);
  }
}
console.log(`Batch-2 Task 1 e2e: PASS → ${out}`);
