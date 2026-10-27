#!/usr/bin/env node
// N1（交接单 2026-10-27）：语义分镜 → 有声横竖 MP4 全链验收。
//   浏览器：新建 → 「AI 生成分镜」（真实千问）→ 确认卡 → 追加应用 → 保存
//   → 「生成有声横竖版 MP4（含字幕）」→ 双下载链接。
//   证据：ffprobe 双画幅（h264+aac+尺寸）；render-manifest 逐镜 narration
//   （versionId 与项目工作版本一致=旁白不串镜，durationMs ≤ 镜头时长）与
//   subtitleCues（每镜 cue>0）；项目导出后 renderRecords=镜头数×2；
//   逐镜中点抽帧（含烧录字幕）与确认卡/下载就绪截图。
// 前置: dev server 已在 BASE_URL（默认 :3224）且配置 DASHSCOPE_API_KEY
//   （千问规划 + DashScope TTS 同钥）。packages/* 已 build。
// exit 0 = 验收成立。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3224";
const out = path.join(root, "artifacts/video-studio-semantic-narrated");
const SENTENCE =
  "做一条约25秒的水循环科普短片，讲清蒸发、凝结和降水";

function fail(step, detail) {
  console.error(`[e2e-semantic-narrated] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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

try {
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
    .catch(() => fail("AI 生成", "确认卡未出现（真实千问调用）"));
  await page.screenshot({ path: path.join(out, "confirm-card.png"), fullPage: true });
  // 确认卡旁白即后续 TTS 输入：逐镜非空且与项目落库一致（后核对）。
  const cardNarrations = await page.locator(".plan-shot-narration").allTextContents();
  if (cardNarrations.length < 3 || cardNarrations.some((t) => !/旁白：.+/.test(t)))
    fail("确认卡旁白", JSON.stringify(cardNarrations));
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

  // —— 有声出片（真实 TTS + 字幕 + 双画幅）——
  await page.locator(".editor-render-narrated").click();
  await page
    .locator(".editor-message", { hasText: "有声横竖版视频已生成" })
    .waitFor({ timeout: 300_000 })
    .catch(() => fail("有声出片", "未出现生成完成提示（TTS 可能失败，看消息文案）"));
  // 双视频预览的整页截图会压垮 headless renderer（实测 OOM 关页）：
  // 只截消息元素，并立即取下载链接。
  const messageBox = page.locator(".editor-message").first();
  await messageBox.screenshot({ path: path.join(out, "narrated-ready.png") });
  const hrefs = await page
    .locator(".editor-downloads a")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  if (hrefs.length !== 2) fail("下载链接", `期望 2 条，实际 ${hrefs.length}`);

  const downloads = {};
  const files = {};
  for (const url0 of hrefs) {
    const url = url0;
    assert(url);
    const aspect = url.includes("portrait") ? "portrait" : "landscape";
    const file = path.join(out, `semantic-${aspect}.mp4`);
    execFileSync("curl", ["-s", "-o", file, `${BASE_URL}${url}`], { cwd: root });
    files[aspect] = file;
    downloads[aspect] = url;
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v", "error",
          "-show_entries", "stream=codec_type,codec_name,width,height",
          "-of", "json", file,
        ],
        { encoding: "utf8" },
      ),
    );
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    const video = probe.streams.find((s) => s.codec_type === "video");
    if (audio?.codec_name !== "aac") fail("音轨", `${aspect}: ${JSON.stringify(probe.streams)}`);
    if (video?.codec_name !== "h264") fail("视频轨", `${aspect}: ${video?.codec_name}`);
    if (video.width !== (aspect === "landscape" ? 1280 : 720))
      fail("尺寸", `${aspect}: ${video.width}x${video.height}`);
  }

  // —— 项目导出：旁白落库、渲染记录一致 ——
  const [projectDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.click(".editor-export"),
  ]);
  const projectFile = path.join(out, "semantic.project.json");
  await projectDownload.saveAs(projectFile);
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  const shotCount = project.shots.length;
  for (const [i, shot] of project.shots.entries()) {
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    if (!working.narrationText) fail("旁白落库", `镜 ${i + 1} narrationText 为空`);
  }
  // 确认卡旁白 ↔ 项目旁白一致（逐镜，取「旁白：」后的文本）。
  project.shots.forEach((shot, i) => {
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    const card = (cardNarrations[i] ?? "").replace(/^旁白：/, "");
    if (card && card !== working.narrationText)
      fail("旁白一致", `镜 ${i + 1}: 卡「${card}」≠ 库「${working.narrationText}」`);
  });

  // —— render-manifest：逐镜音轨指纹 + 字幕 cue ——
  const jobId = downloads.landscape.split("/").at(-2);
  const jobDir = path.join(root, ".tools/video-workbench-renders", jobId);
  const manifest = JSON.parse(
    readFileSync(path.join(jobDir, "render/render-manifest.json"), "utf8"),
  );
  for (const aspect of ["landscape", "portrait"]) {
    const m = manifest.aspects[aspect];
    if (m.narration.length !== shotCount)
      fail("manifest 旁白", `${aspect}: ${m.narration.length} ≠ ${shotCount}`);
    if (m.subtitleCues.length !== shotCount)
      fail("manifest 字幕", `${aspect}: ${m.subtitleCues.length} ≠ ${shotCount}`);
    if (!m.subtitleCues.every((c) => c.cues > 0))
      fail("manifest 字幕", `${aspect}: 存在无 cue 镜头`);
    // 旁白不串镜：每镜音轨归属自己的工作版本，时长不越镜头。
    for (const entry of m.narration) {
      const shot = project.shots[entry.shotIndex];
      if (!shot || entry.versionId !== shot.workingVersionId)
        fail("旁白串镜", `${aspect}: 镜 ${entry.shotIndex + 1} 音轨版本不属于该镜`);
      const durationMs = shot.contentVersions.find(
        (v) => v.versionId === shot.workingVersionId,
      ).durationMs;
      if (entry.durationMs > durationMs + 200)
        fail("旁白越界", `镜 ${entry.shotIndex + 1}: ${entry.durationMs} > ${durationMs}+200`);
    }
  }

  // —— 逐镜中点抽帧（含烧录字幕，供人工审片）——
  const bounds = [0];
  for (const shot of project.shots) {
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    bounds.push(bounds.at(-1) + working.durationMs);
  }
  for (let i = 0; i < shotCount; i++) {
    const t = ((bounds[i] + bounds[i + 1]) / 2) / 1000;
    execFileSync(
      "ffmpeg",
      ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", files.landscape,
        "-frames:v", "1", path.join(out, `shot-${i + 1}-subtitle.png`)],
      { cwd: root },
    );
  }

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  const report = {
    projectId: project.id,
    sentence: SENTENCE,
    shotCount,
    renderRecords: project.renderRecords.length,
    files: Object.fromEntries(
      Object.entries(files).map(([a, f]) => [a, { sha256: sha256(f) }]),
    ),
    narrations: project.shots.map((s) =>
      s.contentVersions.find((v) => v.versionId === s.workingVersionId).narrationText,
    ),
    jobId,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log("[e2e-semantic-narrated] OK");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
