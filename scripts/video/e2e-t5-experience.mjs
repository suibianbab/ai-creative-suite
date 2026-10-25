// T5 完整体验链：创建→编辑镜头→加转场→横竖预览→保存重开→导出 MP4→
// 导出交互页→核对交付记录。项目含 T4 新布局和一个 3D 镜头。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.T5_EVIDENCE_DIR ??
    path.join(root, ".tools/video-t5-experience-e2e"),
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

  // 1. 创建：新建项目。
  await page.locator(".project-create").click();

  // 2. 编辑镜头：加四个配方镜头（含 T4 双布局 + 3D）。
  const cards = page.locator(".recipe-card");
  await cards.first().waitFor({ timeout: 20_000 });
  // 开场文字
  const textCard = page.locator(".recipe-card").filter({ hasText: "开场提问" });
  await textCard.locator(".recipe-toggle").click();
  await textCard.locator(".recipe-title-input").fill("新产品上线");
  await textCard.locator(".recipe-apply").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  // 前后对比：先滚到配方目录再操作。
  await page.locator(".recipe-catalog").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const compareCard = page
    .locator(".recipe-card")
    .filter({ hasText: "前后对比" });
  await compareCard.scrollIntoViewIfNeeded();
  await compareCard.locator(".recipe-toggle").click();
  await page.waitForTimeout(500);
  await compareCard.locator(".recipe-title-input").scrollIntoViewIfNeeded();
  await compareCard.locator(".recipe-title-input").fill("等单时长对比");
  await compareCard.locator(".recipe-subtitle-input").fill("12 分钟");
  await compareCard.locator(".recipe-labels-input").fill("3 分钟");
  await compareCard.locator(".recipe-apply").click();
  await page.locator(".shot-card").nth(1).waitFor({ timeout: 20_000 });
  // 里程碑
  await page.locator(".recipe-catalog").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const timelineCard = page
    .locator(".recipe-card")
    .filter({ hasText: "里程碑时间轴" });
  await timelineCard.scrollIntoViewIfNeeded();
  await timelineCard.locator(".recipe-toggle").click();
  await page.waitForTimeout(500);
  await timelineCard.locator(".recipe-title-input").scrollIntoViewIfNeeded();
  await timelineCard.locator(".recipe-title-input").fill("上线里程碑");
  await timelineCard.locator(".recipe-labels-input").fill("立项, 开发, 测试, 上线");
  await timelineCard.locator(".recipe-apply").click();
  await page.locator(".shot-card").nth(2).waitFor({ timeout: 20_000 });
  // 第四镜：文字配方，再转为 3D 模板镜头。
  await page.locator(".recipe-catalog").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const textCard2 = page.locator(".recipe-card").filter({ hasText: "开场提问" });
  await textCard2.scrollIntoViewIfNeeded();
  await textCard2.locator(".recipe-toggle").click();
  await page.waitForTimeout(500);
  await textCard2.locator(".recipe-title-input").fill("产品一览");
  await textCard2.locator(".recipe-apply").click();
  await page.locator(".shot-card").nth(3).waitFor({ timeout: 20_000 });
  // 把第四镜换成 3D 模板（组件模板替换当前镜头 spec，不加新镜）。
  const fourthCard = page.locator(".shot-card").nth(3);
  await fourthCard.locator(".shot-edit-toggle").click();
  await page.locator(".chart-template-select").selectOption("three-3d");
  await fourthCard.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".shot-card").count(), 4, "四镜项目");
  await fourthCard.locator(".shot-edit-toggle").click();

  // 3. 加转场：边界 1 加 fade。
  await page.locator('.transition-row[data-boundary="1"] .transition-kind').selectOption("fade");
  await page
    .locator(".transition-borrow-summary")
    .first()
    .waitFor({ timeout: 5_000 });

  // 4. 横竖预览切换。
  const preview = page.locator(".piece-preview");
  for (const [aspect, viewBox] of [
    ["横版", "0 0 1280 720"],
    ["竖版", "0 0 720 1280"],
  ]) {
    await preview.getByRole("button", { name: aspect }).click();
    assert.equal(
      await preview.locator(".preview-canvas").getAttribute("viewBox"),
      viewBox,
    );
  }

  // 5. 保存刷新重开。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".shot-card").count(), 4, "重开四镜持久");

  // 6. 导出 MP4（工作台真实出片按钮）。
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 2);
  await page.screenshot({ path: path.join(out, "experience-mp4-exported.png") });

  // 7. 导出项目 JSON（供 CLI 导出交互页）。
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  exportedPath = path.join(out, "experience.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  assert.equal(exported.shots.length, 4);
  assert.equal(exported.transitions?.length, 1, "一条转场");
  assert.ok(exported.renderRecords.length >= 8, "双画幅渲染记录已回写");

  // 8. 导出交互页（CLI）。
  execFileSync(
    process.execPath,
    [
      "scripts/video/t3-export-interactive.mjs",
      "--project",
      exportedPath,
      "--out",
      path.join(out, "interactive"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  const manifest = JSON.parse(
    readFileSync(path.join(out, "interactive/asset-manifest.json"), "utf8"),
  );
  assert.equal(manifest.source.componentId, "orbit3d");
  assert.ok(manifest.bytes <= manifest.maxBytes, "交互页 ≤8MiB");
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
console.log(`T5 experience chain: PASS → ${out}`);
