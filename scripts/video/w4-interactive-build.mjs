#!/usr/bin/env node
// W4 交付：一主体一交互的自包含 Web 3D 样片。esbuild 打包 three 运行时为
// 单 IIFE → 内联进 index.html（自包含 ≤8MiB 红线不放宽）；产出资产清单
// （路径/摘要/来源/许可/体积）。可编辑性 = 源 app.js + 构建参数入档，
// 重建逐字节一致（interactive determinism 检查在 w4 e2e）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-w4-2026-10-24/interactive");
mkdirSync(out, { recursive: true });
const esbuild = path.join(
  root,
  "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild",
);
const entry = path.join(root, "scripts/video/w4-interactive/app.js");
const bundlePath = path.join(out, "app.bundle.js");
execFileSync(
  process.execPath,
  [
    esbuild,
    entry,
    "--bundle",
    "--format=iife",
    "--global-name=W4App",
    "--minify",
    "--outfile=" + bundlePath,
  ],
  { cwd: root, stdio: "inherit" },
);
const bundle = readFileSync(bundlePath, "utf8");
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>W4 · 演示立方体 · 拖转与拆解</title>
<style>
  body { margin: 0; background: #101820; color: #eef3f8; font-family: sans-serif; }
  #stage { width: 100vw; height: 88vh; touch-action: none; cursor: grab; }
  #hint { padding: 12px 16px; font-size: 14px; color: #9fb2c4; }
  #state { color: #e8b04b; font-weight: 700; }
</style>
</head>
<body>
<div id="stage" data-exploded="false" data-rotated="false"></div>
<p id="hint">拖拽转动主体；双击切换 <span id="state">合拢</span>/拆解状态。</p>
<script>${bundle}</script>
<script>
  const app = W4App.createApp(document.getElementById("stage"));
  const stateLabel = document.getElementById("state");
  document.getElementById("stage").addEventListener("dblclick", () => {
    stateLabel.textContent = app.state.exploded ? "拆解" : "合拢";
  });
</script>
</body>
</html>
`;
const htmlPath = path.join(out, "index.html");
writeFileSync(htmlPath, html);
const bytes = Buffer.byteLength(html);
const MAX = 8 * 1024 * 1024;
if (bytes > MAX) throw new Error(`自包含页超限：${bytes} > ${MAX}`);
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const manifest = {
  deliverable: htmlPath,
  bytes,
  maxBytes: MAX,
  files: [
    {
      path: "index.html",
      bytes,
      sha256: sha256(htmlPath),
      source: "scripts/video/w4-interactive/app.js + 本构建脚本模板",
      license: "three.js MIT（内联运行时）；页面与几何全部程序化自有",
    },
  ],
  runtime: "three@0.186.1 (MIT) 经 esbuild@0.28.1 IIFE 内联",
  rebuild: "node scripts/video/w4-interactive-build.mjs",
};
writeFileSync(
  path.join(out, "asset-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify({ bytes, ofMax: MAX }));
