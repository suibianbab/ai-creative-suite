#!/usr/bin/env node
// P1 转场端到端闭环验收（VID-016，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧）→保存
//   →配转场（边界 1→2 选「淡入淡出」500ms）→保存 v3→导出 JSON（断言 transitions 形状）
//   →CLI render-scene 双画幅出片（props/manifest 透传断言）
//   →暗帧数值断言（ffmpeg signalstats YAVG：边界中点帧全黑 ≤30、对照帧 ≥100，双画幅）
//   →双跑：同项目重渲逐字节 SHA-256 一致（A4 帧确定性）
//   →A1 金标准：入库无转场基线项目重渲哈希 = Feature ③ 已档值（缺席 = 字节不变）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build；ffmpeg 在 PATH。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-transitions");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
// Feature ③ 已档无转场基线哈希（E2E_EXPORT.md）：A1 金标准对照值。
const A1_HASHES = {
  "landscape.mp4":
    "bbda0997f8038e6b9b751e0528e9839ede2bb63612b1dc81636502db156e9f0f",
  "portrait.mp4":
    "b1849dd5ab1d0391dbc574a23bdbf3bdba8e7327679810f90ae949d48bb5127a",
};

function fail(step, detail) {
  console.error(`[e2e-transitions] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function usageLines() {
  try {
    return readFileSync(USAGE_LEDGER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的暗帧数值断言口径。
function frameYavg(videoPath, frameNumber) {
  const out = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      videoPath,
      "-vf",
      `select='eq(n,${frameNumber})',signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  const match = `${out.stderr}`.match(/YAVG=([0-9.]+)/);
  if (!match)
    fail("YAVG 提取", `${videoPath} 第 ${frameNumber} 帧无 YAVG 输出`);
  return Number(match[1]);
}

function renderProject(projectPath, outDir, step) {
  mkdirSync(outDir, { recursive: true });
  const render = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/render-scene.mjs"),
      "--project",
      projectPath,
      "--out",
      outDir,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  if (render.status !== 0)
    fail(step, `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
}

async function waitForMessage(page, text, step) {
  await page
    .locator(".editor-message", { hasText: text })
    .waitFor({ timeout: 10_000 })
    .catch(() => fail(step, `未出现提示: ${text}`));
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(EXPORTED, { force: true });
const usageBefore = usageLines();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});

// —— 去程：新建 → 分镜规划 → 确认应用 → 保存 ——
await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await page
  .locator(".project-create")
  .first()
  .waitFor({ state: "visible", timeout: 20_000 })
  .catch(() => fail("打开工作台", "selector 不可见: .project-create"));
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await page
  .locator(".storyboard-card")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("分镜确认卡", "未出现"));
await page.click(".plan-apply");
await waitForMessage(page, "首个 4 个镜头", "追加应用");
await page
  .locator(".editor-shots")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("镜头时间线", "未出现"));
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存基线");

// —— 1. 配转场：边界 1→2 选淡入淡出 500ms ——
await page
  .locator(".transitions-editor")
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("转场区", "未出现（镜头数 >1 应渲染）"));
const rows = page.locator(".transition-row");
if ((await rows.count()) !== 3)
  fail("转场区", `边界行数 ${await rows.count()} ≠ 3（4 镜头）`);
await rows.first().locator(".transition-kind").selectOption("fade");
await rows.first().locator(".transition-duration").fill("500");
// 合法输入 → 无行内错误；保存后文档带 transitions
await page
  .locator(".transition-error")
  .waitFor({ state: "hidden", timeout: 5_000 })
  .catch(() => fail("转场校验", "合法输入仍出现 .transition-error"));
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存转场");

// —— 2. 导出 + 结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
if (!existsSync(EXPORTED)) fail("导出", "下载文件未落盘");
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const transitions = exported.transitions;
if (
  !Array.isArray(transitions) ||
  transitions.length !== 1 ||
  transitions[0].boundary !== 0 ||
  transitions[0].kind !== "fade" ||
  transitions[0].durationMs !== 500
) {
  fail("transitions 形状", JSON.stringify(transitions));
}
await page.screenshot({
  path: path.join(OUT_DIR, "transitions-editor.png"),
  fullPage: true,
});
console.log(
  `[e2e-transitions] 配置完成: 项目 ${exported.id} v${exported.savedVersion}，transitions=${JSON.stringify(transitions)}`,
);

// —— 3. CLI 双画幅出片 + props/manifest 透传断言 ——
const RENDER_DIR = path.join(OUT_DIR, "render");
renderProject(EXPORTED, RENDER_DIR, "CLI 出片");
const propsJson = JSON.parse(
  readFileSync(path.join(RENDER_DIR, "props-landscape.json"), "utf8"),
);
if (JSON.stringify(propsJson.transitions) !== JSON.stringify(transitions))
  fail(
    "props 透传",
    `props-landscape.transitions 不符: ${JSON.stringify(propsJson.transitions)}`,
  );
const manifest = JSON.parse(
  readFileSync(path.join(RENDER_DIR, "render-manifest.json"), "utf8"),
);
// [2000,3100,2000,2000]ms → 218 帧 [48,74,48,48]；边界 0：T=12, halfOut=6 → 窗 [42,54)
const window0 = manifest.transitions?.[0];
if (!window0 || window0.startFrame !== 42 || window0.frames !== 12) {
  fail("manifest 摘要", JSON.stringify(manifest.transitions));
}
console.log(
  `[e2e-transitions] 出片透传: props.transitions + manifest 窗口 ${JSON.stringify(window0)}`,
);

// —— 4. 暗帧数值断言（A2：双画幅）——
// 窗口 [42,54)：帧 47（左尾）与 48（右首）全黑；帧 20/60 为窗外对照。
for (const aspect of ["landscape", "portrait"]) {
  const video = path.join(RENDER_DIR, `${aspect}.mp4`);
  const dark1 = frameYavg(video, 47);
  const dark2 = frameYavg(video, 48);
  const controlA = frameYavg(video, 20);
  const controlB = frameYavg(video, 60);
  if (dark1 > 30 || dark2 > 30)
    fail("暗帧断言", `${aspect} 帧47/48 YAVG ${dark1}/${dark2} > 30（未全黑）`);
  if (controlA < 100 || controlB < 100)
    fail(
      "对照帧",
      `${aspect} 帧20/60 YAVG ${controlA}/${controlB} < 100（对照不亮）`,
    );
  console.log(
    `[e2e-transitions] ${aspect}: YAVG 帧47=${dark1} 帧48=${dark2}（≤30）| 对照 20=${controlA} 60=${controlB}（≥100）`,
  );
}

// —— 5. 双跑逐字节一致（A4 帧确定性）——
const RERUN_DIR = path.join(OUT_DIR, "rerun");
const RERUN_PROJECT = path.join(OUT_DIR, "rerun.video-project.json");
copyFileSync(EXPORTED, RERUN_PROJECT);
renderProject(RERUN_PROJECT, RERUN_DIR, "双跑出片");
for (const aspect of ["landscape", "portrait"]) {
  const a = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  const b = sha256(path.join(RERUN_DIR, `${aspect}.mp4`));
  if (a !== b) fail("双跑一致", `${aspect}: ${a} ≠ ${b}`);
  console.log(`[e2e-transitions] 双跑一致: ${aspect} ${a}`);
}

// —— 6. A1 金标准：入库无转场基线重渲 = Feature ③ 已档哈希 ——
const A1_DIR = path.join(OUT_DIR, "a1-baseline");
const A1_PROJECT = path.join(OUT_DIR, "baseline.video-project.json");
copyFileSync(
  path.join(
    ROOT,
    "artifacts/video-studio-shot-editor/baseline.video-project.json",
  ),
  A1_PROJECT,
);
renderProject(A1_PROJECT, A1_DIR, "A1 基线重渲");
for (const aspect of ["landscape", "portrait"]) {
  const hash = sha256(path.join(A1_DIR, `${aspect}.mp4`));
  if (hash !== A1_HASHES[`${aspect}.mp4`])
    fail(
      "A1 金标准",
      `${aspect}: ${hash} ≠ 已档 ${A1_HASHES[`${aspect}.mp4`]}`,
    );
  console.log(`[e2e-transitions] A1 字节不变: ${aspect} ${hash}`);
}

// —— 7. 控制台零 error + 计费不变 ——
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  `[e2e-transitions] OK: 配置→出片→暗帧断言→双跑一致→无转场字节不变，计费零新增（台账 ${usageAfter} 行不变）`,
);
console.log("[e2e-transitions] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "render/landscape.mp4",
  "render/portrait.mp4",
  "transitions-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
