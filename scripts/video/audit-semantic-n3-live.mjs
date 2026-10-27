#!/usr/bin/env node
// N3（交接单 2026-10-27）：新画面类型真实样片验收。
//   两条与水循环不同的创意：①前后对比（数值来自用户原话）②阶段时间线
//   （无日期 → 顺序词）。浏览器：AI 生成 → 确认卡（预告对比数值/阶段，
//   不得出现占位或编造数字）→ 应用 → 保存 → 导出；CLI 双画幅出片；
//   check-layout 几何校验 + 逐镜抽帧。
// 前置: dev server 在 BASE_URL（默认 :3224）且配置 DASHSCOPE_API_KEY。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3224";
const OUT = path.join(ROOT, "artifacts/video-studio-semantic-n3");

const TOPICS = [
  {
    slug: "sleep-compare",
    sentence:
      "做一条约20秒的健康科普短片：睡前刷手机1小时 vs 阅读30分钟，入睡时间从40分钟缩短到15分钟",
    // 对比数值必须来自原话；确认卡预告这些数字。
    expectCard: ["40分钟", "15分钟", "刷手机", "阅读"],
    expectComponent: "compare-split",
  },
  {
    slug: "seed-timeline",
    sentence:
      "做一条约20秒的种子发芽科普短片，用时间线展示播种、发芽、幼苗、开花四个阶段",
    expectCard: ["播种", "开花", "阶段"],
    expectComponent: "timeline-milestones",
  },
];

function fail(step, detail) {
  console.error(`[audit-semantic-n3] FAIL at ${step}: ${detail ?? ""}`);
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
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForSelector("html[data-studio-ready]", { timeout: 20_000 })
    .catch(() => fail("打开工作台", "客户端未就绪"));
  await page.click(".project-create");
  await page.fill("#planner-sentence", topic.sentence);
  await page.click(".planner-ai");
  await page
    .locator(".storyboard-card")
    .first()
    .waitFor({ timeout: 120_000 })
    .catch(() => fail(`生成(${topic.slug})`, "确认卡未出现"));
  // 确认卡预告屏幕将出现的内容（N3 验收：明确屏幕上会出现什么）。
  const cardText = await page.locator(".storyboard-card").textContent();
  for (const word of topic.expectCard)
    if (!cardText?.includes(word))
      fail(`确认卡预告(${topic.slug})`, `缺「${word}」：${cardText?.slice(0, 200)}`);
  // 数值闸实证：镜头内容（预告/旁白，不含卡片元信息与列表序号）里的
  // 数字必须全部来自原话或两数之差。
  const numerals = (t) =>
    [...t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const userNums = numerals(topic.sentence).map(Number);
  const derivable = new Set();
  for (let i = 0; i < userNums.length; i++)
    for (let j = i + 1; j < userNums.length; j++)
      derivable.add(Math.abs(userNums[i] - userNums[j]));
  const shotTexts = [
    ...(await page.locator(".plan-shot-hint").allTextContents()),
    ...(await page.locator(".plan-shot-narration").allTextContents()),
  ].join("|");
  for (const n of numerals(shotTexts))
    if (!userNums.includes(Number(n)) && !derivable.has(Number(n)))
      fail(`数值闸(${topic.slug})`, `镜头内容出现原话没有的数字「${n}」：${shotTexts.slice(0, 200)}`);
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

  // 项目必须含目标组件镜头。
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  const componentIds = project.shots.map((s) =>
    s.contentVersions
      .find((v) => v.versionId === s.workingVersionId)
      .sceneSource.spec.componentId,
  );
  if (!componentIds.includes(topic.expectComponent))
    fail(`组件落位(${topic.slug})`, `未见 ${topic.expectComponent}：${componentIds}`);

  // CLI 双画幅出片。
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
  if (!render.includes("landscape.mp4"))
    fail(`出片(${topic.slug})`, render.slice(-200));

  // 逐镜抽帧（横竖各稳定段）。
  const bounds = [0];
  for (const shot of project.shots) {
    const w = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
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
    componentIds,
    totalMs: bounds.at(-1),
  });
  console.log(
    `[audit-semantic-n3] ${topic.slug}: ${project.shots.length} 镜 ${componentIds.join("/")} / ${bounds.at(-1) / 1000}s`,
  );
}
if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
await browser.close();
writeFileSync(
  path.join(OUT, "generation-log.json"),
  JSON.stringify(log, null, 2),
);
console.log("[audit-semantic-n3] OK: 两条创意生成/确认/出片/抽帧完成");
