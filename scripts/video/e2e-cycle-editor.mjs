import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.BASE_URL ?? "http://127.0.0.1:3212"}/video-studio`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.waitForSelector("html[data-studio-ready]");
  await page.locator(".sample-card").first().locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor();

  const cycle = page.locator(".shot-card").nth(1);
  await cycle.locator(".shot-edit-toggle").click();
  assert.match(
    await cycle
      .locator(".shot-template-note")
      .allInnerTexts()
      .then((v) => v.join(" ")),
    /循环/,
  );
  assert.equal(await cycle.locator(".composition-image-input").count(), 0);
  await cycle.locator(".composition-cycle-0-label").fill("蒸腾");
  await cycle.locator(".composition-cycle-0-caption").fill("海面水汽");
  await cycle.locator(".composition-cycle-center").fill("循环不息");
  await cycle.locator(".shot-apply").click();
  await cycle.locator(".shot-edit-toggle").click();

  const drawing = page.locator(".shot-card").nth(2);
  await drawing.locator(".shot-edit-toggle").click();
  await drawing.locator(".composition-diagram-label-0-text").fill("日光");
  await drawing.locator(".shot-apply").click();
  await drawing.locator(".shot-edit-toggle").click();
  await page.locator(".editor-save").click();
  await page.locator(".editor-message", { hasText: "已保存" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const file = path.resolve(".tools/e2e-cycle-editor.video-project.json");
  mkdirSync(path.dirname(file), { recursive: true });
  await download.saveAs(file);
  const project = JSON.parse(readFileSync(file, "utf8"));
  const working = (index) => {
    const shot = project.shots[index];
    return shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
  };
  assert.equal(
    working(1).sceneSource.spec.params.diagram.steps[0].label,
    "蒸腾",
  );
  assert.equal(
    working(1).sceneSource.spec.params.diagram.steps[0].caption,
    "海面水汽",
  );
  assert.equal(
    working(1).sceneSource.spec.params.diagram.centerText,
    "循环不息",
  );
  assert.equal(
    working(2).sceneSource.spec.params.diagramLabels[0].text,
    "日光",
  );
  await page.reload();
  await page.waitForSelector("html[data-studio-ready]");
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor();
  const reopened = page.locator(".shot-card").nth(1);
  await reopened.locator(".shot-edit-toggle").click();
  assert.equal(
    await reopened.locator(".composition-cycle-0-label").inputValue(),
    "蒸腾",
  );
  await reopened.locator(".shot-edit-toggle").click();
  const originalVersion = project.shots[1].contentVersions[0];
  await reopened
    .locator(".shot-version-select")
    .selectOption(originalVersion.versionId);
  await reopened.locator(".shot-rollback").click();
  await page.locator(".editor-save").click();
  await page.locator(".editor-message", { hasText: "已保存" }).waitFor();
  const [rollbackDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const rollbackFile = path.resolve(
    ".tools/e2e-cycle-editor-rollback.video-project.json",
  );
  await rollbackDownload.saveAs(rollbackFile);
  const rolledBack = JSON.parse(readFileSync(rollbackFile, "utf8"));
  const rollbackShot = rolledBack.shots[1];
  const rollbackVersion = rollbackShot.contentVersions.find(
    (version) => version.versionId === rollbackShot.workingVersionId,
  );
  assert.equal(
    rollbackVersion.sceneSource.spec.params.diagram.steps[0].label,
    originalVersion.sceneSource.spec.params.diagram.steps[0].label,
  );
  assert.deepEqual(errors, []);
  console.log("cycle/drawing labels edit-save-reopen-rollback PASS");
} finally {
  await browser.close();
}
