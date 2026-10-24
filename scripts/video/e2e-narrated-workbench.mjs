#!/usr/bin/env node
// 本地真实链路：样片 → 浏览器有声出片 → 双下载 → 音轨/字幕/记录审计。
// 需要 DASHSCOPE_API_KEY；会按现有 TTS 台账产生少量计费。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".tools/video-narrated-workbench-e2e");
const baseUrl = process.env.BASE_URL ?? "http://localhost:3212";
if (!process.env.DASHSCOPE_API_KEY)
  throw new Error("真实有声验收需要 DASHSCOPE_API_KEY");
mkdirSync(out, { recursive: true });

const probe = (file) =>
  JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", file],
      {
        encoding: "utf8",
      },
    ),
  );
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (event) => {
  if (event.type() === "error") errors.push(event.text());
});
try {
  await page.goto(`${baseUrl}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").first().locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  assert.equal(await page.locator(".shot-card").count(), 7);
  assert.equal(await page.locator(".editor-render-narrated").isEnabled(), true);
  await page.locator(".editor-render-narrated").click();
  await page.waitForFunction(
    () => !document.querySelector(".editor-render-narrated")?.disabled,
    null,
    { timeout: 900_000 },
  );
  assert.match(
    await page.locator(".editor-message").innerText(),
    /有声横竖版视频已生成/,
  );
  assert.equal(await page.locator(".editor-downloads a").count(), 2);
  await page.screenshot({
    path: path.join(out, "narrated-ready.png"),
    fullPage: true,
  });

  const files = {};
  const downloads = {};
  for (const aspect of ["landscape", "portrait"]) {
    const link = page.locator(`.editor-downloads a[href$="/${aspect}"]`);
    const url = await link.getAttribute("href");
    assert(url);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      link.click(),
    ]);
    const file = path.join(out, `${aspect}.mp4`);
    await download.saveAs(file);
    const streams = probe(file).streams;
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video?.codec_name, "h264");
    assert.equal(audio?.codec_name, "aac");
    assert.equal(video.width, aspect === "landscape" ? 1280 : 720);
    assert.equal(video.height, aspect === "landscape" ? 720 : 1280);
    files[aspect] = {
      bytes: readFileSync(file).byteLength,
      digest: sha256(file),
    };
    downloads[aspect] = url;
  }

  const [projectDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const projectFile = path.join(out, "project.video-project.json");
  await projectDownload.saveAs(projectFile);
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  assert.equal(project.shots.length, 7);
  assert.equal(project.renderRecords.length, 14);
  const jobId = downloads.landscape.split("/").at(-2);
  assert.equal(jobId, downloads.portrait.split("/").at(-2));
  const jobDir = path.join(root, ".tools/video-workbench-renders", jobId);
  const manifest = JSON.parse(
    readFileSync(path.join(jobDir, "render/render-manifest.json"), "utf8"),
  );
  for (const aspect of ["landscape", "portrait"]) {
    assert.equal(manifest.aspects[aspect].narration.length, 7);
    assert.equal(manifest.aspects[aspect].subtitleCues.length, 7);
    assert(manifest.aspects[aspect].subtitleCues.every((cue) => cue.cues > 0));
  }
  assert.deepEqual(errors, []);
  const report = {
    projectId: project.id,
    shotCount: project.shots.length,
    renderRecords: project.renderRecords.length,
    files,
    downloads,
    subtitleShots: manifest.aspects.landscape.subtitleCues.length,
    consoleErrors: errors,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
