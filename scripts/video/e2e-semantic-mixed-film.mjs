#!/usr/bin/env node
// N6（交接单 2026-10-27）：图解+素材混合完整样片（20-40s，有声）。
//   创意句含：柱状图数据（用户原话数值）、真实画面素材位、三步流程、
//   数字计数、标题镜 → 浏览器：AI 生成→确认卡→应用→上传测试素材→绑定
//   素材位→AI 修改一个镜头→保存重开→「生成有声横竖版 MP4（含字幕）」。
//   证据四态：①结构/版本/素材来源 ②音轨+字幕（manifest 逐镜）③横竖
//   抽帧 ④失败面（控制台干净）。
// 前置: dev server 在 BASE_URL（默认 :3225）且配置 DASHSCOPE_API_KEY。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3225";
const OUT = path.join(ROOT, "artifacts/video-studio-semantic-mixed");
const SENTENCE =
  "做一条约30秒的城市共享单车科普短片：用柱状图展示骑行量——北京年骑行从120万次涨到350万次，配一段真实街拍骑行画面，讲三步开锁流程，最后用数字强调每年减碳80万吨";

function fail(step, detail) {
  console.error(`[e2e-semantic-mixed] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, "frames"), { recursive: true });
execFileSync(
  "ffmpeg",
  ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x3f7f5f:s=640x480:d=5:r=24",
    "-pix_fmt", "yuv420p", path.join(OUT, "street-ride.mp4")],
  { cwd: ROOT },
);

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
  const file = path.join(OUT, name);
  await download.saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
}

try {
  // —— 生成 → 确认卡 → 应用 ——
  await page.goto(`${BASE_URL}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
  await page.click(".project-create");
  await page.fill("#planner-sentence", SENTENCE);
  let generated = false;
  for (let attempt = 1; attempt <= 3 && !generated; attempt++) {
    await page.click(".planner-ai");
    generated = await page
      .locator(".storyboard-card")
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!generated) fail("生成", "两次尝试确认卡均未出现");
  const cardText = await page.locator(".storyboard-card").textContent();
  for (const word of ["120", "350", "80"])
    if (!cardText?.includes(word))
      fail("数据对账", `确认卡缺原话数值「${word}」`);
  await page.screenshot({ path: path.join(OUT, "confirm-card.png"), fullPage: true });
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("应用", "未出现应用提示"));
  const planned = await exportProject("project-planned.json");
  const hasBar = planned.shots.some((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.sceneSource.spec?.componentId === "bar-chart";
  });
  const hasSlot = planned.shots.some((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.description.startsWith("【素材位】");
  });
  const hasFlow = planned.shots.some((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.sceneSource.spec?.componentId === "flow-steps";
  });
  if (!hasBar || !hasSlot || !hasFlow)
    fail(
      "混排结构",
      `柱状${hasBar}·素材位${hasSlot}·流程${hasFlow} 不齐`,
    );

  // —— 上传素材 + 绑定素材位 ——
  await page
    .locator(".media-panel input[type=file]")
    .setInputFiles(path.join(OUT, "street-ride.mp4"));
  await page.locator("button.media-upload").click();
  await page
    .locator(".editor-message", { hasText: "素材已上传" })
    .waitFor({ timeout: 60_000 })
    .catch(() => fail("上传", "素材未入账本"));
  const slotIndex = planned.shots.findIndex((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.description.startsWith("【素材位】");
  });
  const slotCard = page.locator(".shot-card").nth(slotIndex);
  await slotCard.locator(".shot-edit-toggle").click();
  await slotCard
    .locator(".chart-template-select")
    .selectOption({ label: "媒体镜头（选素材设入出点）" });
  await slotCard.locator(".media-asset-select").selectOption({ index: 0 });
  await slotCard.locator("button.shot-apply").first().click();
  await page
    .locator(".editor-message", { hasText: "已修订" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("绑定", "素材位绑定未生效"));

  // —— AI 修改一个镜头（单镜自然语言修改进混合链）——
  const flowIndex = planned.shots.findIndex((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.sceneSource.spec?.componentId === "flow-steps";
  });
  if (flowIndex >= 0) {
    const flowCard = page.locator(".shot-card").nth(flowIndex);
    await flowCard.locator(".shot-edit-toggle").click();
    await flowCard
      .locator(".shot-ai-revise-row input")
      .fill("把这镜的步骤名改得更口语化一点，旁白同步");
    await flowCard.locator(".shot-ai-revise-button").click();
    await flowCard
      .locator(".shot-ai-candidate")
      .waitFor({ timeout: 120_000 })
      .catch(() => fail("AI 修改", "候选未出现"));
    await flowCard
      .locator(".shot-ai-candidate button", { hasText: "确认应用" })
      .click();
    await page
      .locator(".editor-message", { hasText: "已按 AI 指令修改" })
      .waitFor({ timeout: 15_000 })
      .catch(() => fail("AI 修改", "确认应用未生效"));
  }

  // —— 保存重开 ——
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("保存", "未出现保存提示"));
  await page.click(".project-action");
  await page.locator(".project-open").first().waitFor({ timeout: 15_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  const final = await exportProject("project-final.json");

  // —— 有声出片（TTS+字幕+双画幅）——
  await page.locator(".editor-render-narrated").click();
  await page
    .locator(".editor-message", { hasText: "有声横竖版视频已生成" })
    .waitFor({ timeout: 300_000 })
    .catch(() => fail("有声出片", "未出现生成完成提示"));
  const hrefs = await page
    .locator(".editor-downloads a")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  const jobId = hrefs[0].split("/").at(-2);
  for (const [i, url] of hrefs.entries()) {
    const aspect = url.includes("portrait") ? "portrait" : "landscape";
    const file = path.join(OUT, `mixed-${aspect}.mp4`);
    execFileSync("curl", ["-s", "-o", file, `${BASE_URL}${url}`], { cwd: ROOT });
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height",
          "-of", "json", file],
        { encoding: "utf8" },
      ),
    );
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    const video = probe.streams.find((s) => s.codec_type === "video");
    if (audio?.codec_name !== "aac" || video?.codec_name !== "h264")
      fail("有声出片", `${aspect}: ${JSON.stringify(probe.streams.map((s) => s.codec_name))}`);
    if (video.width !== (aspect === "landscape" ? 1280 : 720))
      fail("有声出片", `${aspect} 尺寸 ${video.width}`);
  }

  // manifest：逐镜旁白归属 + 字幕 cue（含被 AI 修改的镜头取新版本）。
  const manifest = JSON.parse(
    readFileSync(
      path.join(ROOT, ".tools/video-workbench-renders", jobId, "render/render-manifest.json"),
      "utf8",
    ),
  );
  for (const aspect of ["landscape", "portrait"]) {
    const m = manifest.aspects[aspect];
    if (m.narration.length !== final.shots.length)
      fail("manifest", `${aspect} narration ${m.narration.length} ≠ ${final.shots.length}`);
    if (!m.subtitleCues.every((c) => c.cues > 0))
      fail("manifest", `${aspect} 存在无字幕镜头`);
    for (const entry of m.narration) {
      const shot = final.shots[entry.shotIndex];
      if (!shot || entry.versionId !== shot.workingVersionId)
        fail("旁白归属", `镜 ${entry.shotIndex + 1} 音轨版本不属于当前工作版本`);
    }
  }

  // —— 抽帧（横竖逐镜稳定段）——
  const bounds = [0];
  for (const shot of final.shots) {
    const w = shot.contentVersions.find((v) => v.versionId === shot.workingVersionId);
    bounds.push(bounds.at(-1) + w.durationMs);
  }
  for (const aspect of ["landscape", "portrait"])
    for (let i = 0; i < final.shots.length; i++) {
      const t = ((bounds[i] + bounds[i + 1]) / 2) / 1000;
      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-ss", t.toFixed(2), "-i",
          path.join(OUT, `mixed-${aspect}.mp4`), "-frames:v", "1",
          path.join(OUT, `frames/${aspect}-s${i}.png`)],
        { cwd: ROOT },
      );
    }

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  const report = {
    sentence: SENTENCE,
    totalMs: bounds.at(-1),
    shots: final.shots.map((s, i) => {
      const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
      return {
        index: i,
        source: w.sceneSource.type,
        component: w.sceneSource.spec?.componentId,
        versions: s.contentVersions.length,
        narration: w.narrationText,
      };
    }),
    renderJobId: jobId,
  };
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("[e2e-semantic-mixed] OK");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
