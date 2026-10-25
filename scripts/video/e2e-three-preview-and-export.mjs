#!/usr/bin/env node
// Browser acceptance: two Three shots must require an explicit choice; the
// selected current version is exported, and both aspects show bake-harness PNG.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".tools/codex-three-preview-e2e");
mkdirSync(out, { recursive: true });
const project = JSON.parse(
  readFileSync(
    path.join(
      root,
      "artifacts/video-studio-t1-portrait-3d-2026-10-25/project-v2.json",
    ),
  ),
);
project.id = randomUUID();
project.title = "双 3D 镜头取景测试";
project.renderRecords = [];
project.deliveries = [];
project.savedVersion = 1;
const second = structuredClone(project.shots[0]);
second.shotId = randomUUID();
second.order = project.shots.length;
second.workingVersionId = randomUUID();
second.contentVersions[0].versionId = second.workingVersionId;
second.contentVersions[0].sceneSource.spec.params.shape = "sphere";
second.contentVersions[0].sceneSource.spec.params.zoom = 1.7;
second.events[0].versionId = second.workingVersionId;
project.shots.push(second);
const projectPath = path.join(out, "two-three-project.json");
writeFileSync(projectPath, JSON.stringify(project));

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${process.env.BASE_URL ?? "http://localhost:3210"}/video-studio`,
  );
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "导入项目 JSON" }).click(),
  ]);
  await chooser.setFiles(projectPath);
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  const preview = page.locator(".piece-preview");
  await preview.locator(".preview-slider").fill("1");
  const image = preview.locator(".three-preview-image");
  await image.waitFor({ timeout: 40_000 });
  assert.deepEqual(
    await image.evaluate((img) => [img.naturalWidth, img.naturalHeight]),
    [1280, 720],
  );
  await preview.getByRole("button", { name: "竖版" }).click();
  await image.waitFor({ timeout: 40_000 });
  await page.waitForFunction(
    () => {
      const img = document.querySelector(".piece-preview .three-preview-image");
      return img?.naturalWidth === 720 && img.naturalHeight === 1280;
    },
    null,
    { timeout: 40_000 },
  );
  await page.screenshot({ path: path.join(out, "portrait-preview.png") });

  const choose = page.locator(".interactive-shot-select");
  assert.equal(
    await choose.inputValue(),
    "-1",
    "two Three shots require explicit selection",
  );
  assert.equal(
    await page.locator(".editor-export-interactive").isDisabled(),
    true,
  );
  await choose.selectOption("2");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export-interactive").click(),
  ]);
  const htmlPath = path.join(out, "selected-sphere.html");
  await download.saveAs(htmlPath);
  await page
    .getByText("交付记录已入账", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  const html = readFileSync(htmlPath);
  assert.match(html.toString(), /"shape":"sphere"/);
  assert.match(html.toString(), /"zoom":1.7/);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.locator("#stage canvas").waitFor({ timeout: 10_000 });
  const cameraDistance = await offline.evaluate(() => app.state.cameraDistance);
  assert.ok(
    Math.abs(cameraDistance - Math.hypot(1.6, 5.2) * 1.7) < 0.001,
    "The shipped runtime must actually apply zoom to the camera",
  );
  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const exportedPath = path.join(out, "exported-project.json");
  await jsonDownload.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath));
  const delivery = exported.deliveries.at(-1);
  assert.deepEqual(delivery.versionIds, [second.workingVersionId]);
  assert.equal(
    delivery.digest,
    createHash("sha256").update(html).digest("hex"),
  );

  // Imported projects get only shallow Three param validation. The browser
  // export must reject an HTML-closing payload before any download or ledger
  // write, even though the project itself is importable.
  const hostile = structuredClone(project);
  hostile.id = randomUUID();
  hostile.shots[0].contentVersions[0].sceneSource.spec.params.shape =
    "</script><script>window.__injected=1</script>";
  const hostilePath = path.join(out, "hostile-project.json");
  writeFileSync(hostilePath, JSON.stringify(hostile));
  const hostileContext = await browser.newContext({ acceptDownloads: true });
  const hostilePage = await hostileContext.newPage();
  await hostilePage.goto(
    `${process.env.BASE_URL ?? "http://localhost:3210"}/video-studio`,
  );
  await hostilePage.waitForSelector("html[data-studio-ready]", {
    timeout: 30_000,
  });
  const [hostileChooser] = await Promise.all([
    hostilePage.waitForEvent("filechooser"),
    hostilePage.getByRole("button", { name: "导入项目 JSON" }).click(),
  ]);
  await hostileChooser.setFiles(hostilePath);
  await hostilePage.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  await hostilePage.locator(".interactive-shot-select").selectOption("0");
  let hostileDownloads = 0;
  hostilePage.on("download", () => {
    hostileDownloads += 1;
  });
  await hostilePage.locator(".editor-export-interactive").click();
  await hostilePage
    .locator(".editor-message")
    .getByText("3D 主体形状不受支持", { exact: true })
    .waitFor({ timeout: 5000 });
  assert.equal(hostileDownloads, 0);
  assert.equal(await hostilePage.evaluate(() => window.__injected), undefined);
  const [hostileJson] = await Promise.all([
    hostilePage.waitForEvent("download"),
    hostilePage.locator(".editor-export").click(),
  ]);
  const hostileExportPath = path.join(out, "hostile-after-rejection.json");
  await hostileJson.saveAs(hostileExportPath);
  assert.deepEqual(JSON.parse(readFileSync(hostileExportPath)).deliveries, []);
  await hostileContext.close();
  assert.deepEqual(errors, []);
  console.log(`Three preview + selected export: PASS → ${out}`);
} finally {
  await browser.close();
}
