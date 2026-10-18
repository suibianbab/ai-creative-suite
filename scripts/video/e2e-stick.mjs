#!/usr/bin/env node
// P2-④ 火柴人端到端闭环验收（VID-020，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头 218 帧，水循环）→保存
//   →镜头 2 换 stick-walk-across（旁白并发编辑单次应用一并落库）→改人物数据→应用→保存
//   →镜头 3 换 stick-meet→改人物数据（动作词 + toX 缺省行）→应用→保存
//   →导出 JSON（结构断言：figures/动作词/坐标/旁白合并/时长保留）
//   →CLI render-scene 双画幅出片→双跑逐字节 SHA-256 一致
//   →火柴人帧 YAVG ≥100（帧 80 行进中 / 帧 140 三人梯次，双画幅）
//   →A1 金标准：flow e2e（VID-019）子进程复跑 = P2-③ 已档哈希（v5 追加无害）
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
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-stick");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-stick] FAIL at ${step}: ${detail ?? ""}`);
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

// 逐帧亮度（有限范围黑 ≈ 16）：signalstats YAVG，零新依赖的数值断言口径（沿 VID-016..019）。
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

// —— 1. 镜头 2 换 stick-walk-across：旁白与换模板同草稿并发，单次应用一并落库
//        （P2-① 终评 I1 合并语义不回退）→ 二次应用改人物数据 ——
const card2 = page.locator(".shot-list > li").nth(1);
await card2.locator(".shot-edit-toggle").click();
await card2.locator(".shot-narration-input").fill("火柴人先走进画面。");
await card2.locator(".chart-template-select").selectOption("stick-walk-across");
await card2.locator(".shot-apply").click();
await card2
  .locator(".stick-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("火柴人编辑字段", "换模板后 .stick-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".stick-data-input");
      return Boolean(el && el.value.includes("走,80,920"));
    },
    1,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("模板预填", "stick-data-input 未回填模板默认数据"));
await card2.locator(".stick-data-input").fill("走,120,880");
await card2.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存火柴人镜头");

// —— 2. 镜头 3 换 stick-meet + 人物数据编辑（动作词 + toX 缺省行）——
const card3 = page.locator(".shot-list > li").nth(2);
await card3.locator(".shot-edit-toggle").click();
await card3.locator(".chart-template-select").selectOption("stick-meet");
await card3.locator(".shot-apply").click();
await card3
  .locator(".stick-data-input")
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("相遇模板编辑字段", "换模板后 .stick-data-input 未出现"));
await page
  .waitForFunction(
    (index) => {
      const el = document
        .querySelectorAll(".shot-list > li")
        [index]?.querySelector(".stick-data-input");
      return Boolean(el && el.value.includes("走,80,420"));
    },
    2,
    { timeout: 10_000, polling: 100 },
  )
  .catch(() => fail("相遇模板预填", "stick-data-input 未回填模板默认数据"));
await card3.locator(".stick-data-input").fill("走,80,420\n走,920,580\n指,500");
await card3.locator(".shot-apply").click();
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存相遇镜头");

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
if (s2.componentId !== "stick-figure") fail("镜头 2 组件", s2.componentId);
if (
  JSON.stringify(s2.params.figures) !==
  '[{"action":"走","fromX":120,"toX":880}]'
)
  fail("镜头 2 人物", JSON.stringify(s2.params.figures));
if (s2.durationMs !== 3100)
  fail("时长保留", `镜头 2 durationMs=${s2.durationMs}`);
// 并发合并断言（P2-① 终评 I1 语义）：换模板时同草稿的旁白编辑不被丢弃
const working2 = exported.shots[1].contentVersions.find(
  (v) => v.versionId === exported.shots[1].workingVersionId,
);
if (working2?.narrationText !== "火柴人先走进画面。")
  fail("旁白并发合并", `narrationText=${working2?.narrationText ?? "(空)"}`);
const s3 = specOf(exported.shots[2]);
if (s3.componentId !== "stick-figure") fail("镜头 3 组件", s3.componentId);
const figures3 = s3.params.figures;
if (figures3.length !== 3) fail("镜头 3 人数", String(figures3.length));
if (JSON.stringify(figures3[0]) !== '{"action":"走","fromX":80,"toX":420}')
  fail("镜头 3 人物 0", JSON.stringify(figures3[0]));
if (JSON.stringify(figures3[2]) !== '{"action":"指","fromX":500,"toX":500}')
  fail("镜头 3 toX 缺省", JSON.stringify(figures3[2]));
if (s3.params.groundY !== 800)
  fail("镜头 3 groundY 保留", String(s3.params.groundY));
await page.screenshot({
  path: path.join(OUT_DIR, "stick-editor.png"),
  fullPage: true,
});
console.log(
  `[e2e-stick] 编辑落库: 项目 ${exported.id} v${exported.savedVersion}，镜头2=${s2.componentId}(走,120,880)，镜头3=${s3.componentId}(走/走/指 三人)，旁白合并=${working2?.narrationText}`,
);

// —— 4. CLI 双画幅出片 + 双跑一致 + 火柴人帧 YAVG ——
// spans [2000,3100,2000,2000]ms @24fps → 总 218 帧：镜头 2 帧域 48..121，
// 镜头 3 帧域 122..169。帧 80（镜头 2 内 1333ms）：走 120→880 travelMs 2400
// → progress≈0.39 x≈416，行进中段；帧 140（镜头 3 内 733ms）：三人 delay
// 0/200/400 全过淡入窗（enterMs 400），fig0 x≈137 行进中。两帧均 YAVG ≥100。
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
  console.log(`[e2e-stick] 双跑一致: ${aspect} ${a}`);
  for (const frame of [80, 140]) {
    const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), frame);
    if (yavg < 100)
      fail("火柴人帧亮度", `${aspect} 帧 ${frame} YAVG=${yavg} < 100`);
    console.log(`[e2e-stick] ${aspect}: 帧 ${frame} YAVG=${yavg}（≥100）`);
  }
}

// —— 5. 控制台零 error + 计费不变 ——
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

// —— 6. A1 金标准：flow e2e 子进程复跑 = P2-③ 已档哈希（v5 追加无害）——
const FLOW_HASHES = {
  landscape: "24a625c77f5299f7db10ed1ddb83ff7f17787f5c201a9f2a7ddb604456a0efaa",
  portrait: "274f1d0f21658de0266ab97b987b25dd37468bf82d387d5e68a5f300062fa4c5",
};
const flowRun = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/video/e2e-flow.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 600_000, env: { ...process.env } },
);
if (flowRun.status !== 0)
  fail("A1 flow 复跑", `${flowRun.stdout ?? ""}\n${flowRun.stderr ?? ""}`);
for (const [aspect, want] of Object.entries(FLOW_HASHES)) {
  const m = `${flowRun.stdout}`.match(
    new RegExp(`双跑一致: ${aspect} ([0-9a-f]{64})`),
  );
  if (!m || m[1] !== want)
    fail("A1 金标准", `${aspect}: ${m?.[1] ?? "(无输出)"} ≠ ${want}`);
}
console.log("[e2e-stick] A1: flow 复跑哈希 = P2-③ 已档（注册表 v5 追加无害）");

await browser.close();
console.log(
  `[e2e-stick] OK: 模板换装→数据编辑→出片→双跑一致→火柴人帧非空→A1 flow 金标准一致，计费零新增（台账 ${usageAfter} 行不变）`,
);
console.log("[e2e-stick] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "render/landscape.mp4",
  "render/portrait.mp4",
  "stick-editor.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
