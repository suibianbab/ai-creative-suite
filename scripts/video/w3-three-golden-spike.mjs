#!/usr/bin/env node
// W3 Three 路线 Golden Spike：非品牌程序化对象的完整受控 3D 镜头——
// 烘焙（计时）→ 双画幅出片（计时）→ 早/中/晚关键帧 → 摘要落档。
// Blender 路线本机无执行器（见 BLENDER-ROUTE.md），按交接单降级为文档就绪。
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-w3-2026-10-24/three-route");
mkdirSync(path.join(out, "render"), { recursive: true });

// 非品牌程序化对象：演示立方体（无外部模型/纹理依赖，许可干净）。
// 身份声明见同目录 IDENTITY-CHECKLIST.md §本次样件。
const project = JSON.parse(
  readFileSync(
    path.join(root, "scripts/video/fixtures/three-sample.video-project.json"),
    "utf8",
  ),
);
const version = project.shots[0].contentVersions[0];
version.durationMs = 3000;
version.description = "W3 Three 路线样件：非品牌演示立方体（身份见清单）";
version.narrationText = "这是一个程序化生成的演示立方体。";
version.sceneSource.spec.durationMs = 3000;
version.sceneSource.spec.params = {
  shape: "box",
  color: "#4f9dff",
  accent: "#e8b04b",
  spinPerFrame: 0.02,
  tilt: 0.35,
  zoom: 1,
};
const projectPath = path.join(out, "project.json");
writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);

const timed = (label, fn) => {
  const start = Date.now();
  fn();
  return Date.now() - start;
};

const summary = { object: "procedural-box", bakeMs: 0, renderMs: 0 };
// bake-three 是 render-scene 的内部第一步；单独计时一次以记录烘焙成本，
// 渲染用独立副本避免 RenderRecord 双写。
const bakeCopy = path.join(out, "project.bake.json");
copyFileSync(projectPath, bakeCopy);
summary.bakeMs = timed("bake", () =>
  execFileSync(
    process.execPath,
    ["scripts/video/bake-three.mjs", "--project", bakeCopy],
    { cwd: root, stdio: "pipe" },
  ),
);
summary.renderMs = timed("render", () =>
  execFileSync(
    process.execPath,
    [
      "scripts/video/render-scene.mjs",
      "--project",
      projectPath,
      "--out",
      path.join(out, "render"),
    ],
    { cwd: root, stdio: "inherit" },
  ),
);
const manifest = JSON.parse(
  readFileSync(path.join(out, "render/render-manifest.json"), "utf8"),
);
summary.frames = Object.fromEntries(
  ["landscape", "portrait"].map((aspect) => [
    aspect,
    manifest.aspects[aspect].frameMap.reduce((sum, f) => sum + f.frames, 0),
  ]),
);
for (const aspect of ["landscape", "portrait"]) {
  const file = path.join(out, "render", `${aspect}.mp4`);
  for (const [tag, at] of [
    ["early", 0.6],
    ["mid", 1.5],
    ["late", 2.7],
  ]) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      file,
      "-frames:v",
      "1",
      path.join(out, `${aspect}-${tag}.png`),
    ]);
  }
}
writeFileSync(
  path.join(out, "spike-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
