#!/usr/bin/env node
// W4 验收：自包含交互页离线（file://）打开 → 拖转与双击拆解状态变化 →
// iframe 嵌入 → 帧率采样 → 重建逐字节一致（可编辑/可复现）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-w4-2026-10-24");
const page1 = path.join(out, "interactive", "index.html");
const buildPage = () =>
  execFileSync(process.execPath, ["scripts/video/w4-interactive-build.mjs"], {
    cwd: root,
    stdio: "pipe",
  });
// Build from current source before capturing the baseline. A checked-in page
// from an older runtime must not cause a false determinism failure.
buildPage();
const htmlBefore = readFileSync(page1);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });

  // 离线打开（file://，无任何网络依赖）。
  await page.goto(pathToFileURL(page1).href, { waitUntil: "load" });
  const stage = page.locator("#stage");
  await stage.waitFor({ timeout: 15_000 });
  assert.equal(await stage.getAttribute("data-exploded"), "false");

  // 交互一：双击拆解 → 状态变化（DOM 状态 + 画面状态）。
  await stage.dblclick();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  await page.screenshot({ path: path.join(out, "exploded.png") });
  await stage.dblclick();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "false",
    { timeout: 5_000 },
  );

  // 交互二：拖拽转动 → rotated 标记 + 帧仍在跑（渲染存活）。
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.rotated === "true",
    { timeout: 5_000 },
  );

  // 帧率采样：1 秒内 rAF 帧数（无头 SwiftShader，阈值放宽到 ≥15）。
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
          else resolve(frames);
        };
        requestAnimationFrame(tick);
      }),
  );
  assert.ok(fps >= 15, `帧率过低：${fps} fps`);

  // iframe 嵌入：宿主页嵌入自包含页，交互仍可用。
  const host = path.join(out, "iframe-host.html");
  writeFileSync(
    host,
    `<!doctype html><meta charset="utf-8"><iframe src="interactive/index.html" style="width:800px;height:500px" id="embed"></iframe>`,
  );
  await page.goto(pathToFileURL(host).href, { waitUntil: "load" });
  const frame = page.frame({ url: /index\.html/ });
  assert.ok(frame, "iframe 内页面须可加载");
  await frame.locator("#stage").waitFor({ timeout: 10_000 });
  await frame.locator("#stage").dblclick();
  await frame.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  await page.screenshot({ path: path.join(out, "iframe-embedded.png") });
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);

// 保存重开续编 = 源可复现：重建一次，产物逐字节一致。
buildPage();
const htmlAfter = readFileSync(page1);
assert.equal(
  sha(htmlAfter),
  sha(htmlBefore),
  "同源重建必须逐字节一致（可编辑性的复现口径）",
);
writeFileSync(
  path.join(out, "w4-report.json"),
  `${JSON.stringify(
    {
      pass: true,
      bytes: htmlBefore.length,
      fpsMin: 15,
      errors,
      rebuildDeterministic: true,
    },
    null,
    2,
  )}\n`,
);
console.log(`W4 interactive e2e: PASS → ${out}`);
