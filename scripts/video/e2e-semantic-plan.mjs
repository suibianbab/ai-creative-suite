#!/usr/bin/env node
import { mkdirSync } from "node:fs";
// 语义分镜 AI 入口端到端验收（2026-10-26，确定性无密钥路径）：
//   浏览器新建 → 输入自然语言创意 → 点「AI 生成分镜」→ 未配置
//   DASHSCOPE_API_KEY 的 dev server 返回 503 → 界面明示失败原因，
//   不出现占位分镜卡（不静默回退旧规划器）→ 旧固定句式分镜规划照常
//   工作（回归）→ 确认卡 → 放弃 → 控制台无错误。
// 真实千问调用的全链路样片见 audit-semantic-storyboard-live.mjs（另跑，
//   消耗配额、产出 MP4/抽帧证据，不在本档重复）。
// 前置: @acs/web dev server 已在 BASE_URL（默认 http://localhost:3210），
//   且该 server 进程未配置 DASHSCOPE_API_KEY。
// exit 0 = 验收成立；任何一步失败 exit 1 并打印步骤名。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-semantic-plan");
const AI_SENTENCE = "做一条约25秒的水循环科普短片，讲清蒸发、凝结和降水";
const OLD_SENTENCE = "做一个8秒的STEM解说视频，主题是水循环，分4个镜头";

function fail(step, detail) {
  console.error(`[e2e-semantic-plan] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function expectVisible(page, selector, step) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => fail(step, `selector 不可见: ${selector}`));
}

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const consoleErrors = [];
// 预期失败面：无密钥时 /api/video/semantic-plan 返回 503，浏览器会把非 2xx
// fetch 一律记为「Failed to load resource」console 错误（文本不含 URL，无法
// 直接过滤）。用 response 事件对账：该路由实际产生了 N 个 ≥400 响应，就
// 放行恰好 N 行 503 资源日志；其余 console/page 错误仍全量拦截。
let expectedSemanticFailures = 0;
let seenResourceErrors = 0;
page.on("response", (response) => {
  if (
    response.url().includes("/api/video/semantic-plan") &&
    response.status() >= 400
  )
    expectedSemanticFailures += 1;
});
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (
    expectedSemanticFailures > 0 &&
    /Failed to load resource.*[45]\d\d/.test(text)
  ) {
    seenResourceErrors += 1;
    return;
  }
  consoleErrors.push(text.slice(0, 200));
});
page.on("pageerror", (error) =>
  consoleErrors.push(String(error).slice(0, 200)),
);

await page.goto(`${BASE_URL}/video-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page
  .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
  .catch(() => fail("打开工作台", "客户端未就绪（data-studio-ready 未出现）"));
await expectVisible(page, ".project-create", "打开工作台");
await page.click(".project-create");

// —— AI 入口：无密钥 → 明示失败，不回退 ——
await expectVisible(page, ".planner-ai", "AI 生成分镜按钮");
await page.fill("#planner-sentence", AI_SENTENCE);
await page.click(".planner-ai");
await page
  .locator(".planner-feedback", { hasText: "DASHSCOPE_API_KEY" })
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("AI 入口失败面", "未出现缺密钥的错误提示"));
const cardsAfterAiFailure = await page.locator(".storyboard-card").count();
if (cardsAfterAiFailure !== 0)
  fail("AI 入口失败面", "失败后出现了分镜卡（疑似静默回退占位分镜）");

// 明确要求真实照片时先提示能力边界；用户选择图解后才继续请求模型。
await page.fill("#planner-sentence", "用真实产品照片制作一条产品介绍短片");
await page.click(".planner-ai");
await expectVisible(page, ".planner-feedback .planner-ai", "真实素材边界选择");
const needsAssetsText = await page
  .locator(".planner-feedback")
  .first()
  .textContent();
if (!needsAssetsText?.includes("需要真实照片/素材"))
  fail("真实素材边界选择", `缺少明确提示: ${needsAssetsText}`);
await page.locator(".planner-feedback .planner-ai").click();
await page
  .locator(".planner-feedback", { hasText: "DASHSCOPE_API_KEY" })
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("图解授权入口", "授权后未进入模型配置检查"));

// —— 旧固定句式规划回归：照常出确认卡 ——
await page.fill("#planner-sentence", OLD_SENTENCE);
await page.click(".planner-run:not(.planner-ai)");
await expectVisible(page, ".storyboard-card", "旧句式分镜确认卡");
const shotLabels = await page.locator(".plan-shot-label").allTextContents();
if (shotLabels.length !== 4)
  fail("旧句式分镜确认卡", `预告镜头数 ${shotLabels.length} ≠ 4`);
if (!/开场/.test(shotLabels[0] ?? "") || !/结语/.test(shotLabels.at(-1) ?? ""))
  fail("旧句式分镜确认卡", `开场/结语缺失: ${shotLabels.join(" / ")}`);

// —— P1-1 回归（Codex 复核）：新 AI 请求开始即撤销旧候选 ——
// 存量确认卡（无论规则或 AI 产物）在点击 AI 生成的瞬间必须消失：
// 请求期间/失败后旧卡不可再应用，杜绝错标 provenance 的记账路径。
await page.click(".planner-ai");
await page
  .locator(".planner-feedback", { hasText: "DASHSCOPE_API_KEY" })
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("P1-1 撤销旧卡", "第二次 AI 失败提示未出现"));
const cardsAfterSecondAi = await page.locator(".storyboard-card").count();
if (cardsAfterSecondAi !== 0)
  fail("P1-1 撤销旧卡", "AI 请求后旧确认卡仍在（可被错误应用）");

// —— 状态面干净：撤销后页面无残留确认卡 ——
const cardsAfterDiscard = await page.locator(".storyboard-card").count();
if (cardsAfterDiscard !== 0) fail("状态面", "撤销后仍有分镜卡残留");

// —— P2（Codex 二轮复核）：已成功生成 AI 候选 → 第二次请求失败/等待中 ——
// 无密钥 server 上用路由拦截伪造完整生命周期：第一次 AI 调用回合法分镜
// （确认卡出现）→ 第二次调用延迟 1.5s 后 500 → 点击瞬间旧卡即被撤销
// （等待期间不可应用），失败提示出现。
const FAKE_SHOT = (i, label, hint) => ({
  label,
  description: `${label}（拦截样例）`,
  narrationText: `拦截样例旁白${i}`,
  plan: {
    ok: true,
    spec: {
      specVersion: 1,
      componentId: "text-animation",
      componentVersion: 1,
      durationMs: 3000,
      seed: 5000 + i * 7,
      background: "#101f34",
      params: {},
    },
    title: label,
    renderHint: hint,
  },
});
const FAKE_OK = {
  storyboard: {
    ok: true,
    sentence: AI_SENTENCE,
    title: "拦截样例",
    totalMs: 9000,
    shots: [
      FAKE_SHOT(0, "标题", "标题「拦截样例」"),
      FAKE_SHOT(1, "要点解说", "要点解说「三个词」"),
      FAKE_SHOT(2, "标题", "标题「谢谢观看」"),
    ],
  },
  provenance: {
    provider: "qwen-chat",
    model: "intercepted",
    promptVersion: "4",
    compilerVersion: "1",
    substitutedForAssets: true,
  },
  substitutedForAssets: true,
};
let interceptCalls = 0;
await page.route("**/api/video/semantic-plan", async (route) => {
  interceptCalls += 1;
  if (interceptCalls === 1) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_OK),
    });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "拦截轮模拟服务错误" }),
  });
});
await page.click(".planner-ai");
await expectVisible(page, ".storyboard-card", "拦截轮确认卡");
await page
  .locator(".storyboard-card", { hasText: "不包含原要求的真实照片或素材" })
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("图解替代确认卡", "缺少替代素材的明确提示"));
// 第二次请求：等待窗口内旧卡必须已消失（不可应用），随后失败明示。
await page.click(".planner-ai");
await page.waitForTimeout(400);
const cardsInFlight = await page.locator(".storyboard-card").count();
if (cardsInFlight !== 0)
  fail("P2 等待中撤销", "第二次请求等待期间旧确认卡仍在（可被应用）");
await page
  .locator(".planner-feedback", { hasText: "拦截轮模拟服务错误" })
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => fail("P2 失败面", "拦截轮失败提示未出现"));
await page.unroute("**/api/video/semantic-plan");

await page.screenshot({
  path: path.join(OUT_DIR, "semantic-entry.png"),
  fullPage: true,
});

if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
if (seenResourceErrors > expectedSemanticFailures)
  fail(
    "浏览器控制台",
    `503 资源日志 ${seenResourceErrors} 行 > 预期 ${expectedSemanticFailures} 行`,
  );
if (expectedSemanticFailures === 0)
  fail("AI 入口失败面", "未见 semantic-plan 的 4xx/5xx 响应（断言未真正生效）");

await browser.close();
console.log(
  "[e2e-semantic-plan] OK: 无密钥失败面、真实素材授权入口、图解替代确认提示、旧句式回归、旧候选撤销与二次请求失败均通过",
);
