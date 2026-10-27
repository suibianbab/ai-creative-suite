#!/usr/bin/env node
// Codex 复核修复的浏览器增量确认（2026-10-27 验收门槛）：
// ①一条对比镜头：新数值闸（只认原话数字）下的 compare 生成+确认卡+应用。
// ②一条单镜图解替代：needs-assets → 授权 → 候选带标记 → 确认落版本 →
//   导出 provenance 含 /asset-substituted、描述带【图解替代】前缀。
// 前置: dev server 在 BASE_URL（默认 :3224）且配置 DASHSCOPE_API_KEY。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3224";
const out = path.join(root, "artifacts/video-studio-semantic-n3/review-fixes");
mkdirSync(out, { recursive: true });

function fail(step, detail) {
  console.error(`[review-fixes] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  })
).newPage();
const errors = [];
// 预期失败面对账：语义端点的 422（needs-assets 等）会被浏览器记为资源
// 错误——按实际响应数放行，其余仍全量拦截。
let expected4xx = 0;
let seen4xxLogs = 0;
page.on("response", (r) => {
  if (/semantic-(plan|revise)/.test(r.url()) && r.status() >= 400)
    expected4xx += 1;
});
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (expected4xx > 0 && /Failed to load resource.*4\d\d/.test(text)) {
    seen4xxLogs += 1;
    return;
  }
  errors.push(text.slice(0, 200));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function exportProject(name) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.click(".editor-export"),
  ]);
  const file = path.join(out, name);
  await download.saveAs(file);
  return JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
}

try {
  // —— ① 新闸下的对比镜头 ——
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
  await page.click(".project-create");
  await page.fill(
    "#planner-sentence",
    "做一条约15秒的科普短片，对比慢跑和久坐：每周运动时间从0小时增加到5小时，静息心率从80降到65",
  );
  // 模型输出非确定：闸可能两轮拒绝个别表述（如派生差值）。真实用户会
  // 再点一次——e2e 给一次重试机会，两次都失败才判失败。
  let generated = false;
  for (let attempt = 1; attempt <= 2 && !generated; attempt++) {
    await page.click(".planner-ai");
    generated = await page
      .locator(".storyboard-card")
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!generated) fail("对比生成", "两次尝试确认卡均未出现（新数值闸）");
  const cardText = await page.locator(".storyboard-card").textContent();
  for (const word of ["慢跑", "久坐", "80", "65"])
    if (!cardText?.includes(word))
      fail("对比确认卡", `缺「${word}」：${cardText?.slice(0, 160)}`);
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("对比应用", "未出现应用提示"));
  const compareProject = await exportProject("compare.project.json");
  const compareShot = compareProject.shots.find((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.sceneSource.spec.componentId === "compare-split";
  });
  if (!compareShot) fail("对比组件", "项目未见 compare-split 镜头");
  await page.screenshot({ path: path.join(out, "compare-editor.png") });

  // —— ② 单镜图解替代全链 ——
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("保存", "未出现保存提示"));
  const cards = await page.locator(".shot-card").count();
  const card = page.locator(".shot-card").nth(Math.min(1, cards - 1));
  await card.locator(".shot-edit-toggle").click();
  await card
    .locator(".shot-ai-revise-row input")
    .fill("这一镜换成真实照片展示心率变化");
  await card.locator(".shot-ai-revise-button").click();
  await card
    .locator(".shot-redo-error", { hasText: "真实照片" })
    .waitFor({ timeout: 30_000 })
    .catch(() => fail("needs-assets", "素材边界提示未出现"));
  // 授权「改用图解生成」。
  await card.locator("button", { hasText: "改用图解生成" }).click();
  await card
    .locator(".shot-ai-candidate")
    .waitFor({ timeout: 120_000 })
    .catch(() => fail("替代候选", "候选未出现"));
  const candidateText = await card.locator(".shot-ai-candidate").textContent();
  if (!candidateText?.includes("图解替代"))
    fail("替代标记", `候选未标图解替代：${candidateText?.slice(0, 120)}`);
  await card.screenshot({ path: path.join(out, "substituted-candidate.png") });
  await card
    .locator(".shot-ai-candidate button", { hasText: "确认应用" })
    .click();
  await page
    .locator(".editor-message", { hasText: "已按 AI 指令修改" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("替代确认", "未出现修改成功提示"));
  const after = await exportProject("substituted.project.json");
  const target = after.shots.find((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.provenance.engineId === "planner-semantic-revise";
  });
  if (!target) fail("替代落档", "未见 planner-semantic-revise 版本");
  const w = target.contentVersions.find(
    (v) => v.versionId === target.workingVersionId,
  );
  if (!w.provenance.engineVersion.includes("/asset-substituted"))
    fail("替代落档", `engineVersion=${w.provenance.engineVersion}`);
  if (!w.description.startsWith("【图解替代】"))
    fail("替代落档", `description=${w.description.slice(0, 30)}`);

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  if (seen4xxLogs > expected4xx)
    fail("浏览器控制台", `4xx 资源日志 ${seen4xxLogs} > 预期 ${expected4xx}`);
  console.log(
    "[review-fixes] OK: 对比镜头（新闸）+ 单镜图解替代全链（标记+落档）",
  );
} finally {
  await browser.close();
}
