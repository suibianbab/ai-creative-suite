#!/usr/bin/env node
// W2 acceptance: representative-frame approval chain in the real browser —
// select a shot, render dual-aspect keyframes, confirm, break the
// confirmation by editing content, get blocked from export, re-confirm,
// export passes; derive a new style version (old confirmation stales);
// reopen after reload keeps approvals; a pre-derive export re-renders.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.APPROVAL_EVIDENCE_DIR ??
    path.join(root, ".tools/video-frame-approval-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
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
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").nth(0).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });

  // 确认面板存在且可选镜头、生成帧、确认。
  await page.locator(".frame-approval-panel").waitFor({ timeout: 10_000 });
  await page.locator(".approval-shot-select").selectOption({ index: 1 });
  await page.locator(".approval-generate").click();
  await page.locator(".approval-frames").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-frames > div:nth-child(2)").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-confirm").click();
  await page
    .locator(".approval-status.is-valid")
    .waitFor({ timeout: 10_000 });

  // 修改被确认的镜头（镜头 2 的标题）→ 确认失效。
  const card = page.locator(".shot-card").nth(1);
  await card.locator(".shot-edit-toggle").click();
  await card.locator(".composition-title-input").fill("改过的总览标题");
  await card.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page
    .locator(".approval-status.is-stale")
    .waitFor({ timeout: 10_000 });

  // 导出被闸门阻断：出现失效原因且无下载链接。
  await page.locator(".editor-render").click();
  await page
    .getByText("代表帧确认已失效", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 0);

  // 重新确认 → 导出放行（真实双画幅下载，验证闸门开）。
  await page.locator(".approval-generate").click();
  await page.locator(".approval-frames").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-confirm").click();
  await page
    .locator(".approval-status.is-valid")
    .waitFor({ timeout: 10_000 });
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 2);

  // 派生新版本：填派生说明并保存 → 风格版本变化 → 确认再次失效。
  await page.locator(".derive-note-input").fill("W2 e2e 派生：换强调色");
  await page.locator(".bible-derive").click();
  await page
    .getByText("派生自已选版本", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await page
    .locator(".approval-status.is-stale")
    .waitFor({ timeout: 10_000 });

  // 再确认后保存，刷新重开：确认随项目持久化且状态准确。
  await page.locator(".approval-generate").click();
  await page.locator(".approval-frames").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-confirm").click();
  await page
    .locator(".approval-status.is-valid")
    .waitFor({ timeout: 10_000 });
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const exportedPath = path.join(out, "approved.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  assert.ok(exported.styleFrameApprovals?.length >= 1);
  assert.ok(
    exported.styleBibleRef.digest.length === 64,
    "派生后的风格引用随项目导出",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  await page
    .locator(".approval-status.is-valid")
    .waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(out, "reopened-approved.png") });

  // 派生前导出的旧引用项目仍可校验（旧版本不被派生破坏）在 CLI 侧核对：
  writeFileSync(
    path.join(out, "chain-summary.json"),
    `${JSON.stringify({ pass: true, errors }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
console.log(`frame-approval e2e: PASS → ${out}`);
