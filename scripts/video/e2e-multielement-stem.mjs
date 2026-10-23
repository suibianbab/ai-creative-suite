#!/usr/bin/env node
// Browser acceptance: edit two composed STEM shots, save/reopen and verify both aspects.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// The repeatable QA run must not overwrite the retained narrated render's
// project IDs. Set STEM_EVIDENCE_DIR explicitly when regenerating artifacts.
const OUT = process.env.STEM_EVIDENCE_DIR
  ? path.resolve(process.env.STEM_EVIDENCE_DIR)
  : path.join(ROOT, ".tools/video-multielement-stem-e2e");
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(OUT, { recursive: true });
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
  async function exportProject(name) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".editor-export").click(),
    ]);
    const file = path.join(OUT, `${name}.video-project.json`);
    await download.saveAs(file);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  function working(shot) {
    return shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
  }
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").first().locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  const before = await exportProject("before");
  for (const [index, title, note, offset] of [
    [1, "四步看懂水循环", "海陆之间不断循环", "-65"],
    [4, "第三步：云化为雨", "雨滴落向地面", "30"],
  ]) {
    const shot = page.locator(".shot-card").nth(index);
    await shot.locator(".shot-edit-toggle").click();
    await shot.locator(".composition-title-input").fill(title);
    await shot.locator(".composition-annotation-0-text").fill(note);
    await shot.locator(".composition-diagramOffsetY-input").fill(offset);
    await shot.locator(".composition-diagramEnterMs-input").fill("600");
    if (index === 1) await shot.locator(".shot-duration-input").fill("4.01");
    await shot.locator(".shot-apply").click();
    await shot.locator(".shot-edit-toggle").click();
  }
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });
  const saved = await exportProject("edited");
  for (const index of [1, 4]) {
    assert.equal(
      working(saved.shots[index]).sceneSource.spec.componentId,
      "explainer-composition",
    );
    assert.equal(
      saved.shots[index].contentVersions.length,
      before.shots[index].contentVersions.length + 1,
    );
    assert.equal(
      working(saved.shots[index]).narrationText,
      working(before.shots[index]).narrationText,
    );
  }
  const [bibleDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出风格规范 JSON" }).click(),
  ]);
  await bibleDownload.saveAs(path.join(OUT, "stem.style-bible.json"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  const reopened = await exportProject("reopened");
  assert.equal(reopened.id, saved.id);
  for (const index of [1, 4])
    assert.equal(
      working(reopened.shots[index]).sceneSource.spec.params.title,
      working(saved.shots[index]).sceneSource.spec.params.title,
    );
  // Check both edited shots in the actual SVG preview and retain visual evidence.
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
    for (const [shot, frame, title] of [
      [2, 140, "四步看懂水循环"],
      [5, 430, "第三步：云化为雨"],
    ]) {
      await preview.locator(".preview-slider").evaluate((element, value) => {
        const set = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        set.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, frame);
      await preview
        .locator(".preview-frame", { hasText: `镜头 ${shot}` })
        .waitFor({ timeout: 5000 });
      assert(
        (await preview
          .locator(".preview-canvas text", { hasText: title })
          .count()) > 0,
      );
      await preview
        .locator(".piece-stage")
        .screenshot({ path: path.join(OUT, `${aspect}-${shot}.png`) });
    }
  }
  // Existing rollback contract remains available to the new component.
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
    saved.shots[1].contentVersions.length,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(OUT, "browser-report.json"),
    JSON.stringify(
      {
        pass: true,
        projectId: saved.id,
        editedShots: [2, 5],
        aspects: ["landscape", "portrait"],
        rollbackChecked: true,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("multi-element STEM browser: PASS");
} finally {
  await browser.close();
}
