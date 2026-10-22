#!/usr/bin/env node
// 关键镜头双候选浏览器回归（真实工作台链路，零 TTS 计费）：
//   导入 2 镜头项目 → 镜头 1 重做出第二个内容版本 → 打开「对比候选」看到两列
//   （说明不同、时长不同、整片帧数 before → after）→ 锁定镜头后选用原拍法 #1
//   （人工路径允许）→ 保存 → 刷新、从项目列表重开后仍是 #1 → 导出文档校验
//   工作指针/版本数/事件，并断言两列下拉互相排除。
// 前置: @acs/web dev server 已在 BASE_URL（建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build。
// exit 0 = 全部步骤成立；任何一步失败 exit 1 并打印步骤名。
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-candidate-compare");
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const CREATED_AT = "2026-10-22T00:00:00.000Z";

const { validateVideoProject } = await import(
  pathToFileURL(path.join(ROOT, "packages/video-document/dist/index.js")).href
);

function fail(step, detail) {
  console.error(`[e2e-candidate-compare] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(locator, step, label) {
  return locator
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${label}`));
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

// —— 夹具：2 镜头 × 2000ms，text-animation spec，人工 submitted ——
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
      subtitle: "候选对比回归",
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
        description: `夹具镜头 ${order + 1}`,
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
function writeFixture(project) {
  validateVideoProject(project);
  const file = path.join(os.tmpdir(), `acs-candidate-${project.id}.json`);
  writeFileSync(file, JSON.stringify(project, null, 2));
  return file;
}

mkdirSync(OUT_DIR, { recursive: true });
const EXPORT_FILE = path.join(OUT_DIR, "export.video-project.json");
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

async function gotoWorkbench(step) {
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail(step, "客户端未就绪（data-studio-ready 未出现）"));
}

const fixture = makeProject({
  title: "关键镜头双候选回归",
  sentence: "回归：重做产生候选 → 对比 → 锁定下选用原拍法 → 持久化",
  shots: [
    makeShot({ order: 0, durationMs: 2000, title: "月洞门外推进", seed: 401 }),
    makeShot({ order: 1, durationMs: 2000, title: "荷塘日落", seed: 402 }),
  ],
});
const fixtureFile = writeFixture(fixture);
console.log(
  `[e2e-candidate-compare] 夹具通过 validateVideoProject：${fixtureFile}`,
);

// ============================== 步骤 1 ==============================
await gotoWorkbench("1 打开工作台");
await expectVisible(
  page.locator(".project-import"),
  "1 打开工作台",
  ".project-import",
);
await page.locator('input[type="file"]').setInputFiles(fixtureFile);
await waitForMessage("已导入", "1 导入夹具");
await expectVisible(
  page.locator(".editor-shots"),
  "1 导入夹具",
  ".editor-shots",
);
const cardCount = await page.locator(".shot-list > li").count();
if (cardCount !== 2) fail("1 导入夹具", `镜头卡数量 ${cardCount} ≠ 2`);
console.log("[e2e-candidate-compare] 1 PASS 导入 2 镜头项目");

// ============================== 步骤 2 ==============================
const shot1 = cardAt(0);
await shot1.locator(".shot-edit-toggle").click();
await shot1
  .locator(".shot-redo-input")
  .fill("做一个6秒的图形动画，标题是候选对比");
await shot1.locator(".shot-redo-button").click();
await waitForMessage("镜头 1 已重做", "2 重做产生候选");
const optionsAfterRedo = await shot1
  .locator(".shot-version-select option")
  .allTextContents();
if (optionsAfterRedo.length !== 2)
  fail("2 重做产生候选", `版本数 ${optionsAfterRedo.length} ≠ 2`);
const workingAfterRedo = await shot1
  .locator(".shot-version-select")
  .inputValue();
const workingText = optionsAfterRedo[1] ?? "";
if (!workingText.includes("（工作）"))
  fail("2 重做产生候选", `重做后工作版本不在 #2: ${workingText}`);
console.log(
  `[e2e-candidate-compare] 2 PASS 重做产生候选：版本 ${optionsAfterRedo.length} 个，工作版本 ${workingAfterRedo}（#2 6s）`,
);

// ============================== 步骤 3 ==============================
await shot1.locator(".shot-compare-toggle").click();
await expectVisible(
  shot1.locator(".shot-compare-panel"),
  "3 对比面板",
  ".shot-compare-panel",
);
const columns = shot1.locator(".shot-compare-column");
if ((await columns.count()) !== 2)
  fail("3 对比面板", `列数 ${await columns.count()} ≠ 2`);
const leftText = await columns.nth(0).textContent();
const rightText = await columns.nth(1).textContent();
if (!leftText?.includes("当前"))
  fail("3 对比面板", `左列（工作版本）未显示「当前」: ${leftText}`);
if (!/\d+ → \d+ 帧/.test(rightText ?? ""))
  fail("3 对比面板", `右列未显示 before → after 帧数: ${rightText}`);
const descriptions = [
  (await columns.nth(0).locator(".shot-compare-description").textContent()) ??
    "",
  (await columns.nth(1).locator(".shot-compare-description").textContent()) ??
    "",
];
if (descriptions[0] === descriptions[1])
  fail("3 对比面板", `两列说明相同，无法比较: ${descriptions[0]}`);
console.log(
  `[e2e-candidate-compare] 3 PASS 两列对比：左「${leftText?.replace(/\s+/g, " ").trim()}」右「${rightText?.replace(/\s+/g, " ").trim()}」`,
);

// 两列下拉互斥：右列选项不含左列当前值，反之亦然。
const leftSelect = columns.nth(0).locator(".shot-compare-select");
const rightSelect = columns.nth(1).locator(".shot-compare-select");
const leftValue = await leftSelect.inputValue();
const rightValue = await rightSelect.inputValue();
const rightOptions = await rightSelect
  .locator("option")
  .evaluateAll((nodes) => nodes.map((node) => node.value));
const leftOptions = await leftSelect
  .locator("option")
  .evaluateAll((nodes) => nodes.map((node) => node.value));
if (rightOptions.includes(leftValue))
  fail("3 对比面板", "右列下拉包含左列当前版本");
if (leftOptions.includes(rightValue))
  fail("3 对比面板", "左列下拉包含右列当前版本");

// ============================== 步骤 4 ==============================
await shot1.locator(".shot-lock-toggle input").check();
await expectVisible(
  page.locator(".shot-order", { hasText: "锁定" }).first(),
  "4 锁定镜头",
  ".shot-order（含锁定）",
);
await columns.nth(1).locator(".shot-compare-choose").click();
await waitForMessage("已回滚到所选版本", "4 选用原拍法");
const optionsAfterChoose = await shot1
  .locator(".shot-version-select option")
  .allTextContents();
if (!optionsAfterChoose[0]?.includes("（工作）"))
  fail(
    "4 选用原拍法",
    `选用后 #1 未标（工作）: ${optionsAfterChoose.join(" | ")}`,
  );
const lockChecked = await shot1.locator(".shot-lock-toggle input").isChecked();
if (!lockChecked) fail("4 选用原拍法", "选用后镜头被意外解锁");
console.log(
  "[e2e-candidate-compare] 4 PASS 锁定下选用原拍法 #1（工作），锁定状态保留",
);

// ============================== 步骤 5 ==============================
await page.click(".editor-save");
await waitForMessage("已保存", "5 保存");
await page.reload({ waitUntil: "domcontentloaded" });
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("5 重新打开", "重载后客户端未就绪"));
await expectVisible(
  page.locator(".project-table"),
  "5 重新打开",
  ".project-table",
);
const row = page
  .locator(".project-table tbody tr", { hasText: fixture.title })
  .first();
await row
  .waitFor({ state: "visible", timeout: 10_000 })
  .catch(() => fail("5 重新打开", `项目列表找不到「${fixture.title}」`));
await row.locator(".project-open").click();
await expectVisible(
  page.locator(".editor-shots"),
  "5 重新打开",
  ".editor-shots",
);
const reopened = cardAt(0);
const reopenedOptions = await reopened
  .locator(".shot-version-select option")
  .allTextContents();
if (reopenedOptions.length !== 2)
  fail("5 重新打开", `重开后版本数 ${reopenedOptions.length} ≠ 2`);
if (!reopenedOptions[0]?.includes("（工作）"))
  fail("5 重新打开", `重开后工作版本不是 #1: ${reopenedOptions.join(" | ")}`);
if (!(await reopened.locator(".shot-lock-toggle input").isChecked()))
  fail("5 重新打开", "重开后锁定状态丢失");
console.log(
  "[e2e-candidate-compare] 5 PASS 保存/刷新/重开：工作版本仍为 #1，锁定保留",
);

// 重开后对比面板仍可开，默认对回到「#1 + #2」。
await reopened.locator(".shot-compare-toggle").click();
await expectVisible(
  reopened.locator(".shot-compare-panel"),
  "5 重新打开",
  "重开后的 .shot-compare-panel",
);
const reopenedColumns = reopened.locator(".shot-compare-column");
const reopenedWorkingId = await reopened
  .locator(".shot-version-select")
  .inputValue();
const reopenedLeft = await reopenedColumns
  .nth(0)
  .locator(".shot-compare-select")
  .inputValue();
if (reopenedLeft !== reopenedWorkingId)
  fail("5 重新打开", "重开后对比面板左列不是工作版本");
await reopened.locator(".shot-compare-toggle").click();

// ============================== 步骤 6 ==============================
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORT_FILE);
if (!existsSync(EXPORT_FILE)) fail("6 导出", "下载文件未落盘");
const exported = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
validateVideoProject(exported);
const exportedShot = exported.shots[0];
if (exportedShot.contentVersions.length !== 2)
  fail("6 导出", `版本数 ${exportedShot.contentVersions.length} ≠ 2`);
if (exportedShot.workingVersionId !== exportedShot.contentVersions[0].versionId)
  fail("6 导出", "工作版本不是原拍法 #1");
if (!exportedShot.locked) fail("6 导出", "锁定状态未落库");
const kinds = exportedShot.events.map((event) => event.kind);
if (!kinds.includes("lock-changed")) fail("6 导出", "缺少 lock-changed 事件");
if (
  !exportedShot.events.some(
    (event) => event.kind === "audit" && event.note === "回滚工作版本",
  )
)
  fail("6 导出", "缺少「回滚工作版本」audit 事件");
if (kinds.includes("approved"))
  fail("6 导出", "选用候选不应产生 approved 事件");
if (exported.savedVersion !== 2)
  fail("6 导出", `savedVersion ${exported.savedVersion} ≠ 2`);
console.log(
  `[e2e-candidate-compare] 6 PASS 导出校验：working=#1，2 个版本，lock-changed + audit 留痕，无 approved，v${exported.savedVersion}`,
);

// ============================== 步骤 7 ==============================
// 零帧候选必须挡在选用之前：合法项目里加一个 1ms 的非工作候选，选它会把
// 整片变成不可量化（镜头 1 零帧），UI 必须显示「无法应用：」且文档不变。
const blockedFixture = makeProject({
  title: "候选零帧拦截回归",
  sentence: "回归：零帧候选不得进入工作版本",
  shots: [
    makeShot({ order: 0, durationMs: 2000, title: "正常镜头", seed: 501 }),
    makeShot({ order: 1, durationMs: 2000, title: "正常镜头二", seed: 502 }),
  ],
});
const blockedShot = blockedFixture.shots[0];
const zeroCandidate = {
  ...blockedShot.contentVersions[0],
  versionId: randomUUID(),
  durationMs: 1,
  description: "零帧候选拍法",
  sceneSource: {
    type: "spec",
    spec: textSpec({ durationMs: 1, title: "零帧候选", seed: 511 }),
  },
};
blockedShot.contentVersions.push(zeroCandidate);
blockedShot.events.push({
  kind: "submitted",
  versionId: zeroCandidate.versionId,
  at: CREATED_AT,
  actor: "ai",
});
const blockedFile = writeFixture(blockedFixture);
await gotoWorkbench("7 零帧候选拦截");
await page.locator('input[type="file"]').setInputFiles(blockedFile);
await waitForMessage("已导入", "7 零帧候选拦截");
const blockedCard = cardAt(0);
await blockedCard.locator(".shot-compare-toggle").click();
await expectVisible(
  blockedCard.locator(".shot-compare-panel"),
  "7 零帧候选拦截",
  ".shot-compare-panel",
);
const blockedColumns = blockedCard.locator(".shot-compare-column");
const blockedRightText = await blockedColumns.nth(1).textContent();
if (!blockedRightText?.includes("不可量化"))
  fail("7 零帧候选拦截", `零帧候选列未标注不可量化: ${blockedRightText}`);
await blockedColumns.nth(1).locator(".shot-compare-choose").click();
await expectVisible(
  blockedCard.locator(".shot-edit-error"),
  "7 零帧候选拦截",
  ".shot-edit-error",
);
const blockedError = await blockedCard
  .locator(".shot-edit-error")
  .textContent();
if (!blockedError?.startsWith("无法应用："))
  fail("7 零帧候选拦截", `错误文案不以「无法应用：」开头: ${blockedError}`);
const blockedMessage = await page.locator(".editor-message").textContent();
if (blockedMessage?.includes("已回滚到所选版本"))
  fail("7 零帧候选拦截", `零帧候选仍被落库: ${blockedMessage}`);
// 原有版本下拉也是选版本入口，必须与对比面板共用闸门。
await blockedCard
  .locator(".shot-version-select")
  .selectOption(zeroCandidate.versionId);
await blockedCard.locator(".shot-rollback").click();
await waitForMessage("无法应用：", "7 旧版回滚入口拦截");
const blockedExport = path.join(OUT_DIR, "blocked.video-project.json");
const [blockedDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 15_000 }),
  page.click(".editor-export"),
]);
await blockedDownload.saveAs(blockedExport);
const blockedExported = JSON.parse(readFileSync(blockedExport, "utf8"));
validateVideoProject(blockedExported);
const blockedWorking = blockedExported.shots[0].contentVersions.find(
  (version) => version.versionId === blockedExported.shots[0].workingVersionId,
);
if (blockedWorking?.durationMs !== 2000)
  fail("7 零帧候选拦截", `工作版本时长 ${blockedWorking?.durationMs} ≠ 2000`);
if (blockedExported.shots[0].events.length !== blockedShot.events.length)
  fail("7 零帧候选拦截", "被拒后仍追加了事件");
console.log(
  `[e2e-candidate-compare] 7 PASS 对比与旧版回滚入口均拦截零帧候选：${blockedError?.trim()}（工作版本仍 2000ms）`,
);

// ============================== 收尾断言 ==============================
await page.screenshot({
  path: path.join(OUT_DIR, "candidate-compare.png"),
  fullPage: true,
});

if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  "[e2e-candidate-compare] OK: 重做产生候选 → 两列对比 → 锁定下选用 → 保存/重开持久化，全部成立",
);
console.log(
  `[e2e-candidate-compare] 控制台 error 0 条；tts-usage.jsonl ${usageBefore} → ${usageAfter} 行（零 TTS）`,
);
