#!/usr/bin/env node
// P4: three real browser flows, including edit, reload, media replacement and dual MP4 export.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, ".tools/video-p4-gallery");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

function probe(file) {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
}

async function exportProject(page, name) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const file = path.join(OUT, `${name}.video-project.json`);
  await download.saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function editShot(page, index, selector, value) {
  const shot = page.locator(".shot-card").nth(index);
  await shot.locator(".shot-edit-toggle").click();
  await shot.locator(selector).fill(value);
  await shot.locator(".shot-apply").click();
  await shot.locator(".shot-edit-toggle").click();
}

async function runSample(sampleId, position) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
  const steps = [];
  try {
    await page.goto(`${BASE_URL}/video-studio`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
    await page
      .locator(".sample-card")
      .nth(position)
      .locator(".sample-use")
      .click();
    await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
    const count = await page.locator(".shot-card").count();
    assert.equal(count, sampleId === "product" ? 5 : 4);
    steps.push("gallery-create");
    await page.screenshot({
      path: path.join(OUT, `${sampleId}-created.png`),
      fullPage: true,
    });

    await editShot(
      page,
      0,
      ".shot-title-input",
      `${sampleId.toUpperCase()} 自定义标题`,
    );
    if (sampleId === "stem")
      await editShot(page, 1, ".flow-title-input", "水循环：蒸发、凝结、降水");
    if (sampleId === "data")
      await editShot(page, 1, ".chart-title-input", "季度销量对比");
    if (sampleId === "product") {
      const replacement = path.join(OUT, "product-replacement.mp4");
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        path.join(ROOT, "apps/web/public/samples/p4-hat-product.mp4"),
        "-vf",
        "hue=s=0.7",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        replacement,
      ]);
      await page
        .locator(".media-panel input[type=file]")
        .setInputFiles(replacement);
      await page.locator(".media-upload").click();
      await page.locator(".media-item").nth(1).waitFor({ timeout: 30_000 });
      const shot = page.locator(".shot-card").nth(1);
      await shot.locator(".shot-edit-toggle").click();
      const select = shot.locator(".media-asset-select");
      assert((await select.locator("option").count()) >= 2);
      const replacementId = await select
        .locator("option")
        .last()
        .getAttribute("value");
      assert(replacementId);
      await select.selectOption(replacementId);
      await shot.locator(".shot-apply").click();
      await shot.locator(".shot-edit-toggle").click();
      steps.push("media-replaced");
    }
    await page.locator(".editor-save").click();
    await page
      .locator(".editor-message", { hasText: "已保存" })
      .waitFor({ timeout: 20_000 });
    const before = await exportProject(page, `${sampleId}-edited`);
    assert(
      JSON.stringify(before).includes(`${sampleId.toUpperCase()} 自定义标题`),
    );
    if (sampleId === "product") {
      assert.equal(before.styleBibleRef, undefined);
      assert.equal(before.mediaAssets.length, 2);
      const working = before.shots[1].contentVersions.find(
        (version) => version.versionId === before.shots[1].workingVersionId,
      );
      assert.equal(
        working.sceneSource.mediaAssetId,
        before.mediaAssets[1].assetId,
      );
    } else {
      assert(before.styleBibleRef);
    }
    steps.push("edited-and-saved");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
    await page.locator(".project-open").first().click();
    const reopened = await exportProject(page, `${sampleId}-reopened`);
    assert.equal(reopened.id, before.id);
    assert(
      JSON.stringify(reopened).includes(`${sampleId.toUpperCase()} 自定义标题`),
    );
    steps.push("reopened");
    await page.screenshot({
      path: path.join(OUT, `${sampleId}-reopened.png`),
      fullPage: true,
    });

    const renderResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/video/render") &&
        response.request().method() === "POST",
      { timeout: 600_000 },
    );
    await page.locator(".editor-render").click();
    const response = await renderResponse;
    const payload = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(payload));
    assert.equal(payload.downloads.length, 2);
    await page
      .locator(".editor-downloads a")
      .first()
      .waitFor({ timeout: 30_000 });
    const outputs = [];
    for (const download of payload.downloads) {
      const result = await context.request.get(`${BASE_URL}${download.url}`);
      assert.equal(result.status(), 200);
      const file = path.join(OUT, `${sampleId}-${download.aspect}.mp4`);
      const bytes = await result.body();
      writeFileSync(file, bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        download.digest,
      );
      const info = probe(file);
      assert.equal(
        info.streams[0].width,
        download.aspect === "landscape" ? 1280 : 720,
      );
      assert.equal(
        info.streams[0].height,
        download.aspect === "landscape" ? 720 : 1280,
      );
      outputs.push({
        aspect: download.aspect,
        bytes: bytes.length,
        digest: download.digest,
        duration: Number(info.format.duration),
      });
    }
    const after = await exportProject(page, `${sampleId}-rendered`);
    assert.equal(
      after.renderRecords.length - reopened.renderRecords.length,
      count * 2,
    );
    steps.push("dual-mp4-rendered-and-ledger-saved");
    await page.screenshot({
      path: path.join(OUT, `${sampleId}-rendered.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({
      sampleId,
      steps,
      projectId: before.id,
      shotCount: count,
      outputs,
      errors,
    });
  } catch (error) {
    await page
      .screenshot({
        path: path.join(OUT, `${sampleId}-failure.png`),
        fullPage: true,
      })
      .catch(() => {});
    results.push({ sampleId, steps, error: String(error), errors });
    throw error;
  } finally {
    writeFileSync(
      path.join(OUT, "report.json"),
      JSON.stringify(results, null, 2),
    );
    await context.close();
  }
}

try {
  const selected = process.env.SAMPLE_ID;
  for (const [index, id] of ["stem", "data", "product"].entries()) {
    if (!selected || selected === id) await runSample(id, index);
  }
  console.log(JSON.stringify({ failures: 0, results }, null, 2));
} finally {
  await browser.close();
}
