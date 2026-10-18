#!/usr/bin/env node
// P2-② 地图动画端到端闭环验收（VID-018，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 grid-china-6（旁白并发编辑单次应用一并落库）→改数据（三区网格）→应用→保存
//   →镜头 3 换 journey-route→改数据（甲→乙→丙 三点行程）→应用→保存
//   →导出 JSON（结构断言：regions/origin/waypoints/destination/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →地图帧 YAVG ≥100（帧 80 网格块全部到位 / 帧 140 行程描画后段，双画幅）
//   →计费台账行数不变 + 浏览器控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（:3210，建议经 scripts/dev/proxy-3211.mjs）；
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
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-map");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-map] FAIL at ${step}: ${detail ?? ""}`);
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

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径（沿 VID-016/017）。
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

// —— 1. 镜头 2 换 grid-china-6：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("降水看分布，行程看路线。");
await card2.locator(".chart-template-select").selectOption("grid-china-6");
await card2.locator(".shot-apply").click();
await card2
  .locator(".map-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("地图编辑字段", "换模板后 .map-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".map-data-input");
      return Boolean(el && el.value.includes("华北,0,1"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "map-data-input 未回填模板默认数据"));
await card2
  .locator(".map-data-input")
  .fill("东城,0,0,30\n西城,0,1,20\n南城,1,0,25");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存网格地图镜头");

// —— 2. 镜头 3 换 journey-route + 数据编辑（含裸坐标途经点）——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("journey-route");
await card3.locator(".shot-apply").click();
await card3
  .locator(".map-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("行程编辑字段", "换模板后 .map-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".map-data-input");
      return Boolean(el && el.value.includes("北京,240,420"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("行程预填", "map-data-input 未回填模板默认数据"));
await card3.locator(".map-data-input").fill("甲,200,400\n500,300\n丙,800,600");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存行程镜头");

// —— 3. 导出 + 结构断言 ——
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
if (!existsSync(EXPORTED)) fail("导出", "下载文件未落盘");
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
const specOf = (shot) =>
  shot.contentVersions.find((v) => v.versionId === shot.workingVersionId)
    .sceneSource.spec;
const s2 = specOf(exported.shots[1]);
if (s2.componentId !== "map-grid") fail("镜头 2 组件", s2.componentId);
const regions = s2.params.regions
  .map(
    (r) =>
      `${r.label},${r.row},${r.col}${r.value === undefined ? "" : `,${r.value}`}`,
  )
  .join("|");
if (regions !== "东城,0,0,30|西城,0,1,20|南城,1,0,25")
  fail("镜头 2 数据", regions);
// 并发合并断言（P2-① 终评 I1 语义）：换模板时同草稿的旁白编辑不被丢弃
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "降水看分布，行程看路线。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "map-journey") fail("镜头 3 组件", s3.componentId);
if (
  s3.params.origin.label !== "甲" ||
  s3.params.origin.x !== 200 ||
  s3.params.waypoints.length !== 1 ||
  s3.params.waypoints[0].x !== 500 ||
  s3.params.destination.label !== "丙" ||
  s3.params.destination.x !== 800
)
  fail("镜头 3 数据", JSON.stringify(s3.params));
// 字段保留断言：时长不被模板换掉
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
await page.screenshot({
  path: path.join(OUT_DIR, "map-editor.png"),
  fullPage: true,
});
console.log(
  `[e2e-map] 编辑落库: 项目 ${exported.id} v${exported.savedVersion}，镜头2=${s2.componentId}(${regions})，镜头3=${s3.componentId}(甲→[500,300]→丙)，旁白合并=${working2?.narrationText}`,
);

// —— 4. CLI 双画幅出片 + 双跑一致 + 地图帧 YAVG ——
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：enterMs 1200 + 梯次
// 2×90 → 三块全部成形到位；帧 140（镜头 3 内 750ms）：行程描画后段
// （drawMs 1600 → easeOutCubic(750/1600)≈0.83），白底深字。
// 两帧均断言 YAVG ≥100（非全黑）。
const RENDER_DIR = path.join(OUT_DIR, "render");
renderProject(EXPORTED, RENDER_DIR, "CLI 出片");
const RERUN_DIR = path.join(OUT_DIR, "rerun");
const RERUN_PROJECT = path.join(OUT_DIR, "rerun.video-project.json");
copyFileSync(EXPORTED, RERUN_PROJECT);
renderProject(RERUN_PROJECT, RERUN_DIR, "CLI 复跑");
for (const aspect of ["landscape", "portrait"]) {
  const a = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  const b = sha256(path.join(RERUN_DIR, `${aspect}.mp4`));
  if (a !== b) fail("双跑一致", `${aspect}: ${a} ≠ ${b}`);
  console.log(`[e2e-map] 双跑一致: ${aspect} ${a}`);
  for (const frame of [80, 140]) {
    const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), frame);
    if (yavg < 100)
      fail("地图帧亮度", `${aspect} 帧 ${frame} YAVG=${yavg} < 100`);
    console.log(`[e2e-map] ${aspect}: 帧 ${frame} YAVG=${yavg}（≥100）`);
  }
}

// —— 5. 控制台零 error + 计费不变 ——
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  `[e2e-map] OK: 模板换装→数据编辑→出片→双跑一致→地图帧非空，计费零新增（台账 ${usageAfter} 行不变）`,
);
console.log("[e2e-map] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "render/landscape.mp4",
  "render/portrait.mp4",
  "map-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
