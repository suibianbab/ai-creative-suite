#!/usr/bin/env node
// T3：从真实项目的 three 镜头导出自包含交互页。复用 W4 构建链（esbuild
// IIFE + three 内联）与 C3 交互运行时（app.js），输入来自项目当前工作版本
// 的 spec 参数（shape/color/accent/tilt/spinPerFrame），非写死演示数据。
// 产物 ≤8MiB、file:// 可开、SHA-256 入账；失败不留成功记录。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    project: { type: "string" },
    shot: { type: "string" },
    out: { type: "string" },
  },
  strict: true,
});
if (!values.project || !values.out) {
  console.error(
    "用法：t3-export-interactive.mjs --project <json> [--shot <1-based>] --out <dir>",
  );
  process.exit(1);
}

const { validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { threeRegistry } = await import(
  pathToFileURL(path.join(root, "scripts/video/three/registry.mjs")).href
);
const project = validateVideoProject(
  JSON.parse(readFileSync(values.project, "utf8")),
);

// 找 three 镜头：--shot 指定（1-based）或第一个 three 镜头。
const threeShots = project.shots.filter((shot) => {
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  return working?.sceneSource.type === "three";
});
if (threeShots.length === 0) {
  console.error("项目中没有 three 镜头（sceneSource.type === 'three'）");
  process.exit(1);
}
const shotIndex = values.shot
  ? project.shots.findIndex((s) => s === threeShots[Number(values.shot) - 1])
  : project.shots.indexOf(threeShots[0]);
const shot = project.shots[shotIndex];
const working = shot.contentVersions.find(
  (version) => version.versionId === shot.workingVersionId,
);
const spec = working.sceneSource.spec;

// 封闭注册表校验：只接受已注册组件（不接受任意代码）。
const component = threeRegistry.get(spec.componentId, spec.componentVersion);
const params = component.validateParams(spec.params);

// esbuild 打包（与 W4 同链）。
const out = path.resolve(values.out);
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
    `--outfile=${bundlePath}`,
  ],
  { cwd: root, stdio: "pipe" },
);
const bundle = readFileSync(bundlePath, "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 · ${project.title} · 镜头 ${shotIndex + 1} 交互预览</title>
<style>
  body { margin: 0; background: ${spec.background}; color: #eef3f8; font-family: sans-serif; }
  #stage { width: 100vw; height: 88vh; touch-action: none; cursor: grab; }
  #hint { padding: 12px 16px; font-size: 14px; color: #9fb2c4; }
  #state { color: ${params.accent}; font-weight: 700; }
  .w4-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
<div id="stage" data-exploded="false" data-rotated="false" tabindex="0" role="group" aria-label="拖转 ${params.shape} 主体，双击或回车拆解"></div>
<p id="hint">拖拽转动主体；双击/回车切换 <span id="state">合拢</span>/拆解。源项目：${project.title}（镜头 ${shotIndex + 1}，${spec.componentId}@${spec.componentVersion}）。</p>
<script>${bundle}</script>
<script>
  const app = W4App.createApp(document.getElementById("stage"), {
    background: "${spec.background}",
    color: "${params.color}",
    accent: "${params.accent}",
    shape: "${params.shape}",
    tilt: ${params.tilt},
    spinPerFrame: ${params.spinPerFrame},
  });
  const stateLabel = document.getElementById("state");
  document.getElementById("stage").addEventListener("w4:state", () => {
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
writeFileSync(
  path.join(out, "asset-manifest.json"),
  `${JSON.stringify(
    {
      deliverable: htmlPath,
      bytes,
      maxBytes: MAX,
      source: {
        projectId: project.id,
        shotIndex: shotIndex + 1,
        componentId: spec.componentId,
        componentVersion: spec.componentVersion,
        params,
        background: spec.background,
      },
      files: [
        {
          path: "index.html",
          bytes,
          sha256: sha256(htmlPath),
          source: "scripts/video/w4-interactive/app.js + 本构建脚本",
          license: "three.js MIT（内联运行时）；页面与几何全部程序化自有",
        },
      ],
      runtime: "three@0.186.1 (MIT) 经 esbuild@0.28.1 IIFE 内联",
      rebuild: `node scripts/video/t3-export-interactive.mjs --project ${values.project} --out ${values.out}`,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `T3 interactive export → ${htmlPath}（${bytes} B / 8 MiB，${spec.componentId}@${spec.componentVersion} ${params.shape}）`,
);
