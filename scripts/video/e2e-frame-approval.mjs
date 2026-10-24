#!/usr/bin/env node
// W2 acceptance: representative-frame approval chain in the real browser —
// select a shot, render dual-aspect keyframes, confirm, break the
// confirmation by editing content, get blocked from export, re-confirm,
// export passes; derive a new style version (old confirmation stales);
// reopen after reload keeps approvals; a pre-derive export re-renders.
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
  process.env.APPROVAL_EVIDENCE_DIR ??
    path.join(root, ".tools/video-frame-approval-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
let preDerivePath = "";
let biblePath = "";
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

  // 确认面板存在且可选镜头、生成帧、确认。选卡与镜头的配对用显式值
  // 而非隐式 index 耦合（面板下拉只列 spec 镜头，与镜头卡序列不同源）。
  await page.locator(".frame-approval-panel").waitFor({ timeout: 10_000 });
  const approvedShotId = await page
    .locator(".approval-shot-select option")
    .nth(1)
    .getAttribute("value");
  assert.ok(approvedShotId, "下拉第二项须有 shotId 值");
  await page.locator(".approval-shot-select").selectOption(approvedShotId);
  await page.locator(".approval-generate").click();
  await page.locator(".approval-frames").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-frames > div:nth-child(2)").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-confirm").click();
  await page.locator(".approval-status.is-valid").waitFor({ timeout: 10_000 });

  // 修改被确认的镜头（按 shotId 从导出项目对齐，避免卡片序耦合）→ 失效。
  const approvedIndex = await page.evaluate((id) => {
    const cards = [...document.querySelectorAll(".shot-card")];
    return cards.findIndex((card) =>
      card.textContent?.includes(id.slice(0, 8)),
    );
  }, approvedShotId);
  const card = page
    .locator(".shot-card")
    .nth(approvedIndex >= 0 ? approvedIndex : 1);
  await card.locator(".shot-edit-toggle").click();
  await card.locator(".composition-title-input").fill("改过的总览标题");
  await card.locator(".shot-apply").click();
  await page
    .getByText("已修订", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.locator(".approval-status.is-stale").waitFor({ timeout: 10_000 });

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
  await page.locator(".approval-status.is-valid").waitFor({ timeout: 10_000 });
  await page.locator(".editor-render").click();
  await page
    .locator(".editor-downloads a")
    .first()
    .waitFor({ timeout: 300_000 });
  assert.equal(await page.locator(".editor-downloads a").count(), 2);

  // 派生前导出快照：旧版本引用的项目稍后在 CLI 侧重渲（Review Focus 3）。
  const [preDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  preDerivePath = path.join(out, "pre-derive.video-project.json");
  await preDownload.saveAs(preDerivePath);
  const preDerive = JSON.parse(readFileSync(preDerivePath, "utf8"));

  // 派生新版本：填派生说明并保存 → 风格版本变化 → 确认再次失效。
  await page.locator(".derive-note-input").fill("W2 e2e 派生：换强调色");
  await page.locator(".bible-derive").click();
  await page
    .getByText("派生自已选版本", { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await page.locator(".approval-status.is-stale").waitFor({ timeout: 10_000 });

  // 再确认后保存，刷新重开：确认随项目持久化且状态准确。
  await page.locator(".approval-generate").click();
  await page.locator(".approval-frames").waitFor({
    timeout: 10_000,
  });
  await page.locator(".approval-confirm").click();
  await page.locator(".approval-status.is-valid").waitFor({ timeout: 10_000 });
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
  // F7：派生真实落地——版本与摘要都换新，且与派生前快照不同。
  assert.notEqual(
    exported.styleBibleRef.versionId,
    preDerive.styleBibleRef.versionId,
    "派生后项目须引用新风格版本",
  );
  assert.notEqual(
    exported.styleBibleRef.digest,
    preDerive.styleBibleRef.digest,
    "派生版本摘要必须变化",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  await page.locator(".approval-status.is-valid").waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(out, "reopened-approved.png") });

  // 导出风格规范（派生后版本表含全部历史版本，可解析派生前引用）。
  const [bibleDownload] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "导出风格规范 JSON" })
      .first()
      .click(),
  ]);
  biblePath = path.join(out, "workbench.style-bible.json");
  await bibleDownload.saveAs(biblePath);

  writeFileSync(
    path.join(out, "chain-summary.json"),
    `${JSON.stringify({ pass: true, errors }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
// F4：派生前导出的旧引用项目用当前代码真实重渲（Review Focus 3 的 CLI 半），
// 旧版本不被派生破坏。渲染到忽略目录，不动浏览器证据。
{
  const { spawnSync } = await import("node:child_process");
  const rerender = spawnSync(
    process.execPath,
    [
      "scripts/video/render-scene.mjs",
      "--project",
      preDerivePath,
      "--style-bible",
      biblePath,
      "--out",
      path.join(out, "pre-derive-rerender"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    rerender.status,
    0,
    `旧引用项目重渲失败：${rerender.stderr?.slice(-400) ?? ""}`,
  );
}
console.log(`frame-approval e2e: PASS → ${out}`);
