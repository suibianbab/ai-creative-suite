#!/usr/bin/env node
// Render one representative frame through the exact Three bake harness used
// for MP4 output. Reads a bounded JSON request on stdin and writes PNG bytes
// on stdout; diagnostics go only to stderr.
import { chromium } from "playwright-core";
import { createThreeServer } from "./bake-three.mjs";
import { validateThreeSpec } from "./three/spec.mjs";

const DIMENSIONS = { landscape: [1280, 720], portrait: [720, 1280] };
const MAX_INPUT = 300_000;
let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > MAX_INPUT) throw new Error("3D 预览请求过大");
}
const request = JSON.parse(raw);
const dimension = DIMENSIONS[request.aspect];
if (!dimension) throw new Error("3D 预览画幅无效");
if (
  !Number.isInteger(request.frameIndex) ||
  request.frameIndex < 0 ||
  request.frameIndex > 2400
)
  throw new Error("3D 预览帧号无效");
const spec = validateThreeSpec(request.spec);
const [width, height] = dimension;
const { server, url } = await createThreeServer();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--disable-gpu-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(
    (config) => {
      window.__THREE_SCENE_CONFIG__ = config;
    },
    {
      componentId: spec.componentId,
      componentVersion: spec.componentVersion,
      width,
      height,
      background: spec.background,
      seed: spec.seed,
      params: spec.params,
      fps: 24,
      durationMs: spec.durationMs,
    },
  );
  await page.goto(url, { waitUntil: "load", timeout: 20_000 });
  await page.waitForFunction(
    () => Boolean(window.bakeInfo?.ready || window.bakeError),
    null,
    { timeout: 20_000 },
  );
  const result = await page.evaluate(
    (frameIndex) => ({
      error: window.bakeError ?? null,
      png: window.bakeError ? null : window.bakeFrame(frameIndex),
    }),
    request.frameIndex,
  );
  if (result.error) throw new Error(result.error);
  if (
    typeof result.png !== "string" ||
    !result.png.startsWith("data:image/png;base64,")
  )
    throw new Error("3D 烘焙器未返回 PNG");
  process.stdout.write(
    Buffer.from(result.png.slice("data:image/png;base64,".length), "base64"),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
