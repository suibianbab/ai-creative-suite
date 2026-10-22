#!/usr/bin/env node
// 布局探针：量 .piece-stage / .preview-canvas / .safe-guide 的真实盒尺寸。
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const OUT = fileURLToPath(new URL(".", import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").nth(1).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });
  const piece = page.locator(".piece-preview");
  await piece.scrollIntoViewIfNeeded();
  await piece.locator(".preview-toggle").click();
  await piece.getByRole("button", { name: "竖版" }).click();
  await piece.locator(".safe-guide-toggle input").check();
  await page.waitForTimeout(300);
  const dump = await piece.evaluate((root) => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        w: Math.round(b.width),
        h: Math.round(b.height),
        display: getComputedStyle(el).display,
        aspect: getComputedStyle(el).aspectRatio,
        maxWidth: getComputedStyle(el).maxWidth,
        style: el.getAttribute("style"),
      };
    };
    return {
      box: r(root),
      stage: r(root.querySelector(".piece-stage")),
      canvas: r(root.querySelector(".preview-canvas")),
      guide: r(root.querySelector(".safe-guide")),
    };
  });
  console.log(JSON.stringify(dump, null, 2));
  await page.screenshot({ path: OUT + "probe-full.png" });
} finally {
  await browser.close();
}
