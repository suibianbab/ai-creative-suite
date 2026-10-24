#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".tools/video-portable-style-e2e");
mkdirSync(out, { recursive: true });
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3213";
const browser = await chromium.launch({ headless: true });
const errors = [];
function captureErrors(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}
try {
  const source = await browser.newContext({ acceptDownloads: true });
  const page = await source.newPage();
  captureErrors(page);
  await page.goto(`${baseUrl}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]");
  await page.locator(".sample-card").nth(3).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.locator(".editor-export-portable").click(),
  ]);
  const file = path.join(out, "renovation.acs-video-package.json");
  await download.saveAs(file);
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(envelope.files.some((entry) => entry.path === "style-bible.json"));
  await source.close();

  const fresh = await browser.newContext({ acceptDownloads: true });
  const restored = await fresh.newPage();
  captureErrors(restored);
  await restored.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
  });
  await restored.waitForSelector("html[data-studio-ready]");
  await restored.locator(".project-portable-file-input").setInputFiles(file);
  await restored.locator(".shot-card").first().waitFor({ timeout: 120_000 });
  assert.equal(await restored.locator(".shot-card").count(), 5);
  await restored.reload();
  await restored.waitForSelector("html[data-studio-ready]");
  await restored.locator(".project-open").first().click();
  await restored.locator(".shot-card").first().waitFor();
  await restored.locator(".editor-render").click();
  await restored
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 600_000 });
  assert.equal(await restored.locator(".editor-downloads a").count(), 2);
  assert.deepEqual(errors, []);
  const report = {
    project: "renovation",
    shots: 5,
    aspectDownloads: 2,
    consoleErrors: errors,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await fresh.close();
} finally {
  await browser.close();
}
