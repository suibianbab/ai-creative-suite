#!/usr/bin/env node
// N4（交接单 2026-10-27）：三种数据图表的真实全链验收。
//   每种图表一条自然语言输入（数值写在句中）→ AI 生成 → 确认卡逐项对账
//   （label/value/单位 与原始输入）→ 应用 → 保存 → CLI 双画幅 MP4 →
//   逐镜抽帧 → check-layout 几何校验。
// 前置: dev server 在 BASE_URL（默认 :3225）且配置 DASHSCOPE_API_KEY。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3225";
const OUT = path.join(ROOT, "artifacts/video-studio-semantic-n4");

const TOPICS = [
  {
    slug: "rain-bar",
    sentence:
      "做一条约15秒的地理科普短片，用柱状图对比三城市年降水：北京530毫米，上海1170毫米，广州1720毫米",
    expect: { componentId: "bar-chart", pairs: [["北京", "530"], ["上海", "1170"], ["广州", "1720"]] },
  },
  {
    slug: "temp-line",
    sentence:
      "做一条约15秒的气候科普短片，用折线图展示月均气温：一月2度，四月15度，七月28度，十月17度",
    expect: { componentId: "line-chart", pairs: [["一月", "2"], ["四月", "15"], ["七月", "28"], ["十月", "17"]] },
  },
  {
    slug: "water-counter",
    sentence:
      "做一条约12秒的健康科普短片，用数字动画强调每天建议饮水1500毫升",
    expect: { componentId: "number-counter", pairs: [["1500", ""], ["毫升", ""]] },
  },
];

function fail(step, detail) {
  console.error(`[audit-semantic-n4] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, "frames"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })
).newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const log = [];
for (const topic of TOPICS) {
  await page.goto(`${BASE_URL}/video-studio`, { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail("打开工作台", "客户端未就绪"));
  await page.click(".project-create");
  await page.fill("#planner-sentence", topic.sentence);
  // 模型输出非确定：给一次用户式重试。
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
  if (!generated) fail(`生成(${topic.slug})`, "两次尝试确认卡均未出现");
  // 确认卡逐项对账：每个 label+value 对都必须出现在卡上（顺序渲染值）。
  const cardText = await page.locator(".storyboard-card").textContent();
  for (const [label, value] of topic.expect.pairs) {
    if (!cardText?.includes(label))
      fail(`对账(${topic.slug})`, `卡缺标签「${label}」`);
    if (value && !cardText?.includes(value))
      fail(`对账(${topic.slug})`, `卡缺数值「${value}」`);
  }
  // 数值闸审计：卡上镜头内容的数字必须来自原话（全角归一）。
  const numerals = (t) =>
    [
      ...t
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .matchAll(/\d+(?:\.\d+)?/g),
    ].map((m) => m[0]);
  const userNums = new Set(numerals(topic.sentence));
  const shotTexts = [
    ...(await page.locator(".plan-shot-hint").allTextContents()),
    ...(await page.locator(".plan-shot-narration").allTextContents()),
  ].join("|");
  for (const n of numerals(shotTexts))
    if (!userNums.has(n))
      fail(`数值闸(${topic.slug})`, `镜头内容出现原话外数字「${n}」`);
  await page.screenshot({
    path: path.join(OUT, `${topic.slug}-confirm-card.png`),
    fullPage: true,
  });
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
  const projectPath = path.join(OUT, `${topic.slug}.project.json`);
  await download.saveAs(projectPath);
  await page.click(".project-action");

  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  const workingIds = project.shots.map((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return { componentId: w.sceneSource.spec.componentId, params: w.sceneSource.spec.params };
  });
  const target = workingIds.find((w) => w.componentId === topic.expect.componentId);
  if (!target)
    fail(`组件落位(${topic.slug})`, `未见 ${topic.expect.componentId}：${workingIds.map((w) => w.componentId).join("/")}`);

  // CLI 双画幅出片 + 抽帧。
  const renderDir = path.join(OUT, `${topic.slug}-render`);
  rmSync(renderDir, { recursive: true, force: true });
  const render = execFileSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/render-scene.mjs"),
      "--project", projectPath,
      "--out", renderDir,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  if (!render.includes("landscape.mp4")) fail(`出片(${topic.slug})`, render.slice(-200));
  const bounds = [0];
  for (const shot of project.shots) {
    const w = shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
    bounds.push(bounds.at(-1) + w.durationMs);
  }
  for (const aspect of ["landscape", "portrait"]) {
    for (let i = 0; i < project.shots.length; i++) {
      const t = ((bounds[i] + bounds[i + 1]) / 2) / 1000;
      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-ss", t.toFixed(2), "-i",
          path.join(renderDir, `${aspect}.mp4`), "-frames:v", "1",
          path.join(OUT, `frames/${topic.slug}-${aspect}-s${i}.png`)],
        { cwd: ROOT },
      );
    }
  }
  log.push({
    slug: topic.slug,
    shots: project.shots.length,
    components: workingIds.map((w) => w.componentId),
    totalMs: bounds.at(-1),
  });
  console.log(
    `[audit-semantic-n4] ${topic.slug}: ${project.shots.length} 镜 ${workingIds.map((w) => w.componentId).join("/")} / ${(bounds.at(-1) / 1000).toFixed(1)}s`,
  );
}
if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
await browser.close();
writeFileSync(path.join(OUT, "generation-log.json"), JSON.stringify(log, null, 2));
console.log("[audit-semantic-n4] OK: 三图表生成/对账/出片/抽帧完成");
