#!/usr/bin/env node
// P1 分镜编辑器端到端闭环验收（真实工作台链路，零 TTS 计费）：
//   浏览器新建→STEM 分镜（4 镜头）→保存→导出基线 JSON
//   →镜头 2 旁白修订（submitted human，历史版本字节不变，预览字幕随之变化）
//   →镜头 1 背景+时长修订（spec 字段与版本时长同步，时间线重量化）
//   →镜头 3（basic-shapes）换模板（seed+1）
//   →锁镜头 1：重做被拒（文案指路解锁）→解锁；镜头 4 重做成（submitted ai，旁白继承）
//   →锁镜头 1：人工修订仍可用（audit 事件留痕）
//   →镜头 2 回滚到 v1 →保存→导出终版 JSON（结构断言）
//   →CLI render-scene 渲染冒烟（RenderRecord×8 回写）→截图+控制台零 error。
// 前置: @acs/web dev server 已在 BASE_URL（建议经 scripts/dev/proxy-3211.mjs）；
//       packages/{video-document,video-scene} 已 build。
// exit 0 = 闭环成立；任何一步失败 exit 1 并打印步骤名。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-shot-editor");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";
const SHOT_COUNT = 4;
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");

function fail(step, detail) {
  console.error(`[e2e-shot-editor] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(page, selector, step) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${selector}`));
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

// 暂停整片预览并把滑杆设到指定帧（React 受控 range 需走原型 setter + input 事件）。
async function setPreviewFrame(page, frame) {
  await page.evaluate((value) => {
    const slider = document.querySelector(".preview-slider");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);
}

// 采样镜头 2 相位（帧 48..121）的字幕药丸文本集合。
async function sampleShot2Subtitles(page) {
  const texts = [];
  for (const frame of [50, 85, 119]) {
    await setPreviewFrame(page, frame);
    const pill = page.locator(".preview-subtitle span");
    texts.push(
      (await pill.count()) > 0
        ? ((await pill.first().textContent()) ?? "")
        : "",
    );
  }
  return texts;
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

// —— 去程：新建 → 分镜规划 → 确认卡 → 追加应用 → 保存 → 导出基线 ——
await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await expectVisible(page, ".project-create", "打开工作台");
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await expectVisible(page, ".storyboard-card", "分镜确认卡");
await page.click(".plan-apply");
await waitForMessage("首个 4 个镜头", "追加应用");
await expectVisible(page, ".editor-shots", "镜头时间线");
const baseline = await (async () => {
  await page.click(".editor-save");
  await waitForMessage("已保存", "保存基线");
  return exportJson("导出基线", `${OUT_DIR}/baseline.video-project.json`);
})();
const projectId = baseline.id;
const originalVersionIds = baseline.shots.map((shot) => shot.workingVersionId);
// speech-aware 规划：[2000,3100,2000,2000]ms → 218 帧 @24fps
const baselineTotalFrames = 218;
const headerText = await page.locator(".editor-shots h3").textContent();
if (!headerText?.includes(`${baselineTotalFrames} 帧`))
  fail("基线时间线", `总帧数文案不含 218: ${headerText}`);
console.log(
  `[e2e-shot-editor] 基线完成: 项目 ${projectId} v${baseline.savedVersion}，4 镜头 218 帧`,
);

// —— 1. 镜头 2 旁白修订（含字幕跟随断言）——
const shot2 = cardAt(1);
await shot2.locator(".shot-edit-toggle").click();
await shot2.locator(".shot-narration-input").fill("水循环，三个要点。");
// 修订前字幕采样：镜头 2 相位出现「要点 1」
await page.click(".preview-toggle"); // 暂停播放再采样，避免相位漂移
const subtitlesBefore = await sampleShot2Subtitles(page);
if (!subtitlesBefore.some((text) => text.includes("要点 1")))
  fail("字幕跟随(前)", `采样未见 要点 1: ${subtitlesBefore.join(" | ")}`);
await shot2.locator(".shot-apply").click();
await waitForMessage("镜头 2 已修订", "旁白修订");
const subtitlesAfter = await sampleShot2Subtitles(page);
if (subtitlesAfter.some((text) => text.includes("要点 1")))
  fail("字幕跟随(后)", `修订后仍见 要点 1: ${subtitlesAfter.join(" | ")}`);
if (!subtitlesAfter.some((text) => text.includes("三个要点")))
  fail("字幕跟随(后)", `采样未见 三个要点: ${subtitlesAfter.join(" | ")}`);
const narrationOnCard = await shot2.locator(".shot-narration").textContent();
if (!narrationOnCard?.includes("三个要点"))
  fail("旁白修订", `镜头卡旁白未更新: ${narrationOnCard}`);
console.log(
  "[e2e-shot-editor] 旁白修订: 字幕单一事实源跟随成立（要点 1 → 三个要点）",
);

// —— 2. 镜头 1 背景 + 时长修订（时间线重量化）——
const shot1 = cardAt(0);
await shot1.locator(".shot-edit-toggle").click();
await shot1.locator(".shot-bg-input").fill("#102030");
await shot1.locator(".shot-duration-input").fill("3.5");
await shot1.locator(".shot-apply").click();
await waitForMessage("镜头 1 已修订", "画面修订");
const headerAfter = await page.locator(".editor-shots h3").textContent();
if (!headerAfter?.includes("254 帧"))
  fail("时间线重量化", `总帧数文案不含 254: ${headerAfter}`);
const firstSpan = await page.locator(".timeline-span").first().textContent();
if (!firstSpan?.includes("84帧"))
  fail("时间线重量化", `镜头 1 span 未变 84帧: ${firstSpan}`);
console.log(
  "[e2e-shot-editor] 画面修订: 背景 #102030 + 时长 3.5s，218 → 254 帧",
);

// —— 3. 镜头 3（basic-shapes 示意）换模板 ——
const shot3 = cardAt(2);
await shot3.locator(".shot-edit-toggle").click();
await shot3.locator(".shot-template-button").click();
await shot3.locator(".shot-apply").click();
await waitForMessage("镜头 3 已修订", "换模板");
console.log("[e2e-shot-editor] 换模板: 镜头 3 seed+1");

// —— 4. 锁定语义：锁定拒机器重做，解锁后重做成 ——
await shot1.locator(".shot-lock-toggle input").check();
await waitForMessage("镜头 1 已锁定", "锁定");
await shot1
  .locator(".shot-redo-input")
  .fill("做一个10秒的图形动画，标题是循环");
await shot1.locator(".shot-redo-button").click();
await shot1
  .locator(".shot-redo-error", { hasText: "解锁" })
  .waitFor({ timeout: 10_000 })
  .catch(() => fail("锁定重做被拒", "未出现含「解锁」的拒绝文案"));
await shot1.locator(".shot-lock-toggle input").uncheck();
await waitForMessage("镜头 1 已解锁", "解锁");
const shot4 = cardAt(3);
await shot4.locator(".shot-edit-toggle").click();
await shot4
  .locator(".shot-redo-input")
  .fill("做一个10秒的图形动画，标题是循环");
await shot4.locator(".shot-redo-button").click();
await waitForMessage("镜头 4 已重做（循环）", "单镜头重做");
const shot4Narration = await shot4.locator(".shot-narration").textContent();
if (!shot4Narration?.includes("谢谢观看"))
  fail("单镜头重做", `旁白未继承: ${shot4Narration}`);
console.log("[e2e-shot-editor] 重做: 锁定拒 → 解锁后镜头 4 重做成（旁白继承）");

// —— 5. 锁定下人工修订（ADR 0003 §1.3：audit 留痕）——
await shot1.locator(".shot-lock-toggle input").check();
await waitForMessage("镜头 1 已锁定", "再锁定");
await shot1.locator(".shot-narration-input").fill("锁定下的人工修订。");
await shot1.locator(".shot-apply").click();
await waitForMessage("镜头 1 已修订", "锁定下人工修订");
console.log("[e2e-shot-editor] 锁定下人工修订: 可用（audit 事件由导出件断言）");

// —— 6. 镜头 2 回滚到 v1 ——
await shot2.locator(".shot-version-select").selectOption({ index: 0 });
await shot2.locator(".shot-rollback").click();
await waitForMessage("镜头 2 已回滚", "回滚");
const rolledNarration = await shot2.locator(".shot-narration").textContent();
if (!rolledNarration?.includes("要点 1"))
  fail("回滚", `镜头卡旁白未回到 v1: ${rolledNarration}`);
console.log("[e2e-shot-editor] 回滚: 镜头 2 工作指针回到 v1");

// —— 7. 保存 + 导出终版 + 结构断言 ——
await page.click(".editor-save");
await waitForMessage("已保存", "保存终版");
const exported = await exportJson("导出终版", EXPORTED);
if (exported.id !== projectId) fail("导出终版", "项目 ID 被改写");

for (const [index, versionId] of originalVersionIds.entries()) {
  const kept = exported.shots[index].contentVersions.some(
    (version) => version.versionId === versionId,
  );
  if (!kept) fail("版本贯穿", `镜头 ${index + 1} 初始版本 ${versionId} 丢失`);
}

const [s1, s2, s3, s4] = exported.shots;
// 镜头 1：v2 画面修订 + v3 锁定下旁白修订（audit 在）
if (s1.contentVersions.length !== 3)
  fail("镜头 1", `版本数 ${s1.contentVersions.length} ≠ 3`);
const s1v2 = s1.contentVersions[1];
if (s1v2.sceneSource.spec.background !== "#102030")
  fail("镜头 1", `v2 背景未改: ${s1v2.sceneSource.spec.background}`);
if (s1v2.durationMs !== 3500 || s1v2.sceneSource.spec.durationMs !== 3500)
  fail("镜头 1", "v2 版本时长与 spec 时长未同步 3500");
const s1v3 = s1.contentVersions[2];
if (s1v3.narrationText !== "锁定下的人工修订。")
  fail("镜头 1", `v3 旁白不符: ${s1v3.narrationText}`);
if (s1v3.durationMs !== 3500)
  fail("镜头 1", `v3 时长未继承画面修订: ${s1v3.durationMs}`);
const s1events = s1.events.map((event) => event.kind);
if (!s1events.includes("audit")) fail("镜头 1", "锁定下人工修订缺 audit 事件");
if (s1.workingVersionId !== s1v3.versionId) fail("镜头 1", "工作指针未指向 v3");
// 锁定事件留痕
if (!s1events.includes("lock-changed")) fail("镜头 1", "缺 lock-changed 事件");

// 镜头 2：v1 原文不变 + v2 修订在，工作指针回 v1
if (s2.contentVersions.length !== 2)
  fail("镜头 2", `版本数 ${s2.contentVersions.length} ≠ 2`);
if (s2.contentVersions[0].narrationText !== "水循环，要点 1。")
  fail("镜头 2", "v1 历史被改写");
if (s2.contentVersions[1].narrationText !== "水循环，三个要点。")
  fail("镜头 2", "v2 修订丢失");
if (s2.workingVersionId !== s2.contentVersions[0].versionId)
  fail("镜头 2", "工作指针未回滚到 v1");
const s2last = s2.events.at(-1);
if (s2last.kind !== "audit")
  fail("镜头 2", `回滚后末事件应为 audit: ${s2last.kind}`);

// 镜头 3：seed+1
const s3v2 = s3.contentVersions[1];
const seedBefore = s3.contentVersions[0].sceneSource.spec.seed;
if (s3v2.sceneSource.spec.seed !== seedBefore + 1)
  fail(
    "镜头 3",
    `v2 seed 未 +1: ${s3v2.sceneSource.spec.seed} vs ${seedBefore}`,
  );

// 镜头 4：重做 = submitted ai，旁白继承，basic-shapes 10s
if (s4.contentVersions.length !== 2)
  fail("镜头 4", `版本数 ${s4.contentVersions.length} ≠ 2`);
const s4v2 = s4.contentVersions[1];
if (s4v2.sceneSource.spec.componentId !== "basic-shapes")
  fail("镜头 4", "重做后组件不是 basic-shapes");
if (s4v2.durationMs !== 10000)
  fail("镜头 4", `重做时长 ≠ 10000: ${s4v2.durationMs}`);
if (s4v2.narrationText !== "谢谢观看。") fail("镜头 4", "重做旁白未继承");
if (s4v2.provenance.parentVersionId !== s4.contentVersions[0].versionId)
  fail("镜头 4", "重做缺 parentVersionId");
const s4last = s4.events.at(-1);
if (!(s4last.kind === "submitted" && s4last.actor === "ai"))
  fail("镜头 4", `重做末事件应为 submitted(ai): ${JSON.stringify(s4last)}`);

// brief.applications 不受编辑影响
if (
  (exported.brief.applications ?? []).length !==
  (baseline.brief.applications ?? []).length
)
  fail("brief", "applications 条目被编辑路径改动");
console.log("[e2e-shot-editor] 终版断言: 版本演化/事件序/锁定语义全部成立");

// —— 8. CLI 渲染冒烟（零计费，无 --narration）——
const render = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts/video/render-scene.mjs"),
    "--project",
    EXPORTED,
    "--out",
    path.join(OUT_DIR, "e2e-render"),
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
);
if (render.status !== 0)
  fail("CLI 渲染冒烟", `${render.stdout ?? ""}\n${render.stderr ?? ""}`);
const rendered = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (rendered.savedVersion !== exported.savedVersion + 1)
  fail("CLI 渲染冒烟", "savedVersion 未 +1");
if (rendered.renderRecords.length !== exported.renderRecords.length + 8)
  fail("CLI 渲染冒烟", "RenderRecord 未 +8");
console.log(
  `[e2e-shot-editor] 渲染冒烟: v${rendered.savedVersion}，RenderRecord ×${rendered.renderRecords.length}`,
);

// —— 9. 截图 + 控制台门禁 + 计费不变 ——
await page.screenshot({
  path: path.join(OUT_DIR, "shot-editor-card.png"),
  fullPage: true,
});
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
const usageAfter = usageLines();
if (usageAfter !== usageBefore)
  fail("计费", `tts-usage.jsonl 行数变化 ${usageBefore} → ${usageAfter}`);

await browser.close();
console.log(
  `[e2e-shot-editor] OK: 项目 ${projectId} 修订/重做/锁定/回滚全链路，渲染冒烟通过，计费零新增`,
);
console.log("[e2e-shot-editor] SHA-256:");
for (const name of [
  "e2e.video-project.json",
  "e2e-render/landscape.mp4",
  "e2e-render/portrait.mp4",
  "shot-editor-card.png",
]) {
  console.log(`  ${name}: ${sha256(path.join(OUT_DIR, name))}`);
}
