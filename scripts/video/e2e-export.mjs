#!/usr/bin/env node
// D4 导出扩充端到端验收（零 TTS 计费）：
//   入库基线项目（4 镜头）→ render-scene 出片（MP4×2 画幅 + RenderRecord×8）
//   → export-gif landscape（ffprobe 元数据 + DeliveryRecord renderIds 非空/frameMap [24,37,24,24]）
//   → 双跑转码逐字节一致（同 MP4 + 同 ffmpeg）
//   → export-shot-svg --shot 2 动画（3100ms → 74 帧 → @12fps 37 段 + renderIds 空数组落档）
//   → export-shot-svg --shot 3 --frame 24 静态（basic-shapes，无 @keyframes）
//   → SVG 双跑逐字节一致 → 计费台账行数不变。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-export");
const LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const BASELINE = path.join(
  ROOT,
  "artifacts/video-studio-shot-editor/baseline.video-project.json",
);

function fail(step, detail) {
  console.error(`[e2e-export] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function lines(file) {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
function run(step, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
  });
  if (result.status !== 0)
    fail(step, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

mkdirSync(OUT_DIR, { recursive: true });
const usageBefore = lines(LEDGER);

// 1. 基线拷贝 + 出片（走完整干跑门禁，不 --skip-dryrun）
const project = path.join(OUT_DIR, "e2e.video-project.json");
copyFileSync(BASELINE, project);
run("render-scene", [
  path.join(ROOT, "scripts/video/render-scene.mjs"),
  "--project",
  project,
  "--out",
  path.join(OUT_DIR, "render"),
]);
const rendered = JSON.parse(readFileSync(project, "utf8"));
if (rendered.renderRecords.length !== 8)
  fail("render-scene", `RenderRecord ${rendered.renderRecords.length} ≠ 8`);

// 2. export-gif（landscape，帧图 [48,74,48,48]@24fps → GIF@12fps [24,37,24,24]）
run("export-gif", [
  path.join(ROOT, "scripts/video/export-gif.mjs"),
  "--project",
  project,
  "--aspect",
  "landscape",
  "--out",
  OUT_DIR,
]);
const afterGif = JSON.parse(readFileSync(project, "utf8"));
if (afterGif.deliveries.length !== 1)
  fail("export-gif", "DeliveryRecord 未落档");
const d0 = afterGif.deliveries[0];
if (d0.renderIds.length !== 4)
  fail("export-gif", `renderIds ${d0.renderIds.length} ≠ 4`);
if (JSON.stringify(d0.frameMap) !== JSON.stringify([24, 37, 24, 24]))
  fail("export-gif", `frameMap ${JSON.stringify(d0.frameMap)}`);
const gif = path.join(OUT_DIR, "landscape.gif");
if (!existsSync(gif)) fail("export-gif", "GIF 未落盘");
// ffprobe 元数据门禁在 CLI 内部已做；此处再独立复核一次 codec/宽度
const probe = JSON.parse(
  spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width",
      "-of",
      "json",
      gif,
    ],
    { encoding: "utf8" },
  ).stdout,
);
if (
  probe.streams?.[0]?.codec_name !== "gif" ||
  probe.streams?.[0]?.width !== 480
)
  fail("ffprobe", JSON.stringify(probe));

// 3. GIF 双跑逐字节一致（同 MP4 + 同 ffmpeg 版本）
const projectCopy = path.join(OUT_DIR, "rerun.video-project.json");
copyFileSync(project, projectCopy);
run("export-gif 双跑", [
  path.join(ROOT, "scripts/video/export-gif.mjs"),
  "--project",
  projectCopy,
  "--aspect",
  "landscape",
  "--out",
  path.join(OUT_DIR, "rerun"),
]);
if (sha256(gif) !== sha256(path.join(OUT_DIR, "rerun/landscape.gif")))
  fail("GIF 确定性", "两次哈希不一致");

// 4. export-shot-svg 动画（镜头 2 text-animation 3100ms → 74 帧 → @12fps 37 段）
//    + 静态（镜头 3 basic-shapes，覆盖另一组件族）
run("export-shot-svg 动画", [
  path.join(ROOT, "scripts/video/export-shot-svg.mjs"),
  "--project",
  project,
  "--shot",
  "2",
  "--fps",
  "12",
  "--out",
  OUT_DIR,
]);
const animated = readFileSync(
  path.join(OUT_DIR, "shot-2-animated-12fps.svg"),
  "utf8",
);
const keyframeCount = (animated.match(/@keyframes kf-/g) ?? []).length;
if (keyframeCount !== 37)
  fail("SVG 动画", `keyframes 段数 ${keyframeCount} ≠ 37`);
run("export-shot-svg 静态", [
  path.join(ROOT, "scripts/video/export-shot-svg.mjs"),
  "--project",
  project,
  "--shot",
  "3",
  "--frame",
  "24",
  "--out",
  OUT_DIR,
]);
const staticSvg = readFileSync(
  path.join(OUT_DIR, "shot-3-frame-24.svg"),
  "utf8",
);
if (staticSvg.includes("@keyframes")) fail("SVG 静态", "静态帧不应含动画样式");
const afterSvg = JSON.parse(readFileSync(project, "utf8"));
if (afterSvg.deliveries.length !== 3)
  fail(
    "export-shot-svg",
    `交付数 ${afterSvg.deliveries.length} ≠ 3（gif1 + svg2）`,
  );
if (
  afterSvg.deliveries[1].renderIds.length !== 0 ||
  JSON.stringify(afterSvg.deliveries[1].frameMap) !== "[37]"
)
  fail("SVG 动画交付", JSON.stringify(afterSvg.deliveries[1]));

// 5. SVG 双跑逐字节一致
copyFileSync(project, projectCopy);
run("export-shot-svg 双跑", [
  path.join(ROOT, "scripts/video/export-shot-svg.mjs"),
  "--project",
  projectCopy,
  "--shot",
  "2",
  "--fps",
  "12",
  "--out",
  path.join(OUT_DIR, "rerun"),
]);
if (
  sha256(path.join(OUT_DIR, "shot-2-animated-12fps.svg")) !==
  sha256(path.join(OUT_DIR, "rerun/shot-2-animated-12fps.svg"))
)
  fail("SVG 确定性", "两次哈希不一致");

// 6. 计费不变 + 终版回读校验（deliveries 追加后文档仍合法）
if (lines(LEDGER) !== usageBefore) fail("计费", "tts-usage.jsonl 行数变化");
const finalProject = JSON.parse(readFileSync(project, "utf8"));
run("回读校验", [
  path.join(ROOT, "scripts/video/export-shot-svg.mjs"),
  "--project",
  project,
  "--shot",
  "3",
  "--frame",
  "25",
  "--out",
  path.join(OUT_DIR, "verify"),
]);
if (
  JSON.parse(readFileSync(project, "utf8")).deliveries.length !==
  finalProject.deliveries.length + 1
)
  fail("回读校验", "追加交付后文档未按预期演进");

console.log(
  `[e2e-export] OK: GIF + SVG 全链（交付 ${finalProject.deliveries.length + 1} 条），计费零新增`,
);
for (const name of [
  "landscape.gif",
  "shot-2-animated-12fps.svg",
  "shot-3-frame-24.svg",
  "e2e.video-project.json",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
