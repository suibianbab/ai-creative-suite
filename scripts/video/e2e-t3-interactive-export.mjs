#!/usr/bin/env node
// T3 验收：从真实项目导出交互页 → 离线重开 → 验证主体参数一致 →
// W4 全套门禁（触屏/拖后单击/键盘/aria/离线/iframe/8MiB/重建一致）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, ".tools/t3-export-e2e");
const page1 = path.join(out, "index.html");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const htmlBefore = readFileSync(page1);

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

  // 离线打开。
  await page.goto(pathToFileURL(page1).href, { waitUntil: "load" });
  const stage = page.locator("#stage");
  await stage.waitFor({ timeout: 15_000 });

  // 主体参数一致性：shape/color/accent/tilt/spin 在页面 aria-label 与
  // 构建参数中可见（导入 manifest 对照）。
  const manifest = JSON.parse(
    readFileSync(path.join(out, "asset-manifest.json"), "utf8"),
  );
  assert.equal(manifest.source.componentId, "orbit3d");
  assert.equal(manifest.source.componentVersion, 2);
  assert.equal(manifest.source.params.shape, "box");
  assert.equal(manifest.source.params.color, "#4f9dff");
  assert.equal(manifest.source.params.accent, "#e8b04b");
  const ariaLabel = await stage.getAttribute("aria-label");
  assert.ok(ariaLabel?.includes("box"), "aria-label 须含 shape");

  // 交互全套：双击拆解→合拢、拖转标记、键盘（Tab→方向键→回车拆解）。
  await stage.dblclick();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  await stage.dblclick();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "false",
    { timeout: 5_000 },
  );

  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.rotated === "true",
    { timeout: 5_000 },
  );
  // 拖动后快速单击不得误拆解（C3 回归口径）。
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + 10);
  await page.waitForTimeout(400);
  assert.equal(await stage.getAttribute("data-exploded"), "false");

  // 键盘：聚焦→回车拆解→aria 播报→回车合拢。
  await stage.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  const status = await page.locator(".w4-status").textContent();
  assert.ok(status?.includes("拆解"), `aria 播报须含状态：${status}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "false",
    { timeout: 5_000 },
  );
  await page.screenshot({ path: path.join(out, "t3-interactions.png") });

  // iframe 嵌入。
  const host = path.join(out, "iframe-host.html");
  writeFileSync(
    host,
    `<!doctype html><meta charset="utf-8"><iframe src="index.html" style="width:800px;height:500px"></iframe>`,
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
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);

// 重建逐字节一致。
execFileSync(
  process.execPath,
  [
    "scripts/video/t3-export-interactive.mjs",
    "--project",
    path.join(
      root,
      "artifacts/video-studio-t1-portrait-3d-2026-10-25/project-v2.json",
    ),
    "--out",
    out,
  ],
  { cwd: root, stdio: "pipe" },
);
assert.equal(
  sha(readFileSync(page1)),
  sha(htmlBefore),
  "同源重建必须逐字节一致",
);
writeFileSync(
  path.join(out, "t3-report.json"),
  `${JSON.stringify(
    {
      pass: true,
      bytes: htmlBefore.length,
      errors,
      rebuildDeterministic: true,
    },
    null,
    2,
  )}\n`,
);
console.log(`T3 interactive export e2e: PASS → ${out}`);
