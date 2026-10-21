#!/usr/bin/env node
// 零帧镜头修复浏览器回归（真实工作台链路，零 TTS 计费）：
//   A. 导入两个 1ms 零帧镜头的合法项目：时间线降级但镜头卡保留；逐个改回 2s，
//      第一次放行（仍有另一个零帧镜头）、第二次时间线恢复 96 帧；保存/导出/重开一致。
//   B. 导入 [2000,1000] 合法项目，把镜头 1 改成 0.001s：应用被「无法应用：」挡住，
//      文档时长仍为 2000（零帧时长不得进文档）。
//   C. 1ms 3D 镜头（three 场景源）进编辑态仍有时长入口，改回 2s 后场景源仍是 three，
//      版本时长与 spec.durationMs 同步为 2000。
// 前置: @acs/web dev server 已在 BASE_URL（建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build。
// exit 0 = 三个场景全部成立；任何一步失败 exit 1 并打印步骤名。
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-zero-frame-repair");
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const THREE_FIXTURE = path.join(
  ROOT,
  "scripts/video/fixtures/three-sample.video-project.json",
);
const CREATED_AT = "2026-10-21T00:00:00.000Z";

// 与 CLI 脚本同口径：直接导入已 build 的 dist，避免依赖包解析细节。
const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

function fail(step, detail) {
  console.error(`[e2e-zero-frame-repair] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(page, selector, step) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${selector}`));
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

// —— 夹具构造：text-animation spec 在 1ms 下仍过 validateSceneSpec ——
function textSpec({ durationMs, title, seed }) {
  return {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    durationMs,
    seed,
    background: "#ffffff",
    params: {
      title,
      subtitle: "零帧回归",
      titleColor: "#1b2c29",
      subtitleColor: "#5d7469",
      entrance: "fade-up",
      enterMs: 900,
    },
  };
}

function makeShot({ order, durationMs, title, seed }) {
  const versionId = randomUUID();
  return {
    shotId: randomUUID(),
    order,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: CREATED_AT,
        durationMs,
        description: `零帧夹具镜头 ${order + 1}`,
        narrationText: "",
        sceneSource: {
          type: "spec",
          spec: textSpec({ durationMs, title, seed }),
        },
        provenance: { engineId: "planner-rules", engineVersion: "1" },
      },
    ],
    events: [{ kind: "submitted", versionId, at: CREATED_AT, actor: "human" }],
  };
}

function makeProject({ title, sentence, shots }) {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title,
    brief: { sentence, aspectTargets: ["landscape", "portrait"] },
    shots,
    mediaAssets: [],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

// 写盘前先过文档校验：不合格夹具不该把失败伪装成 UI 问题。
function writeFixture(project, name) {
  validateVideoProject(project);
  const file = path.join(os.tmpdir(), `acs-${name}-${project.id}.json`);
  writeFileSync(file, JSON.stringify(project, null, 2));
  return file;
}

function workingVersion(project, shotIndex) {
  const shot = project.shots[shotIndex];
  return shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
for (const name of [
  "a-after-fix.video-project.json",
  "b-blocked.video-project.json",
  "c-three-after-fix.video-project.json",
]) {
  rmSync(path.join(OUT_DIR, name), { force: true });
}
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

function cardAt(index) {
  return page.locator(".shot-list > li").nth(index);
}

async function waitForMessage(text, step) {
  await page
    .locator(".editor-message", { hasText: text })
    .waitFor({ timeout: 10_000 })
    .catch(() => fail(step, `未出现提示: ${text}`));
}

async function exportJson(step, target) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.click(".editor-export"),
  ]);
  await download.saveAs(target);
  if (!existsSync(target)) fail(step, "下载文件未落盘");
  return JSON.parse(readFileSync(target, "utf8"));
}

async function gotoWorkbench(step) {
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail(step, "客户端未就绪（data-studio-ready 未出现）"));
}

async function importFixture(file, step) {
  await expectVisible(page, ".project-import", step);
  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForMessage("已导入", step);
  await expectVisible(page, ".editor-shots", step);
}

async function expectVisibleScoped(locator, step, label) {
  await locator
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => fail(step, `selector 不可见: ${label}`));
}

// —— 夹具 A：两个 1ms 零帧镜头 ——
const fixtureA = makeProject({
  title: "零帧镜头修复回归 A",
  sentence: "零帧回归：两个 1ms 镜头依次改回 2s",
  shots: [
    makeShot({ order: 0, durationMs: 1, title: "零帧镜头一", seed: 101 }),
    makeShot({ order: 1, durationMs: 1, title: "零帧镜头二", seed: 102 }),
  ],
});
const fixtureAFile = writeFixture(fixtureA, "zero-frame-a");
console.log(
  `[e2e-zero-frame-repair] 夹具 A 通过 validateVideoProject：${fixtureAFile}`,
);

// ============================== 步骤 A ==============================
await gotoWorkbench("A1 打开工作台");
await importFixture(fixtureAFile, "A2 导入夹具 A");

const cardCount = await page.locator(".shot-list > li").count();
if (cardCount !== 2) fail("A2 导入夹具 A", `镜头卡数量 ${cardCount} ≠ 2`);
if ((await page.locator(".editor-shots h3").count()) !== 0)
  fail("A3 零帧降级", "零帧项目不应出现整片帧数标题");
const degradedHint = await page
  .locator(".editor-shots > .editor-hint")
  .textContent();
if (!degradedHint?.includes("整片时间线暂不可预览"))
  fail("A3 零帧降级", `未找到降级提示文案: ${degradedHint}`);
console.log(
  `[e2e-zero-frame-repair] A3 降级态成立：2 张镜头卡保留，提示「${degradedHint?.trim()}」`,
);

const aShot1 = cardAt(0);
await aShot1.locator(".shot-edit-toggle").click();
await aShot1.locator(".shot-duration-input").fill("2");
await aShot1.locator(".shot-apply").click();
await waitForMessage("镜头 1 已修订", "A4 修复镜头 1（第一处零帧）");
if ((await page.locator(".editor-shots h3").count()) !== 0)
  fail("A4 修复镜头 1", "修好一个镜头后另一个仍零帧，时间线应保持降级");
await expectVisibleScoped(
  page.locator(".editor-shots > .editor-hint"),
  "A4 修复镜头 1",
  ".editor-shots > .editor-hint",
);
console.log(
  "[e2e-zero-frame-repair] A4 镜头 1 → 2s 已修订（剩一个零帧 → 仍降级，未互相锁死）",
);

const aShot2 = cardAt(1);
await aShot2.locator(".shot-edit-toggle").click();
await aShot2.locator(".shot-duration-input").fill("2");
await aShot2.locator(".shot-apply").click();
await waitForMessage("镜头 2 已修订", "A5 修复镜头 2");
await expectVisibleScoped(
  page.locator(".editor-shots h3"),
  "A5 修复镜头 2",
  ".editor-shots h3",
);
const aHeader = await page.locator(".editor-shots h3").textContent();
if (!aHeader?.includes("96 帧"))
  fail("A5 修复镜头 2", `整片帧数文案不含 96 帧: ${aHeader}`);
const aSpans = await page.locator(".timeline-span").allTextContents();
if (aSpans.length !== 2)
  fail("A5 修复镜头 2", `时间条数量 ${aSpans.length} ≠ 2`);
console.log(
  `[e2e-zero-frame-repair] A5 时间线恢复：${aHeader?.trim()}；span=${aSpans.join(" | ")}`,
);

await page.click(".editor-save");
await waitForMessage("已保存", "A6 保存");
const exportedA = await exportJson(
  "A6 导出",
  path.join(OUT_DIR, "a-after-fix.video-project.json"),
);
for (const [index, shot] of exportedA.shots.entries()) {
  const working = exportedA.shots[index].contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (working?.durationMs !== 2000)
    fail(
      "A6 导出",
      `镜头 ${index + 1} 工作版本时长 ${working?.durationMs} ≠ 2000`,
    );
}
if (exportedA.savedVersion !== 2)
  fail("A6 导出", `savedVersion ${exportedA.savedVersion} ≠ 2`);
console.log(
  `[e2e-zero-frame-repair] A6 保存/导出：v${exportedA.savedVersion}，两镜头工作版本均 2000ms`,
);

await page.reload({ waitUntil: "domcontentloaded" });
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("A7 重新打开", "重载后客户端未就绪"));
await expectVisible(page, ".project-table", "A7 重新打开");
const rowA = page
  .locator(".project-table tbody tr", { hasText: fixtureA.title })
  .first();
await rowA
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("A7 重新打开", `项目列表找不到「${fixtureA.title}」`));
await rowA.locator(".project-open").click();
await expectVisible(page, ".editor-shots", "A7 重新打开");
await expectVisibleScoped(
  page.locator(".editor-shots h3"),
  "A7 重新打开",
  ".editor-shots h3",
);
const reopenedHeader = await page.locator(".editor-shots h3").textContent();
if (!reopenedHeader?.includes("96 帧"))
  fail("A7 重新打开", `重开后帧数文案不含 96 帧: ${reopenedHeader}`);
const reopenedDurations = await page
  .locator(".shot-list .shot-duration")
  .allTextContents();
if (reopenedDurations.length !== 2)
  fail("A7 重新打开", `镜头卡时长条目 ${reopenedDurations.length} ≠ 2`);
for (const [index, text] of reopenedDurations.entries()) {
  if (!text.includes("2s"))
    fail("A7 重新打开", `镜头 ${index + 1} 时长文案不含 2s: ${text}`);
}
console.log(
  `[e2e-zero-frame-repair] A7 重开持久化成立：${reopenedHeader?.trim()}；镜头卡=${reopenedDurations.join(" | ")}`,
);

// ============================== 步骤 B ==============================
const fixtureB = makeProject({
  title: "零帧拦截回归 B",
  sentence: "回归：合法项目改出零帧必须被拦住",
  shots: [
    makeShot({ order: 0, durationMs: 2000, title: "正常镜头一", seed: 201 }),
    makeShot({ order: 1, durationMs: 1000, title: "正常镜头二", seed: 202 }),
  ],
});
const fixtureBFile = writeFixture(fixtureB, "zero-frame-b");
await gotoWorkbench("B1 回到工作台");
await importFixture(fixtureBFile, "B2 导入夹具 B");

const bShot1 = cardAt(0);
await bShot1.locator(".shot-edit-toggle").click();
await bShot1.locator(".shot-duration-input").fill("0.001");
await bShot1.locator(".shot-apply").click();
await expectVisibleScoped(
  bShot1.locator(".shot-edit-error"),
  "B3 零帧反例被拦",
  ".shot-edit-error",
);
const bError = await bShot1.locator(".shot-edit-error").textContent();
if (!bError?.startsWith("无法应用："))
  fail("B3 零帧反例被拦", `错误文案不以「无法应用：」开头: ${bError}`);
const bMessage = await page.locator(".editor-message").textContent();
if (bMessage?.includes("镜头 1 已修订"))
  fail("B3 零帧反例被拦", `零帧草稿仍被应用: ${bMessage}`);
console.log(
  `[e2e-zero-frame-repair] B3 反例被拦：${bError?.trim()}（提示仍为「${bMessage?.trim()}」）`,
);

await page.click(".editor-save");
await waitForMessage("已保存", "B4 保存");
const exportedB = await exportJson(
  "B4 导出",
  path.join(OUT_DIR, "b-blocked.video-project.json"),
);
const bWorking = workingVersion(exportedB, 0);
if (bWorking?.durationMs !== 2000)
  fail("B4 导出", `镜头 1 工作版本时长 ${bWorking?.durationMs} ≠ 2000`);
if (
  bWorking?.sceneSource.type === "spec" &&
  bWorking.sceneSource.spec.durationMs !== 2000
)
  fail(
    "B4 导出",
    `镜头 1 spec.durationMs ${bWorking.sceneSource.spec.durationMs} ≠ 2000`,
  );
console.log(
  "[e2e-zero-frame-repair] B4 保存/导出：非法草稿未进文档，镜头 1 仍为 2000ms",
);

// ============================== 步骤 C ==============================
const fixtureC = JSON.parse(readFileSync(THREE_FIXTURE, "utf8"));
fixtureC.id = randomUUID();
fixtureC.title = "零帧 3D 镜头修复回归 C";
const threeWorking = fixtureC.shots[0].contentVersions.find(
  (version) => version.versionId === fixtureC.shots[0].workingVersionId,
);
if (threeWorking?.sceneSource.type !== "three")
  fail("C1 构造夹具", "three-sample 镜头 1 工作版本不是 three 场景源");
threeWorking.durationMs = 1;
threeWorking.sceneSource.spec.durationMs = 1;
const fixtureCFile = writeFixture(fixtureC, "zero-frame-c");
console.log(
  `[e2e-zero-frame-repair] 夹具 C 通过 validateVideoProject（three 1ms）：${fixtureCFile}`,
);

await gotoWorkbench("C1 回到工作台");
await importFixture(fixtureCFile, "C2 导入夹具 C");

const cShot1 = cardAt(0);
await cShot1.locator(".shot-edit-toggle").click();
const cTemplate = await cShot1.locator(".chart-template-select").inputValue();
if (cTemplate !== "three-3d")
  fail("C3 3D 编辑臂", `模板下拉值 ${cTemplate} ≠ three-3d`);
await expectVisibleScoped(
  cShot1.locator(".shot-duration-input"),
  "C3 3D 编辑臂",
  "卡片内 .shot-duration-input",
);
console.log(
  "[e2e-zero-frame-repair] C3 1ms 3D 镜头进编辑态：模板保持 3D，时长输入可见",
);

await cShot1.locator(".shot-duration-input").fill("2");
await cShot1.locator(".shot-apply").click();
await waitForMessage("镜头 1 已修订", "C4 3D 镜头改时长");
const exportedC = await exportJson(
  "C5 导出",
  path.join(OUT_DIR, "c-three-after-fix.video-project.json"),
);
const cWorking = workingVersion(exportedC, 0);
if (cWorking?.sceneSource.type !== "three")
  fail("C5 导出", `场景源类型 ${cWorking?.sceneSource.type} ≠ three`);
if (cWorking.durationMs !== 2000)
  fail("C5 导出", `版本时长 ${cWorking.durationMs} ≠ 2000`);
if (cWorking.sceneSource.spec.durationMs !== 2000)
  fail(
    "C5 导出",
    `spec.durationMs ${cWorking.sceneSource.spec.durationMs} ≠ 2000`,
  );
if (cWorking.sceneSource.spec.componentId !== "orbit3d")
  fail("C5 导出", `组件 ${cWorking.sceneSource.spec.componentId} ≠ orbit3d`);
console.log(
  `[e2e-zero-frame-repair] C4/C5 3D 镜头修复：type=three，组件=${cWorking.sceneSource.spec.componentId}，版本/spec 时长同步 2000ms`,
);

// ============================== 收尾断言 ==============================
await page.screenshot({
  path: path.join(OUT_DIR, "zero-frame-repair.png"),
  fullPage: true,
});

if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  "[e2e-zero-frame-repair] OK: A 零帧逐个修复+持久化、B 零帧反例被拦、C 1ms 3D 时长修复，全部成立",
);
console.log(
  `[e2e-zero-frame-repair] 控制台 error 0 条；tts-usage.jsonl ${usageBefore} → ${usageAfter} 行（零 TTS）`,
);
console.log("[e2e-zero-frame-repair] 逐步骤摘要：");
console.log(
  "  A PASS 导入 2×1ms → 卡保留/降级 → 逐镜头改 2s → 96 帧 → 保存 v2 → 重开 96 帧",
);
console.log("  B PASS 合法项目改 0.001s → 「无法应用：…」→ 文档仍 2000ms");
console.log(
  "  C PASS 1ms three 镜头时长输入可见 → 改 2s → 仍为 three，spec 同步 2000ms",
);
