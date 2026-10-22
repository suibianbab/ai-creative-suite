// Real browser import/export round trip for the EffectCraft handoff document.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = process.argv.includes("--record")
  ? here
  : path.resolve(here, "../../.tools/effectcraft-browser-handoff");
mkdirSync(outputDir, { recursive: true });
const input = path.join(here, "handoff-landscape.json");
const original = JSON.parse(readFileSync(input, "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.BASE_URL ?? "http://localhost:3210"}/video-studio`,
    {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    },
  );
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page
    .locator('input[accept=".json,application/json"]')
    .nth(1)
    .setInputFiles(input);
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".shot-card").count(), 4);
  await page.waitForFunction(
    () => {
      const video = document.querySelector("video.media-stage");
      return video && video.readyState >= 2 && video.videoWidth > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
  assert.equal(await page.locator(".media-missing").count(), 0);
  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(outputDir, "browser-handoff.png"),
    fullPage: true,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const output = path.join(outputDir, "browser-roundtrip.json");
  await download.saveAs(output);
  const returned = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(returned.id, original.id);
  assert.deepEqual(
    returned.shots.map((shot) => shot.shotId),
    original.shots.map((shot) => shot.shotId),
  );
  assert.equal(returned.shots.length, 4);
  for (let i = 0; i < 4; i++) {
    const source = original.shots[i];
    const roundtrip = returned.shots[i];
    assert.equal(roundtrip.workingVersionId, source.workingVersionId);
    assert.deepEqual(roundtrip.contentVersions, source.contentVersions);
    assert(
      roundtrip.contentVersions.some(
        (version) => version.sceneSource.type === "editor-binding",
      ),
    );
    assert(
      roundtrip.contentVersions.some(
        (version) => version.sceneSource.type === "media-clip",
      ),
    );
  }
  assert.equal(errors.length, 0, errors.join("; "));
  console.log(
    JSON.stringify({
      pass: true,
      projectId: returned.id,
      shots: returned.shots.length,
      previewMediaLoaded: true,
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
