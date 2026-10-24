#!/usr/bin/env node
// W1 acceptance: apply the three shot recipes in the real browser, edit,
// save, reopen, roll nothing back implicitly, verify both aspect previews,
// then render dual-aspect MP4s from the exported project and check that the
// catalog preview text matches the exported render at the preview frame.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.RECIPE_EVIDENCE_DIR ??
    path.join(root, ".tools/video-shot-recipes-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
let exportedPath = "";
let exported = null;
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
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-create").click();
  await page.locator(".recipe-card").first().waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".recipe-card").count(), 3);

  // Text recipe: fill title/subtitle and apply.
  const cards = page.locator(".recipe-card");
  await cards.nth(0).locator(".recipe-toggle").click();
  await cards.nth(0).locator(".recipe-title-input").fill("开场提问");
  await cards.nth(0).locator(".recipe-subtitle-input").fill("三十秒讲清楚");
  await cards.nth(0).locator(".recipe-apply").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".shot-card").count(), 1);

  // Data recipe: custom bars.
  await cards.nth(1).locator(".recipe-toggle").click();
  await cards.nth(1).locator(".recipe-title-input").fill("月度对比");
  await cards.nth(1).locator(".recipe-labels-input").fill("一月,二月,三月");
  await cards.nth(1).locator(".recipe-values-input").fill("3,6,9");
  await cards.nth(1).locator(".recipe-apply").click();
  await page
    .locator(".shot-card")
    .nth(1)
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".shot-card").count(), 2);

  // Product recipe: upload the built-in sample clip, then pick it.
  const clipPath = path.join(out, "product.mp4");
  const response = await page.request.get(`${baseUrl}/samples/p4-hat-product.mp4`);
  writeFileSync(clipPath, await response.body());
  await page.locator(".media-panel input[type=file]").setInputFiles(clipPath);
  await page.locator(".media-upload").click();
  await page
    .locator(".media-item")
    .first()
    .waitFor({ timeout: 30_000 });
  await cards.nth(2).locator(".recipe-toggle").click();
  const select = cards.nth(2).locator(".recipe-asset-select");
  await select.waitFor({ timeout: 10_000 });
  await select.selectOption({ index: 1 });
  await cards.nth(2).locator(".recipe-apply").click();
  await page
    .locator(".shot-card")
    .nth(2)
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".shot-card").count(), 3);
  const project = await page.evaluate(() => document.title);
  assert.ok(project.length > 0);

  // Edit the text shot's title through the normal editor path.
  const firstCard = page.locator(".shot-card").nth(0);
  await firstCard.locator(".shot-edit-toggle").click();
  await firstCard.locator(".shot-title-input").fill("开场提问（改）");
  await firstCard.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });

  // Save, reload, reopen; the three recipe shots must persist.
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  exportedPath = path.join(out, "recipes.video-project.json");
  await download.saveAs(exportedPath);
  exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  assert.equal(exported.shots.length, 3);
  assert.equal(
    exported.shots[0].contentVersions.find(
      (version) => version.versionId === exported.shots[0].workingVersionId,
    ).sceneSource.spec.params.title,
    "开场提问（改）",
  );
  assert.equal(
    exported.shots[1].contentVersions.find(
      (version) => version.versionId === exported.shots[1].workingVersionId,
    ).sceneSource.spec.componentId,
    "bar-chart",
  );
  assert.equal(
    exported.shots[2].contentVersions.find(
      (version) => version.versionId === exported.shots[2].workingVersionId,
    ).sceneSource.type,
    "media-clip",
  );
  assert.equal(exported.mediaAssets.length, 1);
  assert.equal(exported.brief.applications.length, 3);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".shot-card").count(), 3);
  const [reopenExport] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const reopenPath = path.join(out, "recipes-reopened.video-project.json");
  await reopenExport.saveAs(reopenPath);
  const reopened = JSON.parse(readFileSync(reopenPath, "utf8"));
  assert.equal(reopened.id, exported.id);
  assert.equal(
    reopened.shots[0].contentVersions.find(
      (version) => version.versionId === reopened.shots[0].workingVersionId,
    ).sceneSource.spec.params.title,
    "开场提问（改）",
  );

  // Dual-aspect preview assertions.
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
  await page.screenshot({ path: path.join(out, "editor-recipes.png") });
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);

// Real dual-aspect renders from the exported project (silent; recipes carry
// narrationText but this line does not synthesize audio).
const renderDir = path.join(out, "render");
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    exportedPath,
    "--out",
    renderDir,
  ],
  { cwd: root, stdio: "inherit" },
);
const manifest = JSON.parse(
  readFileSync(path.join(renderDir, "render-manifest.json"), "utf8"),
);
for (const aspect of ["landscape", "portrait"]) {
  assert.equal(manifest.aspects[aspect].frameMap.length, 3);
  const file = path.join(renderDir, `${aspect}.mp4`);
  const probe = JSON.parse(
    execFileSync(
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
    ),
  ).streams[0];
  assert.equal(probe.codec_name, "h264");
  assert.deepEqual(
    [probe.width, probe.height],
    aspect === "landscape" ? [1280, 720] : [720, 1280],
  );
  // Extract the text shot's mid frame for human review evidence.
  const map = manifest.aspects[aspect].frameMap[0];
  const mid = map.startFrame + Math.floor(map.frames / 2);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    (mid / 24).toFixed(3),
    "-i",
    file,
    "-frames:v",
    "1",
    path.join(out, `${aspect}-shot1-mid.png`),
  ]);
}

// Preview/export consistency: render the exported text shot at the catalog
// preview frame through the same registry and compare visible text sets.
const { defaultRegistry } = await import(
  pathToFileURL(
    path.join(root, "packages/video-scene/dist/index.js"),
  ).href
);
const { recipePreviewSvg, SHOT_RECIPES } = await import(
  pathToFileURL(
    path.join(root, "apps/web/src/app/video-studio/shot-recipes.ts"),
  ).href
);
const textRecipe = SHOT_RECIPES.find((r) => r.id === "recipe-text-point");
const working = exported.shots[0].contentVersions.find(
  (version) => version.versionId === exported.shots[0].workingVersionId,
);
const spec = working.sceneSource.spec;
const durationFrames = Math.ceil((spec.durationMs / 1000) * 24);
const exportedRender = defaultRegistry
  .get(spec.componentId, spec.componentVersion)
  .render(spec, {
    frame: Math.min(textRecipe.previewFrame, durationFrames - 1),
    fps: 24,
    durationFrames,
    width: 320,
    height: 180,
    random: () => 0.42,
  });
const collectText = (node) =>
  node.text ? [node.text] : (node.children ?? []).flatMap(collectText);
const exportedTexts = collectText(exportedRender).join("|");
const catalogSvg = recipePreviewSvg(textRecipe, {
  title: "开场提问（改）",
  subtitle: "三十秒讲清楚",
});
assert.ok(catalogSvg.includes("开场提问（改）"), "目录预览含输入标题");
assert.ok(
  exportedTexts.includes("开场提问（改）") &&
    exportedTexts.includes("三十秒讲清楚"),
  `导出渲染帧须含配方文本：${exportedTexts}`,
);
writeFileSync(
  path.join(out, "report.json"),
  `${JSON.stringify(
    { pass: true, projectId: exported.id, shots: 3, errors },
    null,
    2,
  )}\n`,
);
console.log(`shot-recipes e2e: PASS → ${out}`);
