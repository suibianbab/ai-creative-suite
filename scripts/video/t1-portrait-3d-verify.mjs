#!/usr/bin/env node
// T1 验收：orbit3d@2 竖版方形像素取景。横竖双画幅真实 bake + 出片；
// 参照立方体的投影宽度/高度比在两画幅下一致（方形像素判据），并排图与
// 早/中/晚帧留档。@1 基线（历史拉伸）并排对照供审片。
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.join(root, "artifacts/video-studio-t1-portrait-3d-2026-10-25");
mkdirSync(path.join(out, "render-v2"), { recursive: true });
mkdirSync(path.join(out, "render-v1-baseline"), { recursive: true });

const makeProject = (componentVersion, durationMs = 3000) => {
  const template = JSON.parse(
    readFileSync(
      path.join(root, "scripts/video/fixtures/three-sample.video-project.json"),
      "utf8",
    ),
  );
  const shot = template.shots[0];
  const version = shot.contentVersions[0];
  version.durationMs = durationMs;
  version.description = `T1 orbit3d@${componentVersion} 竖版取景`;
  version.narrationText = "竖版取景验证。";
  version.sceneSource.spec.durationMs = durationMs;
  version.sceneSource.spec.componentVersion = componentVersion;
  return template;
};

const projectV2 = makeProject(2);
const projectPath = path.join(out, "project-v2.json");
writeFileSync(projectPath, `${JSON.stringify(projectV2, null, 2)}\n`);
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    projectPath,
    "--out",
    path.join(out, "render-v2"),
  ],
  { cwd: root, stdio: "inherit" },
);

// @1 基线：旧 spec（componentVersion 1）同流程渲染，历史拉伸对照。
const projectV1 = makeProject(1);
const projectV1Path = path.join(out, "project-v1-baseline.json");
writeFileSync(projectV1Path, `${JSON.stringify(projectV1, null, 2)}\n`);
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    projectV1Path,
    "--out",
    path.join(out, "render-v1-baseline"),
  ],
  { cwd: root, stdio: "inherit" },
);

// 方形像素判据（原生像素）：立方体投影的 宽px/高px 在两画幅应一致且 ≈ 1
//（倾斜使投影略高于宽，两画幅数值彼此一致即为比例一致）；v1 竖版因 3.16×
// 纵向拉伸，h 显著偏大。测量用原生帧灰度（不做 scale 归一——定尺网格会
// 把竖版纵向压缩 14.2 倍造成误读）。
const contentAspect = (file) => {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  ).streams[0];
  const { width, height } = probe;
  const raw = execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-i",
      file,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (raw[y * width + x] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  if (maxX < 0) throw new Error("无内容");
  return { w: maxX - minX + 1, h: maxY - minY + 1, width, height };
};
const results = {};
for (const [label, dir] of [
  ["v2", "render-v2"],
  ["v1", "render-v1-baseline"],
]) {
  for (const aspect of ["landscape", "portrait"]) {
    const at = { early: 0.6, mid: 1.5, late: 2.7 };
    for (const [tag, t] of Object.entries(at)) {
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        String(t),
        "-i",
        path.join(out, dir, `${aspect}.mp4`),
        "-frames:v",
        "1",
        path.join(out, `${label}-${aspect}-${tag}.png`),
      ]);
    }
    results[`${label}-${aspect}`] = contentAspect(
      path.join(out, `${label}-${aspect}-mid.png`),
    );
  }
}
const ratio = (r) => r.w / r.h;
const ratios = {
  v2Landscape: ratio(results["v2-landscape"]),
  v2Portrait: ratio(results["v2-portrait"]),
  v1Landscape: ratio(results["v1-landscape"]),
  v1Portrait: ratio(results["v1-portrait"]),
};
// 判据：v2 横竖宽高比一致（差 <10%）；v1 竖版显著偏竖（拉伸证据）。
const v2Delta = Math.abs(ratios.v2Landscape - ratios.v2Portrait);
const pass =
  v2Delta / ratios.v2Landscape < 0.1 && ratios.v1Portrait < ratios.v2Portrait;
writeFileSync(
  path.join(out, "t1-summary.json"),
  `${JSON.stringify(
    {
      pass,
      bbox: results,
      ratios,
      criteria:
        "v2 横竖内容宽高比差 <10%（方形像素→比例一致）；v1 竖版比显著更小（纵向拉伸证据）",
    },
    null,
    2,
  )}\n`,
);
if (!pass) {
  console.error("T1 方形像素判据未通过", ratios);
  process.exit(1);
}
console.log(JSON.stringify({ pass, ratios }, null, 1));
