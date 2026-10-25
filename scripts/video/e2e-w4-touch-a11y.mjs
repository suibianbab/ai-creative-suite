#!/usr/bin/env node
// C3 验收：W4 自包含交互页的触屏模拟（CDP 触摸事件驱动拖转/双击/取消）、
// 键盘可达性与状态播报，以及按渲染器分口径的性能测量（无头软件渲染 vs
// 有头桌面 GPU；真机触屏未测，如实记录）。约束不放宽：自包含、离线
// file://、≤8MiB、不为测量引入网络加载。
import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pagePath = path.join(
  root,
  "artifacts/video-studio-w4-2026-10-24/interactive/index.html",
);
const outDir = path.join(root, "artifacts/video-studio-w4-2026-10-24");
const errors = [];
const report = {
  pass: false,
  constraints: {
    selfContained: true,
    offline: true,
    maxBytes: 8 * 1024 * 1024,
  },
  bytes: statSync(pagePath).size,
  touch: {},
  a11y: {},
  perf: { headless: {}, headedGpu: {}, realDevice: "真机触屏未测（无设备）" },
};

// —— 触屏模拟：hasTouch 上下文 + CDP Input.dispatchTouchEvent（走真实触摸管线）——
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
  const t0 = Date.now();
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
  const loadMs = Date.now() - t0;
  const stage = page.locator("#stage");
  await stage.waitFor({ timeout: 15_000 });
  report.perf.headless.loadMs = loadMs;

  // 可达性基线：可聚焦、有可读名称、有状态播报区。
  assert.equal(await stage.getAttribute("tabindex"), "0");
  assert.ok((await stage.getAttribute("aria-label"))?.includes("转动"));
  assert.equal(await stage.getAttribute("role"), "group");
  const status = page.locator(".w4-status");
  await status.waitFor({ timeout: 5_000 });
  assert.equal(await status.getAttribute("aria-live"), "polite");
  report.a11y = {
    focusable: true,
    label: await stage.getAttribute("aria-label"),
    liveRegion: "polite",
  };

  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);

  // 触摸拖转：touchStart → 多步 touchMove → touchEnd。
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cx + step * 12, y: cy + step * 3, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.rotated === "true",
    { timeout: 5_000 },
  );
  const spinsAfterDrag = await page.evaluate(() => window.app.state.spins);
  assert.ok(
    spinsAfterDrag > 0,
    `拖转后 spins 必须累计（修复前恒为 0）：${spinsAfterDrag}`,
  );
  report.touch.dragRotate = { rotated: true, spins: spinsAfterDrag };
  await page.screenshot({ path: path.join(outDir, "touch-drag.png") });

  // 第二指不得劫持拖转：finger 1 按住（旋转冻结、无自动旋转），finger 2
  // 落别处并移动 → 旋转保持不变。
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await page.waitForFunction(() => window.app.state.dragging === true);
  const beforeSecond = await page.evaluate(() => window.app.state.rotationY);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx - 120, y: cy + 80, id: 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: cx - 120, y: cy + 40, id: 2 }],
  });
  const afterSecond = await page.evaluate(() => window.app.state.rotationY);
  assert.equal(
    afterSecond,
    beforeSecond,
    "第二指的移动不得改变主体旋转（pointerId 追踪）",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  report.touch.multiTouchIgnored = true;

  // 双指点按（双击拆解的触摸路径）→ exploded 翻转 + 播报更新。
  // 换位置并留出双击窗口：上一手势的按下点不得参与本次配对。
  await page.waitForTimeout(400);
  const tapX = cx + 80;
  const tapY = cy - 60;
  for (const tap of [1, 2]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: tapX + (tap - 1) * 2, y: tapY, id: 3 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  const announced = await status.textContent();
  assert.ok(announced.includes("拆解"), `播报须含状态：${announced}`);
  report.touch.doubleTapExplode = { exploded: true, announced };
  await page.screenshot({ path: path.join(outDir, "touch-exploded.png") });

  // Codex 复核 Important#5 回归：拖动后的快速单击不得被当作双击拆解。
  // 复现口径：按下 → 拖 20px → 松开 → 350ms 内 40px 半径内单击 → 状态不变。
  await page.waitForTimeout(400); // 脱离上一双击窗口，从合拢态开始验证
  if ((await stage.getAttribute("data-exploded")) !== "true") {
    await stage.dblclick(); // 保证起点为已拆解，末态仍应保持（翻转一次）
  }
  const dragBox = await stage.boundingBox();
  const sx = dragBox.x + dragBox.width / 2;
  const sy = dragBox.y + dragBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 20, sy, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(sx + 15, sy + 5); // 拖动终点附近快速单击
  await page.waitForTimeout(500); // 超过双击窗口再断言，防时序误判
  assert.equal(
    await stage.getAttribute("data-exploded"),
    "true",
    "拖动后的单击不得触发拆解切换（双击候选须按会话位移作废）",
  );
  report.touch.dragThenClickNoToggle = true;

  // 触摸取消（滚动手势接管）：拖转必须结束且自动旋转恢复。
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx, y: cy, id: 4 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: cx + 30, y: cy + 10, id: 4 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  const sampleAutoRotate = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const app = window.app;
        const first = app.state.rotationY;
        setTimeout(() => resolve({ first, later: app.state.rotationY }), 450);
      }),
  );
  assert.ok(
    sampleAutoRotate.later > sampleAutoRotate.first,
    `touchCancel 后自动旋转须恢复：${JSON.stringify(sampleAutoRotate)}`,
  );
  report.touch.cancelResumesAutoRotate = true;

  // 键盘：聚焦后方向键转动、回车拆解/合拢，播报与可视状态同步。
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.rotated === "true",
    { timeout: 5_000 },
  );
  const keyboardRotated = await page.evaluate(() => window.app.state.rotationY);
  assert.ok(keyboardRotated > 0, "方向键须转动主体");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "false",
    { timeout: 5_000 },
  );
  assert.ok((await status.textContent()).includes("合拢"));
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => document.getElementById("stage").dataset.exploded === "true",
    { timeout: 5_000 },
  );
  report.a11y.keyboard = { arrowsRotate: true, enterSpaceToggle: true };

  // 无头帧率（SwiftShader 软件渲染口径）。
  const headlessFps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 2000) requestAnimationFrame(tick);
          else resolve(frames / 2);
        };
        requestAnimationFrame(tick);
      }),
  );
  const glRenderer = await page.evaluate(() => {
    const canvas = document.querySelector("#stage canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  });
  report.perf.headless = {
    ...report.perf.headless,
    fps: headlessFps,
    glRenderer,
  };
  assert.ok(report.bytes <= report.constraints.maxBytes, "8 MiB 红线");
} finally {
  await browser.close();
}

// —— 桌面 GPU 口径：有头浏览器（本机 RTX 4060 / ANGLE d3d11），短时采样 ——
try {
  const gpuBrowser = await chromium.launch({
    headless: false,
    args: ["--use-angle=d3d11", "--enable-features=VaapiVideoDecoder"],
  });
  try {
    const context = await gpuBrowser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`gpu: ${error.message}`));
    const t0 = Date.now();
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });
    await page.locator("#stage").waitFor({ timeout: 15_000 });
    const gpuLoadMs = Date.now() - t0;
    const gpuFps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames += 1;
            if (performance.now() - start < 2000) requestAnimationFrame(tick);
            else resolve(frames / 2);
          };
          requestAnimationFrame(tick);
        }),
    );
    const gpuRenderer = await page.evaluate(() => {
      const canvas = document.querySelector("#stage canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
    });
    report.perf.headedGpu = {
      loadMs: gpuLoadMs,
      fps: gpuFps,
      glRenderer: gpuRenderer,
    };
    await page.screenshot({ path: path.join(outDir, "headed-gpu.png") });
  } finally {
    await gpuBrowser.close();
  }
} catch (error) {
  report.perf.headedGpu.unavailable = String(error);
}

assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);
report.pass = true;
writeFileSync(
  path.join(outDir, "c3-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`W4 touch/a11y/perf e2e: PASS → ${outDir}/c3-report.json`);
console.log(JSON.stringify(report.perf, null, 2));
