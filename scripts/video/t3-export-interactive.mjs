#!/usr/bin/env node
// T3：从真实项目的 three 镜头导出自包含交互页。复用 W4 构建链（esbuild
// IIFE + three 内联）与 C3 交互运行时（app.js），输入来自项目当前工作版本
// 的 spec 参数（shape/color/accent/tilt/spinPerFrame/zoom），非写死演示数据。
// 产物 ≤8MiB、file:// 可开、SHA-256 入账；内存中先检体积再原子写，失败不留
// 半成品（Codex 复核 P1-3/P2-2/P2-3 修复）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    "用法：t3-export-interactive.mjs --project <json> [--shot <项目镜头序号 1-based>] --out <dir>",
  );
  process.exit(1);
}

// HTML 上下文转义（Codex 复核 P1-3：项目标题含 </title><script> 时注入）。
const escapeHtml = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
// 脚本参数用 JSON 序列化（不再字符串拼接，防引号/闭合注入）。
const jsonArg = (value) => JSON.stringify(value);

const { validateVideoProject } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const { threeRegistry } = await import(
  pathToFileURL(path.join(root, "scripts/video/three/registry.mjs")).href
);
const project = validateVideoProject(
  JSON.parse(readFileSync(values.project, "utf8")),
);

// 找 three 镜头：--shot 是项目级 1-based 序号（Codex 复核 P2-3：先按序号
// 定位再检查类型，而非先过滤再在子集里数序号）。
let shotIndex;
if (values.shot) {
  const n = Number(values.shot);
  if (!Number.isInteger(n) || n < 1 || n > project.shots.length) {
    console.error(
      `--shot 须为 1..${project.shots.length} 的整数（项目镜头序号）`,
    );
    process.exit(1);
  }
  shotIndex = n - 1;
  const working = project.shots[shotIndex].contentVersions.find(
    (v) => v.versionId === project.shots[shotIndex].workingVersionId,
  );
  if (working?.sceneSource.type !== "three") {
    console.error(
      `镜头 ${n} 不是 three 镜头（实际类型：${working?.sceneSource.type ?? "unknown"}）`,
    );
    process.exit(1);
  }
} else {
  shotIndex = project.shots.findIndex((shot) => {
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    return working?.sceneSource.type === "three";
  });
  if (shotIndex < 0) {
    console.error("项目中没有 three 镜头（sceneSource.type === 'three'）");
    process.exit(1);
  }
}
const shot = project.shots[shotIndex];
const working = shot.contentVersions.find(
  (version) => version.versionId === shot.workingVersionId,
);
const spec = working.sceneSource.spec;

// 封闭注册表校验：只接受已注册组件。
const component = threeRegistry.get(spec.componentId, spec.componentVersion);
const params = component.validateParams(spec.params);

// esbuild 打包。
const out = path.resolve(values.out);
mkdirSync(out, { recursive: true });
const esbuild = path.join(
  root,
  "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild",
);
const entry = path.join(root, "scripts/video/w4-interactive/app.js");
const bundlePath = path.join(out, ".app.bundle.tmp.js");
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

const runtimeOptions = {
  background: spec.background,
  color: params.color,
  accent: params.accent,
  shape: params.shape,
  tilt: params.tilt,
  spinPerFrame: params.spinPerFrame,
  zoom: params.zoom, // Codex 复核 P2-1：zoom 是合法 rig 参数，不遗漏
};
const safeTitle = escapeHtml(project.title);
const safeShape = escapeHtml(params.shape);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 · ${safeTitle} · 镜头 ${shotIndex + 1} 交互预览</title>
<style>
  body { margin: 0; background: ${escapeHtml(spec.background)}; color: #eef3f8; font-family: sans-serif; }
  #stage { width: 100vw; height: 88vh; touch-action: none; cursor: grab; }
  #hint { padding: 12px 16px; font-size: 14px; color: #9fb2c4; }
  #state { color: ${escapeHtml(params.accent)}; font-weight: 700; }
  .w4-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
<div id="stage" data-exploded="false" data-rotated="false" tabindex="0" role="group" aria-label="拖转 ${safeShape} 主体，双击或回车拆解"></div>
<p id="hint">拖拽转动主体；双击/回车切换 <span id="state">合拢</span>/拆解。源项目：${safeTitle}（镜头 ${shotIndex + 1}，${escapeHtml(spec.componentId)}@${spec.componentVersion}）。这是衍生交互演示，与出片机位非逐像素一致。</p>
<script>${bundle}</script>
<script>
  const app = W4App.createApp(document.getElementById("stage"), ${jsonArg(runtimeOptions)});
  const stateLabel = document.getElementById("state");
  document.getElementById("stage").addEventListener("w4:state", () => {
    stateLabel.textContent = app.state.exploded ? "拆解" : "合拢";
  });
</script>
</body>
</html>
`;

// 内存中先检体积（Codex 复核 P2-2：超限时不得先写文件再抛）。
const bytes = Buffer.byteLength(html);
const MAX = 8 * 1024 * 1024;
if (bytes > MAX) {
  rmSync(bundlePath, { force: true });
  throw new Error(`自包含页超限：${bytes} > ${MAX}（未写入产物目录）`);
}
// 原子写：先写临时名再 rename（旧成功产物不被半新文件覆盖）。
const htmlPath = path.join(out, "index.html");
const tempPath = path.join(out, ".index.html.tmp");
writeFileSync(tempPath, html);
renameSync(tempPath, htmlPath);
rmSync(bundlePath, { force: true });

const sha256Content = createHash("sha256").update(html).digest("hex");
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
          sha256: sha256Content,
          source: "scripts/video/w4-interactive/app.js + 本构建脚本",
          license: "three.js MIT（内联运行时）；页面与几何全部程序化自有",
        },
      ],
      runtime: "three@0.186.1 (MIT) 经 esbuild@0.28.1 IIFE 内联",
      semantics:
        "衍生交互演示（PerspectiveCamera），与出片 OrthographicCamera 机位非逐像素一致",
      rebuild: `node scripts/video/t3-export-interactive.mjs --project ${values.project} --out ${values.out}`,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `T3 interactive export → ${htmlPath}（${bytes} B / 8 MiB，${spec.componentId}@${spec.componentVersion} ${params.shape}）`,
);
