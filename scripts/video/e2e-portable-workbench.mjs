#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const store = process.env.E2E_STORE_DIR;
const safeParent = path.join(root, ".tools");
if (!store || !path.resolve(store).startsWith(`${safeParent}${path.sep}`))
  throw new Error(
    "E2E_STORE_DIR 必须位于本工作树 .tools/ 下，且与服务端 ACS_MEDIA_STORE 一致",
  );
const out = path.join(root, ".tools/video-portable-workbench-e2e");
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
function probeVideo(file) {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output).streams[0];
}
try {
  const first = await browser.newContext({ acceptDownloads: true });
  const page = await first.newPage();
  captureErrors(page);
  await page.goto(`${baseUrl}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]");
  await page.locator(".sample-card").nth(2).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor();
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/video/portable"),
  );
  const downloadPromise = page
    .waitForEvent("download", { timeout: 120_000 })
    .catch(() => null);
  await page.locator(".editor-export-portable").click();
  const exportResponse = await responsePromise;
  if (!exportResponse.ok())
    throw new Error(
      `项目包导出 HTTP ${exportResponse.status()}: ${await exportResponse.text()}`,
    );
  const packageDownload = await downloadPromise;
  assert.ok(packageDownload, "成功响应后必须触发浏览器下载");
  const packageFile = path.join(out, "product.acs-video-package.json");
  await packageDownload.saveAs(packageFile);
  const text = readFileSync(packageFile, "utf8");
  const envelope = JSON.parse(text);
  const project = JSON.parse(
    Buffer.from(
      envelope.files.find(
        (entry) => entry.path === "project.video-project.json",
      ).base64,
      "base64",
    ).toString("utf8"),
  );
  assert.equal(project.shots.length, 5);
  assert.equal(project.mediaAssets.length, 1);
  const storeKey = project.mediaAssets[0].original.storeKey;
  const original = path.join(store, "original", storeKey);
  assert.ok(existsSync(original));
  unlinkSync(original);
  rmdirSync(path.dirname(original));
  assert.equal(existsSync(original), false);
  assert.equal(existsSync(path.dirname(original)), false);
  await first.close();

  const fresh = await browser.newContext({ acceptDownloads: true });
  const restoredPage = await fresh.newPage();
  captureErrors(restoredPage);
  await restoredPage.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
  });
  await restoredPage.waitForSelector("html[data-studio-ready]");
  const tampered = structuredClone(envelope);
  tampered.files.find((entry) => entry.path.startsWith("media/")).base64 =
    "YQ==";
  const badFile = path.join(out, "tampered.acs-video-package.json");
  writeFileSync(badFile, JSON.stringify(tampered));
  await restoredPage
    .locator(".project-portable-file-input")
    .setInputFiles(badFile);
  await restoredPage
    .locator(".editor-message", { hasText: "SHA-256" })
    .waitFor();
  assert.equal(await restoredPage.locator(".project-open").count(), 0);
  assert.equal(existsSync(original), false, "坏包不能恢复媒体原件");
  assert.equal(errors.length, 1, "篡改包应只产生一次预期的 400 控制台错误");
  assert.match(errors[0], /status of 400/);
  errors.length = 0;
  await restoredPage
    .locator(".project-portable-file-input")
    .setInputFiles(packageFile);
  await restoredPage
    .locator(".shot-card")
    .first()
    .waitFor({ timeout: 120_000 });
  assert.equal(await restoredPage.locator(".shot-card").count(), 5);
  assert.ok(existsSync(original), "导入应恢复媒体原件");
  const restoredBytes = readFileSync(original);
  assert.equal(
    createHash("sha256").update(restoredBytes).digest("hex"),
    project.mediaAssets[0].original.sha256,
  );
  await restoredPage.locator(".editor-render").click();
  await restoredPage
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 600_000 });
  assert.equal(await restoredPage.locator(".editor-downloads a").count(), 2);
  const videos = [];
  for (const [index, link] of (
    await restoredPage.locator(".editor-downloads a").all()
  ).entries()) {
    const [download] = await Promise.all([
      restoredPage.waitForEvent("download"),
      link.click(),
    ]);
    const file = path.join(out, download.suggestedFilename());
    await download.saveAs(file);
    const bytes = readFileSync(file);
    const probe = probeVideo(file);
    assert.deepEqual(
      probe,
      index === 0
        ? { codec_name: "h264", width: 1280, height: 720 }
        : { codec_name: "h264", width: 720, height: 1280 },
    );
    videos.push({
      file,
      bytes: bytes.length,
      probe,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await restoredPage.reload();
  await restoredPage.waitForSelector("html[data-studio-ready]");
  await restoredPage.locator(".project-open").first().click();
  await restoredPage.locator(".shot-card").first().waitFor();
  assert.equal(await restoredPage.locator(".shot-card").count(), 5);
  assert.deepEqual(errors, []);
  const report = {
    projectId: project.id,
    storeKey,
    restoredMediaSha256: project.mediaAssets[0].original.sha256,
    videos,
    consoleErrors: errors,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await fresh.close();
} finally {
  await browser.close();
}
