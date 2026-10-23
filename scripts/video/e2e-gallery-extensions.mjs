#!/usr/bin/env node
// Dual-theme gallery extension acceptance: create from the new sample cards,
// edit a title plus one annotation, save, reopen, roll back, preview and
// export evidence in both aspects. No TTS: renders are silent.
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
  process.env.GALLERY_EVIDENCE_DIR ??
    path.join(root, ".tools/video-gallery-extensions-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });

const THEMES = [
  {
    name: "renovation",
    cardIndex: 3,
    shotCount: 5,
    titleFrom: "改造四步",
    titleTo: "旧房改造四步",
    annotationTo: "预算与工期都可控",
  },
  {
    name: "appliance",
    cardIndex: 4,
    shotCount: 5,
    titleFrom: "维护四步",
    titleTo: "滤芯更换四步",
    annotationTo: "断电后等待十分钟",
  },
];

const browser = await chromium.launch({ headless: true });
const errors = [];
const report = { themes: [], errors };
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

  for (const theme of THEMES) {
    await page.goto(`${baseUrl}/video-studio`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
    await page
      .locator(".sample-card")
      .nth(theme.cardIndex)
      .locator(".sample-use")
      .click();
    await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
    assert.equal(await page.locator(".shot-card").count(), theme.shotCount);
    const before = await exportProject(`${theme.name}-before`);
    assert.equal(before.shots.length, theme.shotCount);
    assert.ok(before.styleBibleRef, `${theme.name} sample must link a bible`);
    assert.equal(
      working(before.shots[1]).sceneSource.spec.params.title,
      theme.titleFrom,
    );

    // Edit the flow shot's title and first annotation; check the prefill
    // semantics hint is visible while the editor is open.
    const flowCard = page.locator(".shot-card").nth(1);
    await flowCard.locator(".shot-edit-toggle").click();
    await page
      .getByText("选中模板即把模板内容预填进下方编辑区", { exact: false })
      .first()
      .waitFor({ timeout: 10_000 });
    await flowCard.locator(".composition-title-input").fill(theme.titleTo);
    await flowCard
      .locator(".composition-annotation-0-text")
      .fill(theme.annotationTo);
    const versionCount = await flowCard
      .locator(".shot-version-select option")
      .count();
    await flowCard.locator(".shot-apply").click();
    await flowCard
      .locator(".shot-version-select option")
      .nth(versionCount)
      .waitFor({ state: "attached", timeout: 20_000 });
    assert.equal(await flowCard.locator(".shot-edit-error").count(), 0);
    // Revisions stay in memory until the editor's explicit save.
    await page.locator(".editor-save").click();
    await page
      .getByText("已保存", { exact: false })
      .first()
      .waitFor({ timeout: 10_000 });
    const edited = await exportProject(`${theme.name}-edited`);
    assert.equal(
      working(edited.shots[1]).sceneSource.spec.params.title,
      theme.titleTo,
    );
    assert.equal(
      working(edited.shots[1]).sceneSource.spec.params.annotations[0].text,
      theme.annotationTo,
    );

    // Reopen after a full reload; the edit must persist.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
    await page.locator(".project-open").first().click();
    await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
    const reopened = await exportProject(`${theme.name}-reopened`);
    assert.equal(reopened.id, edited.id);
    assert.equal(
      working(reopened.shots[1]).sceneSource.spec.params.title,
      theme.titleTo,
    );

    // Dual-aspect preview with canvas-size assertions and visual evidence.
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
      await preview.locator(".preview-slider").evaluate((element, value) => {
        const set = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        set.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, 120);
      await preview
        .locator(".preview-frame", { hasText: "镜头 2" })
        .waitFor({ timeout: 5000 });
      await preview
        .locator(".piece-stage")
        .screenshot({
          path: path.join(out, `${theme.name}-${aspect}-shot2.png`),
        });
    }

    // Roll the flow shot back to its gallery version.
    await flowCard.locator(".shot-version-select").selectOption(
      before.shots[1].workingVersionId,
    );
    await flowCard.locator(".shot-rollback").click();
    const rolled = await exportProject(`${theme.name}-rollback-check`);
    assert.equal(
      rolled.shots[1].workingVersionId,
      before.shots[1].workingVersionId,
    );
    assert.equal(
      working(rolled.shots[1]).sceneSource.spec.params.title,
      theme.titleFrom,
    );

    report.themes.push({
      name: theme.name,
      projectId: edited.id,
      editedTitle: theme.titleTo,
      rollbackChecked: true,
      aspects: ["landscape", "portrait"],
    });
  }
} finally {
  await browser.close();
}
report.errors = errors;
writeFileSync(path.join(out, "browser-report.json"), JSON.stringify(report));
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
console.log(`gallery-extensions e2e: ${report.themes.length} themes OK → ${out}`);
