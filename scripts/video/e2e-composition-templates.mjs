#!/usr/bin/env node
// A non-STEM interior-renovation project edited through the real browser UI.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.COMPOSITION_EVIDENCE_DIR ??
    path.join(root, ".tools/video-composition-templates-e2e"),
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
  const exportProject = async (name) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".editor-export").click(),
    ]);
    const file = path.join(out, `${name}.video-project.json`);
    await download.saveAs(file);
    return JSON.parse(readFileSync(file, "utf8"));
  };
  const working = (shot) =>
    shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").nth(1).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  const before = await exportProject("before");
  const cards = page.locator(".shot-card");
  // G1: browsing a composition template and returning to the current
  // component must not persist the template's dark background.
  const browseCard = cards.nth(0);
  const originalSpec = working(before.shots[0]).sceneSource.spec;
  await browseCard.locator(".shot-edit-toggle").click();
  await browseCard
    .locator(".chart-template-select")
    .selectOption("composition-process-4");
  await browseCard.locator(".chart-template-select").selectOption("");
  await browseCard
    .locator(".shot-duration-input")
    .fill(String(originalSpec.durationMs / 1000 + 0.5));
  const beforeVersionCount = await browseCard
    .locator(".shot-version-select option")
    .count();
  await browseCard.locator(".shot-apply").click();
  await browseCard
    .locator(".shot-version-select option")
    .nth(beforeVersionCount)
    .waitFor({ state: "attached" });
  const afterBrowse = await exportProject("after-template-browse");
  assert.equal(
    working(afterBrowse.shots[0]).sceneSource.spec.background,
    originalSpec.background,
  );
  assert.equal(
    working(afterBrowse.shots[0]).sceneSource.spec.componentId,
    originalSpec.componentId,
  );
  await browseCard.locator(".shot-edit-toggle").click();
  const texts = [
    [0, "让客厅焕然一新", "从想法到舒适空间", "为家打造更舒适的客厅。"],
    [
      3,
      "理想客厅，即刻实现",
      "每一步都有清晰方案",
      "理想客厅，从清晰方案开始。",
    ],
  ];
  for (const [index, title, subtitle, narration] of texts) {
    const card = cards.nth(index);
    await card.locator(".shot-edit-toggle").click();
    await card.locator(".shot-title-input").fill(title);
    await card.locator(".shot-subtitle-input").fill(subtitle);
    await card.locator(".shot-narration-input").fill(narration);
    await card.locator(".shot-apply").click();
    await card.locator(".shot-edit-toggle").click();
  }
  const process = cards.nth(1);
  await process.locator(".shot-edit-toggle").click();
  await process
    .locator(".chart-template-select")
    .selectOption("composition-process-4");
  await process.locator(".composition-title-input").fill("客厅改造四步");
  await process
    .locator(".composition-flow-steps")
    .fill("量房\n选材\n施工\n验收");
  await process
    .locator(".composition-annotation-0-text")
    .fill("从空间需求出发");
  await process
    .locator(".composition-annotation-1-text")
    .fill("每阶段确认成果");
  await process
    .locator(".shot-narration-input")
    .fill("量房，选材，施工，验收，四步完成客厅改造。");
  const processVersionCount = await process
    .locator(".shot-version-select option")
    .count();
  await process.locator(".shot-apply").click();
  await process
    .locator(".shot-version-select option")
    .nth(processVersionCount)
    .waitFor({ state: "attached" });
  assert.equal(await process.locator(".shot-edit-error").count(), 0);
  const appliedProcess = await exportProject("applied-process-template");
  assert.equal(
    working(appliedProcess.shots[1]).sceneSource.spec.background,
    "#122137", // linked sample Style Bible remaps the template's #102033
  );
  await process.locator(".shot-edit-toggle").click();
  const drawing = cards.nth(2);
  await drawing.locator(".shot-edit-toggle").click();
  await drawing
    .locator(".chart-template-select")
    .selectOption("composition-drawing");
  await drawing.locator(".composition-title-input").fill("客厅动线示意");
  await drawing.locator(".composition-annotation-0-text").fill("留出舒适通道");
  await drawing
    .locator(".shot-narration-input")
    .fill("家具与通道合理布局，空间更从容。");
  await drawing.locator(".shot-apply").click();
  assert.equal(await drawing.locator(".shot-edit-error").count(), 0);
  await drawing.locator(".shot-edit-toggle").click();

  // The existing Style Bible is re-applied through its public UI; the
  // template remains a normal content version, not a parallel project model.
  await page.getByRole("button", { name: "切换并应用选中版本" }).click();
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });
  const saved = await exportProject("edited");
  assert.equal(saved.shots.length, 4);
  assert.equal(
    working(saved.shots[1]).sceneSource.spec.componentId,
    "explainer-composition",
  );
  assert.equal(
    working(saved.shots[2]).sceneSource.spec.params.diagram.kind,
    "drawing",
  );
  assert.equal(
    working(saved.shots[1]).sceneSource.spec.params.diagram.steps[0].label,
    "量房",
  );
  const [bibleDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出风格规范 JSON" }).click(),
  ]);
  await bibleDownload.saveAs(path.join(out, "interior.style-bible.json"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  const reopened = await exportProject("reopened");
  assert.equal(reopened.id, saved.id);
  assert.equal(
    working(reopened.shots[1]).sceneSource.spec.params.title,
    "客厅改造四步",
  );
  for (const [aspect, viewBox] of [
    ["横版", "0 0 1280 720"],
    ["竖版", "0 0 720 1280"],
  ]) {
    const preview = page.locator(".piece-preview");
    await preview.getByRole("button", { name: aspect }).click();
    assert.equal(
      await preview.locator(".preview-canvas").getAttribute("viewBox"),
      viewBox,
    );
    await preview.locator(".preview-slider").evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(element, "105");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await preview
      .locator(".preview-canvas text", { hasText: "客厅改造四步" })
      .waitFor({ timeout: 5000 });
    await preview
      .locator(".piece-stage")
      .screenshot({ path: path.join(out, `${aspect}.png`) });
  }
  // Exercise the image template with a real local raster as a separate
  // browser variant; the interior drawing project above remains the render
  // source for the complete non-STEM sample.
  const imageShot = page.locator(".shot-card").nth(2);
  await imageShot.locator(".shot-edit-toggle").click();
  await imageShot
    .locator(".chart-template-select")
    .selectOption("composition-image");
  await imageShot.locator(".composition-title-input").fill("商品材质参考");
  await imageShot
    .locator(".composition-image-input")
    .setInputFiles(path.join(root, "apps/web/public/samples/p4-product.png"));
  await imageShot
    .locator(".composition-annotation-0-text")
    .fill("保留真实商品外观");
  await imageShot.locator(".shot-apply").click();
  assert.equal(await imageShot.locator(".shot-edit-error").count(), 0);
  await imageShot.locator(".shot-edit-toggle").click();
  await page.getByRole("button", { name: "切换并应用选中版本" }).click();
  const imageVariant = await exportProject("image-variant");
  assert.equal(
    working(imageVariant.shots[2]).sceneSource.spec.params.diagram.kind,
    "image",
  );
  for (const aspect of ["横版", "竖版"]) {
    const preview = page.locator(".piece-preview");
    await preview.getByRole("button", { name: aspect }).click();
    await preview.locator(".preview-slider").evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(element, "155");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await preview
      .locator('.preview-canvas image[href^="data:image/png;base64,"]')
      .waitFor({ timeout: 5000 });
  }
  const second = page.locator(".shot-card").nth(1);
  await second
    .locator(".shot-version-select")
    .selectOption(before.shots[1].workingVersionId);
  await second.locator(".shot-rollback").click();
  const rolled = await exportProject("rollback-check");
  assert.equal(
    rolled.shots[1].workingVersionId,
    before.shots[1].workingVersionId,
  );
  assert.equal(
    rolled.shots[1].contentVersions.length,
    reopened.shots[1].contentVersions.length,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(out, "browser-report.json"),
    JSON.stringify(
      {
        pass: true,
        projectId: saved.id,
        shots: 4,
        aspects: ["landscape", "portrait"],
        rollbackChecked: true,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("COMPOSITION TEMPLATES BROWSER PASS");
} finally {
  await browser.close();
}
