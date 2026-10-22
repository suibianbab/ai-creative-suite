#!/usr/bin/env node
// 双画幅预览冒烟（Task 2 Step 6）：真实浏览器里切换横竖版、开关安全区辅助线，
// 断言预览画布 viewBox 与出片坐标一致，并落 4+1 张截图供人工核查。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });

  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });

  // 数据样片（stem / data / product 中的第 2 张）：4 个 spec 镜头。
  await page.locator(".sample-card").nth(1).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });

  const piece = page.locator(".piece-preview");
  await piece.scrollIntoViewIfNeeded();
  await piece.locator(".preview-toggle").click(); // 暂停在当前帧，画面稳定
  // 元素截图（画布 + 控制行），不依赖视口滚动位置。
  const shootPiece = (name) =>
    piece.screenshot({ path: path.join(OUT, name) });

  // 横版默认：画布坐标 = 出片 1280×720。
  assert.equal(
    await piece.locator(".preview-canvas").first().getAttribute("viewBox"),
    "0 0 1280 720",
  );
  await shootPiece("smoke-piece-landscape.png");

  // 切竖版：画布坐标 = 出片 720×1280（显示尺寸由 CSS 限高）。
  await piece.getByRole("button", { name: "竖版" }).click();
  await page.waitForFunction(() => {
    const svg = document.querySelector(".piece-preview .preview-canvas");
    return svg?.getAttribute("viewBox") === "0 0 720 1280";
  });
  await shootPiece("smoke-piece-portrait.png");

  // 安全区辅助线：仅预览 DOM，10% 内缩。
  await piece.locator(".safe-guide-toggle input").check();
  const guide = piece.locator(".safe-guide");
  await guide.waitFor({ state: "visible" });
  assert.equal(await guide.getAttribute("aria-hidden"), "true");
  await shootPiece("smoke-piece-portrait-safe.png");

  // 回横版 + 关辅助线：viewBox 复原、辅助线消失。
  await piece.locator(".safe-guide-toggle input").uncheck();
  await piece.getByRole("button", { name: "横版" }).click();
  await page.waitForFunction(() => {
    const svg = document.querySelector(".piece-preview .preview-canvas");
    return svg?.getAttribute("viewBox") === "0 0 1280 720";
  });
  assert.equal(await guide.count(), 0);

  // 单镜预览（规划卡内的 ScenePreview）：同一切换能力。
  // 句子须符合规划器语法：做一个<秒>秒的<文字|线描|图形>动画，标题是<文本>。
  await page
    .locator(".planner-input")
    .fill("做一个6秒的文字动画，标题是双画幅预览冒烟检查标题");
  await page.locator(".planner-run").click();
  const single = page.locator(".plan-card .preview-box");
  await single.waitFor({ timeout: 30_000 });
  await single.scrollIntoViewIfNeeded();
  assert.equal(
    await single.locator(".preview-canvas").getAttribute("viewBox"),
    "0 0 1280 720",
  );
  await single.getByRole("button", { name: "竖版" }).click();
  await single
    .getByRole("button", { name: "暂停" })
    .click()
    .catch(() => {});
  await page.waitForFunction(() => {
    const svg = document.querySelector(".plan-card .preview-canvas");
    return svg?.getAttribute("viewBox") === "0 0 720 1280";
  });
  await single.screenshot({
    path: path.join(OUT, "smoke-single-portrait.png"),
  });

  assert.deepEqual(errors, []);
  console.log("SMOKE PASS: 5 screenshots in", OUT);
} finally {
  await browser.close();
}
