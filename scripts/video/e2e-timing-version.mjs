#!/usr/bin/env node
// VID-064：旧 @1 图示导入后，用户启用新入场时序才追加 @2 版本。
// 新版末帧的数值边界由 compare-split.test.ts 覆盖；此处验真实浏览器接线。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.TIMING_EVIDENCE_DIR ?? path.join(root, ".tools/video-timing-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://localhost:3210";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "zh-CN",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });

  // 由当前样片生成有效项目及 Style Bible，再模拟历史上已保存的 @1 图示。
  const sample = page
    .locator(".sample-card")
    .filter({ hasText: "季度业务数据简报" });
  await sample.locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  const firstDownload = page.waitForEvent("download");
  await page.locator(".editor-export").click();
  const source = JSON.parse(
    readFileSync(await (await firstDownload).path(), "utf8"),
  );
  source.id = randomUUID();
  source.title = "旧版图示入场回归";
  const oldVersions = new Map();
  for (const shot of source.shots) {
    for (const version of shot.contentVersions) {
      const spec = version.sceneSource?.spec;
      if (!["compare-split", "timeline-milestones"].includes(spec?.componentId))
        continue;
      spec.componentVersion = 1;
      delete spec.params.sequence;
      oldVersions.set(spec.componentId, version.versionId);
    }
  }
  assert.equal(oldVersions.size, 2);

  await page.getByRole("button", { name: "返回列表" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".project-import").first().click();
  await (await chooser).setFiles({
    name: "legacy-timing.video-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.locator(".shot-card").nth(5).waitFor({ timeout: 15_000 });

  const compare = page.locator(".shot-card").nth(2);
  await compare.locator(".shot-edit-toggle").click();
  assert.match(
    await compare.locator(".shot-template-note").last().innerText(),
    /等比压缩/,
  );
  await compare.locator(".compare-sequence-select").selectOption("sync");
  await compare.locator(".compare-enter-ms-input").fill("5000");
  await compare.locator(".shot-apply").click();
  await compare.locator(".shot-edit-toggle").click();

  const timeline = page.locator(".shot-card").nth(3);
  await timeline.locator(".shot-edit-toggle").click();
  await timeline.locator(".timeline-enter-ms-input").fill("5000");
  await timeline.locator(".shot-apply").click();
  await timeline.locator(".shot-edit-toggle").click();

  await page.locator(".editor-save").click();
  await page.getByText("已保存", { exact: false }).first().waitFor({
    timeout: 10_000,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").nth(5).waitFor({ timeout: 30_000 });

  const editedDownload = page.waitForEvent("download");
  await page.locator(".editor-export").click();
  const edited = JSON.parse(
    readFileSync(await (await editedDownload).path(), "utf8"),
  );
  const upgraded = new Set();
  for (const shot of edited.shots) {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const spec = working?.sceneSource?.spec;
    if (!["compare-split", "timeline-milestones"].includes(spec?.componentId))
      continue;
    assert.equal(spec.componentVersion, 2);
    assert.equal(spec.params.enterMs, 5000);
    upgraded.add(spec.componentId);
    assert.ok(
      shot.contentVersions.some(
        (version) =>
          version.versionId === oldVersions.get(spec.componentId) &&
          version.sceneSource.spec.componentVersion === 1,
      ),
      `${spec.componentId} 须保留原 @1 内容版本`,
    );
  }
  assert.deepEqual([...upgraded].sort(), [
    "compare-split",
    "timeline-milestones",
  ]);
  writeFileSync(
    path.join(out, "edited.video-project.json"),
    JSON.stringify(edited, null, 2),
  );

  // 回滚至旧内容版本，确认版本切换没有把旧 spec 改写成 @2。
  const compareAfter = page.locator(".shot-card").nth(2);
  await compareAfter.locator(".shot-edit-toggle").click();
  await compareAfter
    .locator(".shot-version-select")
    .selectOption(oldVersions.get("compare-split"));
  await compareAfter.locator(".shot-rollback").click();
  const rolledDownload = page.waitForEvent("download");
  await page.locator(".editor-export").click();
  const rolled = JSON.parse(
    readFileSync(await (await rolledDownload).path(), "utf8"),
  );
  assert.equal(
    rolled.shots[2].contentVersions.find(
      (version) => version.versionId === rolled.shots[2].workingVersionId,
    ).sceneSource.spec.componentVersion,
    1,
  );
  assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
} finally {
  await browser.close();
}
console.log(`VID-064 timing version browser regression: PASS → ${out}`);
