#!/usr/bin/env node
// 语义分镜真实样片验收（交接单第 5 步，2026-10-26）：真实千问调用 × 两个
// 不同 STEM 主题，浏览器全链路（AI 生成 → 确认卡截图 → 追加应用 → 保存 →
// 导出 JSON），并记录调用时延与 token usage。MP4 出片/抽帧/审片由后续
// render + ffmpeg 步骤完成（本脚本只做生成与落档）。
// 前置: dev server 已在 BASE_URL 且配置了真实 DASHSCOPE_API_KEY。
// 产物: artifacts/video-studio-semantic-storyboard/
//   - <slug>.response.json     路由完整响应（storyboard/provenance/usage）
//   - <slug>.confirm-card.png  浏览器确认卡截图
//   - <slug>.project.json      应用+保存后导出的项目 JSON
//   - generation-log.json      每主题时延/usage/镜头数/总时长
// exit 0 = 两个主题都拿到有效分镜与项目；否则 exit 1。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3223";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-semantic-storyboard");

const TOPICS = [
  {
    slug: "water-cycle",
    sentence: "做一条约25秒的水循环科普短片，讲清蒸发、凝结和降水",
    // 同义写法都算覆盖（模型可能写「降水」「降雨」等）。
    mustMention: [["蒸发"], ["凝结", "凝聚"], ["降水", "降雨"]],
  },
  {
    slug: "photosynthesis",
    sentence: "做一条约25秒的光合作用科普短片，讲清阳光、二氧化碳和水如何变成养分",
    mustMention: [["阳光", "光能"], ["二氧化碳", "CO₂", "CO2"], ["水"]],
  },
];

function fail(step, detail) {
  console.error(`[audit-semantic-live] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

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
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));

const log = [];
for (const topic of TOPICS) {
  // —— 路由直调 probe 轮：时延与 usage 取证（独立生成，与浏览器轮分开存档，
  //    证据三件套以浏览器轮为准——I-3，2026-10-26 评审） ——
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/video/semantic-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentence: topic.sentence }),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const data = await response.json();
  writeFileSync(
    path.join(OUT_DIR, `${topic.slug}.probe.json`),
    JSON.stringify(data, null, 2),
  );
  if (!response.ok || !data.storyboard?.ok)
    fail(`路由生成(${topic.slug})`, JSON.stringify(data).slice(0, 400));

  // —— 主题覆盖：每个必提概念（任一同义写法）必须在镜头文字或旁白中出现 ——
  const allText = data.storyboard.shots
    .map(
      (s) =>
        `${s.description}|${s.narrationText}|${s.plan.title}|${s.plan.renderHint}`,
    )
    .join("\n");
  for (const synonyms of topic.mustMention)
    if (!synonyms.some((word) => allText.includes(word)))
      fail(`主题覆盖(${topic.slug})`, `分镜未提及「${synonyms.join("/")}」`);

  // —— 浏览器链路：同一句经 UI 生成（真调用）→ 确认卡 → 应用 → 保存 → 导出 ——
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail("打开工作台", "客户端未就绪"));
  await page.click(".project-create");
  await page.fill("#planner-sentence", topic.sentence);
  // 浏览器轮的路由响应与确认卡/项目同轮落盘（I-3）：截图、response、
  // project 三件套必须来自同一次生成，交接单验收「输入句、确认卡、
  // 实际版本内容一致」按此核对。
  const browserResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/video/semantic-plan"),
    { timeout: 90_000 },
  );
  await page.click(".planner-ai");
  const browserResponse = await browserResponsePromise;
  const browserData = await browserResponse.json();
  await page
    .locator(".storyboard-card")
    .first()
    .waitFor({ timeout: 90_000 })
    .catch(() => fail(`浏览器生成(${topic.slug})`, "确认卡未出现"));
  // 浏览器轮完整响应就是交付样片的规划来源：存为 *.response.json。
  writeFileSync(
    path.join(OUT_DIR, `${topic.slug}.response.json`),
    JSON.stringify(browserData, null, 2),
  );
  if (!browserData.storyboard?.ok)
    fail(`浏览器生成(${topic.slug})`, "路由响应无 storyboard");
  // 主题覆盖以交付轮为准（probe 轮仅作生成面取样）。
  const browserAllText = browserData.storyboard.shots
    .map(
      (s) =>
        `${s.description}|${s.narrationText}|${s.plan.title}|${s.plan.renderHint}`,
    )
    .join("\n");
  for (const synonyms of topic.mustMention)
    if (!synonyms.some((word) => browserAllText.includes(word)))
      fail(`交付轮主题覆盖(${topic.slug})`, `分镜未提及「${synonyms.join("/")}」`);
  // M-7：偏离标注与总时长/目标的逻辑一致性（不只落盘）。
  const dev = browserData.durationDeviation;
  if (dev) {
    if (dev.actualMs !== browserData.storyboard.totalMs)
      fail(
        `偏离一致性(${topic.slug})`,
        `durationDeviation.actualMs=${dev.actualMs} ≠ totalMs=${browserData.storyboard.totalMs}`,
      );
    const inBand = dev.actualMs >= dev.targetMs * 0.8 && dev.actualMs <= dev.targetMs * 1.2;
    if (inBand)
      fail(
        `偏离一致性(${topic.slug})`,
        `actualMs=${dev.actualMs} 在目标带内却标了偏离`,
      );
  }
  await page.screenshot({
    path: path.join(OUT_DIR, `${topic.slug}.confirm-card.png`),
    fullPage: true,
  });
  // 确认卡不含占位文案（「要点 1」「示意 1」是旧规则规划器专属）。
  const cardText = await page.locator(".storyboard-card").textContent();
  if (/要点 [1-9]|示意 [1-9]/.test(cardText ?? ""))
    fail(`占位文案(${topic.slug})`, cardText?.slice(0, 200));
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail(`应用(${topic.slug})`, "未出现应用提示"));
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail(`保存(${topic.slug})`, "未出现保存提示"));
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.click(".editor-export"),
  ]);
  const projectPath = path.join(OUT_DIR, `${topic.slug}.project.json`);
  await download.saveAs(projectPath);
  // Codex 复核场景 3：应用写档的是规划期句子快照（生成后改输入不影响落库句）。
  const exported = JSON.parse(readFileSync(projectPath, "utf8"));
  if (exported.brief.sentence !== topic.sentence)
    fail(
      `句子快照(${topic.slug})`,
      `brief.sentence=${exported.brief.sentence} ≠ 规划句 ${topic.sentence}`,
    );
  // provenance 必须是语义引擎（防错标 planner-rules，P1-1 相关口径）。
  for (const shot of exported.shots) {
    const v = shot.contentVersions.find((x) => x.versionId === shot.workingVersionId);
    if (!v.provenance.engineId.startsWith("planner-semantic"))
      fail(`provenance(${topic.slug})`, `镜 ${shot.order + 1} 落档 ${v.provenance.engineId}`);
  }
  await page.click(".project-action");

  // 台账记录交付轮（浏览器轮）：probe 轮的时延/usage 一并留档对比。
  log.push({
    slug: topic.slug,
    sentence: topic.sentence,
    browser: {
      shots: browserData.storyboard.shots.length,
      totalMs: browserData.storyboard.totalMs,
      usage: browserData.usage ?? null,
      durationDeviation: browserData.durationDeviation ?? null,
      provenance: {
        model: browserData.provenance?.model,
        promptVersion: browserData.provenance?.promptVersion,
        compilerVersion: browserData.provenance?.compilerVersion,
      },
    },
    probe: {
      routeElapsedMs: elapsedMs,
      shots: data.storyboard.shots.length,
      totalMs: data.storyboard.totalMs,
      usage: data.usage ?? null,
    },
  });
  console.log(
    `[audit-semantic-live] ${topic.slug}: 浏览器轮 ${browserData.storyboard.shots.length} 镜 / ${browserData.storyboard.totalMs / 1000}s${browserData.durationDeviation ? "（偏离标注）" : ""} / probe 路由 ${elapsedMs}ms / tokens 浏览器 ${browserData.usage?.total_tokens ?? "?"} · probe ${data.usage?.total_tokens ?? "?"}`,
  );
}

writeFileSync(
  path.join(OUT_DIR, "generation-log.json"),
  JSON.stringify(log, null, 2),
);
if (consoleErrors.length > 0) fail("浏览器控制台", consoleErrors.join(" | "));
await browser.close();
console.log("[audit-semantic-live] OK: 两个主题生成+浏览器链路+导出完成");
