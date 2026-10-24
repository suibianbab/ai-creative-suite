#!/usr/bin/env node
// W2 风格代表帧确认闭环：选择镜头/时间 → 真实渲染器横竖关键帧 → 显式确认 →
// 修改使确认失效（出片被 400 拒绝）→ 再确认 → 双画幅 MP4 导出 → 刷新重开状态仍准确。
// 前置：web dev server 在 BASE_URL。产物留 .tools/video-style-frame-confirm。不计费。
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, ".tools/video-style-frame-confirm");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("console", (event) => {
  if (event.type() === "error") errors.push(event.text());
});

async function exportProject(name) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const file = path.join(OUT, `${name}.video-project.json`);
  await download.saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function generateAndConfirm(frameMs, note) {
  const panel = page.locator(".style-frame-panel");
  await panel.locator(".style-frame-ms").fill(String(frameMs));
  await panel.locator(".style-frame-generate").click();
  await panel
    .locator(".style-frame-img-landscape")
    .waitFor({ timeout: 240_000 });
  await panel.locator(".style-frame-img-portrait").waitFor({ timeout: 30_000 });
  if (note) await panel.locator(".style-frame-note").fill(note);
  await panel.locator(".style-frame-confirm").click();
  await page
    .locator(".editor-message", { hasText: "风格代表帧已确认" })
    .waitFor({ timeout: 20_000 });
}

async function statusText() {
  return page.locator(".style-frame-status").textContent();
}

try {
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-create").click();
  await page
    .locator("#planner-sentence")
    .fill("做一个8秒的STEM解说视频，主题是水循环，分4个镜头");
  await page.locator(".planner-run").click();
  await page.locator(".storyboard-card").waitFor();
  await page.locator(".plan-apply").click();
  assert.equal(await page.locator(".shot-card").count(), 4);

  const biblePanel = page.locator(".style-bible-panel");
  await biblePanel.getByRole("button", { name: "创建并应用风格规范" }).click();
  await page
    .locator(".editor-message", { hasText: "Style Bible 已创建并应用" })
    .waitFor();

  const panel = page.locator(".style-frame-panel");
  assert.match(await statusText(), /尚无风格代表帧确认/);

  // 错误路径：越界时间让生成按钮禁用
  await panel.locator(".style-frame-ms").fill("99999");
  assert.equal(await panel.locator(".style-frame-generate").isDisabled(), true);

  // 选择 → 生成（真实渲染器）→ 确认
  await generateAndConfirm(500, "首镜中段代表帧");
  assert.match(await statusText(), /有效：已确认第 13 帧/);
  const first = await exportProject("confirmed-first");
  assert.equal(first.styleFrameConfirmations.length, 1);
  const record = first.styleFrameConfirmations[0];
  assert.equal(record.actor, "human");
  assert.equal(record.frameMs, 500);
  assert.equal(record.frameIndex, 12);
  assert.equal(record.keyframes.length, 2);
  for (const frame of record.keyframes)
    assert.match(frame.digest, /^[0-9a-f]{64}$/);
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });
  await page.screenshot({
    path: path.join(OUT, "confirmed-first.png"),
    fullPage: true,
  });

  // 修改：单镜标题修订 → 确认失效；出片被门禁拒绝
  const card = page.locator(".shot-card").first();
  await card.locator(".shot-edit-toggle").click();
  await card.locator(".shot-title-input").fill("确认失效用的修改");
  await card.locator(".shot-apply").click();
  await page.locator(".editor-message", { hasText: "镜头 1 已修订" }).waitFor();
  assert.match(await statusText(), /未生效：/);
  const invalidated = await exportProject("invalidated");
  assert.equal(invalidated.styleFrameConfirmations.length, 1);
  // 带上真实风格 JSON：否则 400 会先落在 Bible 校验而不是确认门禁
  const [bibleDownload] = await Promise.all([
    page.waitForEvent("download"),
    biblePanel.getByRole("button", { name: "导出风格规范 JSON" }).click(),
  ]);
  const bibleFile = path.join(OUT, "style-bible.json");
  await bibleDownload.saveAs(bibleFile);
  const exportedBible = JSON.parse(readFileSync(bibleFile, "utf8"));
  const blocked = await context.request.post(`${BASE_URL}/api/video/render`, {
    headers: { Origin: BASE_URL, Host: new URL(BASE_URL).host },
    data: { project: invalidated, styleBible: exportedBible },
  });
  assert.equal(blocked.status(), 400);
  assert.match((await blocked.json()).error, /确认/);
  await page.screenshot({
    path: path.join(OUT, "invalidated.png"),
    fullPage: true,
  });

  // 再确认 → 保存 → 双画幅出片（真实 MP4）
  await generateAndConfirm(600, "修订后再确认");
  assert.match(await statusText(), /有效/);
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });

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
    const file = path.join(OUT, `final-${download.aspect}.mp4`);
    const body = Buffer.from(await result.body());
    writeFileSync(file, body);
    outputs.push({ ...download, bytes: body.length, file });
  }

  // 派生风格：旧确认因风格版本变化失效（不出片，仅状态断言）
  await biblePanel.locator('input[type="color"]').first().fill("#26344a");
  await biblePanel.locator(".style-bible-change-note").fill("加深背景");
  await biblePanel
    .getByRole("button", { name: "将当前颜色保存为新版本并应用" })
    .click();
  await page.locator(".editor-message", { hasText: "派生" }).waitFor();
  assert.match(await statusText(), /风格版本已变更/);
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });

  // 刷新重开：派生后的失效状态依旧准确（保存、刷新后不失真）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".style-frame-panel").waitFor();
  assert.match(await statusText(), /风格版本已变更/);
  const final = await exportProject("final");
  assert.equal(final.styleFrameConfirmations.length, 2);
  assert.notEqual(final.styleBibleRef.versionId, first.styleBibleRef.versionId);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    `[e2e-style-frame-confirm] PASS project=${first.id} confirmations=2 renders=${outputs.length} consoleErrors=0`,
  );
} finally {
  await browser.close();
}
