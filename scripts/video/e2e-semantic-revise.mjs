#!/usr/bin/env node
// N2（交接单 2026-10-27）：单镜自然语言修改全链验收（真实千问）。
//   语义分镜出片 → 定位「凝结」镜 → AI 修改候选（预览屏幕文字/旁白/时长/
//   整片影响）→ 确认落新版本：前后镜版本不变、目标镜 +1 版本且
//   parentVersionId=旧工作版本 → 卡片画面前后证据 → 有声出片取新版本
//   （manifest narration.versionId 对账）→ 保存重开 → 锁定拒绝 →
//   版本冲突闸（候选后镜头被改→拒绝）→ 回滚恢复。
// 前置: dev server 已在 BASE_URL（默认 :3224）且配置 DASHSCOPE_API_KEY。
// exit 0 = 验收成立。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3224";
const out = path.join(root, "artifacts/video-studio-semantic-revise");
const SENTENCE =
  "做一条约25秒的水循环科普短片，讲清蒸发、凝结和降水";
const REVISE_INSTRUCTION =
  "把这一镜改成凝结过程，强调水汽遇冷形成云；旁白也同步修改";

function fail(step, detail) {
  console.error(`[e2e-semantic-revise] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })
).newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function exportProject(name) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.click(".editor-export"),
  ]);
  const file = path.join(out, name);
  await download.saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
}

try {
  // —— A. 语义分镜 → 应用 → 保存 ——
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail("打开工作台", "客户端未就绪"));
  await page.click(".project-create");
  await page.fill("#planner-sentence", SENTENCE);
  await page.click(".planner-ai");
  await page
    .locator(".storyboard-card")
    .first()
    .waitFor({ timeout: 90_000 })
    .catch(() => fail("AI 生成", "确认卡未出现"));
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("追加应用", "未出现应用提示"));
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("保存", "未出现保存提示"));

  // —— B. 定位「凝结」镜 + 修改前快照 ——
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  const cardCount = await page.locator(".shot-card").count();
  const cardTexts = [];
  for (let i = 0; i < cardCount; i++)
    cardTexts.push(await page.locator(".shot-card").nth(i).textContent());
  const targetIndex = cardTexts.findIndex((t) => /凝结/.test(t ?? ""));
  if (targetIndex < 0)
    fail("定位凝结镜", `卡文本未见凝结：${cardTexts.map((t) => t?.slice(0, 30))}`);
  const targetCard = page.locator(".shot-card").nth(targetIndex);
  await targetCard.locator(".shot-edit-toggle").click();
  // 修改前画面证据（卡片预览区）。
  await targetCard
    .locator(".scene-preview, svg")
    .first()
    .screenshot({ path: path.join(out, "before-preview.png") })
    .catch(() => targetCard.screenshot({ path: path.join(out, "before-preview.png") }));

  const before = await exportProject("project-before.json");
  const beforeTarget = before.shots[targetIndex];
  const beforeWorkingId = beforeTarget.workingVersionId;
  const beforeVersionCount = beforeTarget.contentVersions.length;

  // —— C. AI 修改此镜头（真实候选 → 预览 → 确认） ——
  await targetCard
    .locator(".shot-ai-revise-row input")
    .fill(REVISE_INSTRUCTION);
  await targetCard.locator(".shot-ai-revise-button").click();
  await targetCard
    .locator(".shot-ai-candidate")
    .waitFor({ timeout: 90_000 })
    .catch(() => fail("AI 修改候选", "候选预览未出现"));
  const candidateText = await targetCard
    .locator(".shot-ai-candidate")
    .textContent();
  for (const word of ["画面类型", "屏幕文字", "旁白", "时长", "整片影响"])
    if (!candidateText?.includes(word))
      fail("候选预览", `缺「${word}」：${candidateText?.slice(0, 160)}`);
  await targetCard.screenshot({
    path: path.join(out, "candidate-preview.png"),
  });
  await targetCard
    .locator(".shot-ai-candidate button", { hasText: "确认应用" })
    .click();
  await page
    .locator(".editor-message", { hasText: "已按 AI 指令修改" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("确认应用", "未出现修改成功提示"));

  // 修改后画面证据 + 导出断言。
  await targetCard.screenshot({ path: path.join(out, "after-card.png") });
  const after = await exportProject("project-after.json");
  const afterTarget = after.shots[targetIndex];
  if (afterTarget.workingVersionId === beforeWorkingId)
    fail("版本演进", "目标镜工作版本未切换");
  if (afterTarget.contentVersions.length !== beforeVersionCount + 1)
    fail(
      "版本演进",
      `内容版本 ${afterTarget.contentVersions.length} ≠ ${beforeVersionCount}+1`,
    );
  const newVersion = afterTarget.contentVersions.find(
    (v) => v.versionId === afterTarget.workingVersionId,
  );
  if (newVersion.provenance.parentVersionId !== beforeWorkingId)
    fail("版本演进", "新版本 parentVersionId 不指向旧工作版本");
  if (newVersion.provenance.engineId !== "planner-semantic-revise")
    fail("provenance", `engineId=${newVersion.provenance.engineId}`);
  if (newVersion.narrationText ===
      beforeTarget.contentVersions.find((v) => v.versionId === beforeWorkingId).narrationText)
    fail("旁白更新", "AI 修改未更新旁白");
  for (const [i, shot] of after.shots.entries()) {
    if (i === targetIndex) continue;
    const b = before.shots[i];
    if (shot.workingVersionId !== b.workingVersionId)
      fail("邻镜不变", `镜 ${i + 1} 工作版本被改动`);
    if (shot.contentVersions.length !== b.contentVersions.length)
      fail("邻镜不变", `镜 ${i + 1} 内容版本数变化`);
  }

  // —— D. 有声出片取新工作版本（manifest 逐镜 versionId 对账） ——
  await page.locator(".editor-render-narrated").click();
  await page
    .locator(".editor-message", { hasText: "有声横竖版视频已生成" })
    .waitFor({ timeout: 300_000 })
    .catch(() => fail("有声出片", "未出现生成完成提示"));
  const hrefs = await page
    .locator(".editor-downloads a")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  const jobId = hrefs[0].split("/").at(-2);
  const manifest = JSON.parse(
    readFileSync(
      path.join(root, ".tools/video-workbench-renders", jobId, "render/render-manifest.json"),
      "utf8",
    ),
  );
  const narrationEntry = manifest.aspects.landscape.narration.find(
    (n) => n.shotIndex === targetIndex,
  );
  if (!narrationEntry || narrationEntry.versionId !== afterTarget.workingVersionId)
    fail(
      "有声取新版本",
      `镜 ${targetIndex + 1} 音轨 versionId ${narrationEntry?.versionId} ≠ 新工作版本`,
    );

  // —— E. 保存重开：修改仍在 ——
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("再保存", "未出现保存提示"));
  await page.click(".project-action");
  await page
    .locator(".project-open")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("返回列表", "列表未出现"));
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  const reopenedText = await page
    .locator(".shot-card")
    .nth(targetIndex)
    .textContent();
  if (!reopenedText?.includes(newVersion.description.slice(0, 8)))
    fail("保存重开", `重开后未见新版本说明：${reopenedText?.slice(0, 60)}`);

  // —— F. 锁定拒绝 ——
  const lockedCard = page.locator(".shot-card").nth(targetIndex);
  await lockedCard.locator(".shot-edit-toggle").click();
  await lockedCard.locator('label:has-text("锁定") input').check();
  await lockedCard
    .locator(".shot-ai-revise-row input")
    .fill("把这一镜再改简洁一点");
  await lockedCard.locator(".shot-ai-revise-button").click();
  await lockedCard
    .locator(".shot-ai-candidate")
    .waitFor({ timeout: 90_000 })
    .catch(() => fail("锁定用例", "候选未出现"));
  await lockedCard
    .locator(".shot-ai-candidate button", { hasText: "确认应用" })
    .click();
  await lockedCard
    .locator(".shot-redo-error", { hasText: "锁定" })
    .waitFor({ timeout: 10_000 })
    .catch(() => fail("锁定用例", "锁定镜头未被拒绝"));
  await lockedCard
    .locator(".shot-ai-candidate button", { hasText: "放弃" })
    .click();
  await lockedCard.locator('label:has-text("锁定") input').uncheck();

  // —— G. 版本冲突闸：候选生成后镜头被改 → 拒绝 ——
  await lockedCard
    .locator(".shot-ai-revise-row input")
    .fill("把这一镜改成三步流程");
  await lockedCard.locator(".shot-ai-revise-button").click();
  await lockedCard
    .locator(".shot-ai-candidate")
    .waitFor({ timeout: 90_000 })
    .catch(() => fail("冲突用例", "候选未出现"));
  // 固定句式重做改变镜头（旧入口回归并存验证）。
  await lockedCard
    .locator(".shot-redo-row input")
    .first()
    .fill("做一个5秒的文字动画，标题是冲突测试");
  await lockedCard
    .locator("button", { hasText: "重做此镜头" })
    .click();
  await page
    .locator(".editor-message", { hasText: "已重做" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("冲突用例", "固定句式重做未生效"));
  await lockedCard
    .locator(".shot-ai-candidate button", { hasText: "确认应用" })
    .click();
  await lockedCard
    .locator(".shot-redo-error", { hasText: "已被修改" })
    .waitFor({ timeout: 10_000 })
    .catch(() => fail("冲突用例", "过期候选未被拒绝"));
  await lockedCard
    .locator(".shot-ai-candidate button", { hasText: "放弃" })
    .click()
    .catch(() => {});

  // —— H. 回滚恢复（回滚到 AI 修改版本之前） ——
  const rollbackCard = page.locator(".shot-card").nth(targetIndex);
  await rollbackCard
    .locator(".shot-version-select")
    .selectOption(beforeWorkingId);
  await rollbackCard.locator(".shot-rollback").click();
  await page
    .locator(".editor-message", { hasText: "已回滚" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("回滚", "未出现回滚提示"));
  const rolled = await exportProject("project-rolled.json");
  if (rolled.shots[targetIndex].workingVersionId !== beforeWorkingId)
    fail("回滚", "工作版本未恢复到修改前");

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        sentence: SENTENCE,
        instruction: REVISE_INSTRUCTION,
        targetIndex,
        beforeWorkingId,
        afterWorkingId: afterTarget.workingVersionId,
        narrationAfter: newVersion.narrationText,
        renderJobId: jobId,
      },
      null,
      2,
    ),
  );
  console.log("[e2e-semantic-revise] OK");
} finally {
  await browser.close();
}
