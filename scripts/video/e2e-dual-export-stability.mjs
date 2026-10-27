#!/usr/bin/env node
// 任务 5（交接单 2026-10-28）：双画幅一键导出的资源稳定性。
//   浏览器：固定句式 3 镜（零 AI 计费）→ 连续两次「生成有声横竖版 MP4
//   （含字幕）」一键导出 → 每次核对：双下载链接、时长一致、AAC 音轨、
//   渲染记录 +N（第二次追加不覆盖）、无失败残留作业写成功记录。
// 前置: dev server 在 BASE_URL（默认 :3226）且配置 DASHSCOPE_API_KEY
//   （TTS 计费 ~6 次短句）。内存紧张是本测试的验收对象，非规避项。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3226";
const OUT = path.join(ROOT, "artifacts/video-dual-export-stability");

function fail(step, detail) {
  console.error(`[e2e-dual-export] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
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
  await page.goto(`${BASE_URL}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
  await page.click(".project-create");
  await page.fill(
    "#planner-sentence",
    "做一个8秒的STEM解说视频，主题是水循环，分3个镜头",
  );
  await page.click(".planner-run:not(.planner-ai)");
  await page.locator(".storyboard-card").first().waitFor();
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 });

  let prevRecords = 0;
  let prevDuration = 0;
  for (let round = 1; round <= 2; round++) {
    await page.locator(".editor-render-narrated").click();
    await page
      .locator(".editor-message", { hasText: "有声横竖版视频已生成" })
      .waitFor({ timeout: 480_000 })
      .catch(() => fail(`第 ${round} 次导出`, "成功提示未出现"));
    const hrefs = await page
      .locator(".editor-downloads a")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    if (hrefs.length !== 2) fail(`第 ${round} 次导出`, `下载链接 ${hrefs.length} ≠ 2`);

    // 下载两份并核对。
    const durations = [];
    for (const url of hrefs) {
      const aspect = url.includes("portrait") ? "portrait" : "landscape";
      const file = path.join(OUT, `r${round}-${aspect}.mp4`);
      execFileSync("curl", ["-s", "-o", file, `${BASE_URL}${url}`], {
        cwd: ROOT,
      });
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v", "error",
            "-show_entries", "stream=codec_type,codec_name",
            "-show_entries", "format=duration",
            "-of", "json", file,
          ],
          { encoding: "utf8" },
        ),
      );
      const audio = probe.streams.find((s) => s.codec_type === "audio");
      if (audio?.codec_name !== "aac")
        fail(`第 ${round} 次导出`, `${aspect} 音轨 ${audio?.codec_name ?? "无"}`);
      durations.push(Number(probe.format.duration));
    }
    if (Math.abs(durations[0] - durations[1]) > 0.05)
      fail(`第 ${round} 次导出`, `两画幅时长不符 ${durations.join(" vs ")}`);
    if (round === 2 && Math.abs(durations[0] - prevDuration) > 0.05)
      fail("第 2 次导出", `与第 1 次时长漂移 ${durations[0]} vs ${prevDuration}`);
    prevDuration = durations[0];

    // 渲染记录追加（3 镜 × 2 画幅 = +6/轮）。
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.click(".editor-export"),
    ]);
    const projectFile = path.join(OUT, `r${round}.project.json`);
    await download.saveAs(projectFile);
    const { readFileSync } = await import("node:fs");
    const project = JSON.parse(readFileSync(projectFile, "utf8"));
    if (round === 1) {
      prevRecords = project.renderRecords.length;
      if (prevRecords < 6) fail("第 1 次导出", `渲染记录 ${prevRecords} < 6`);
    } else {
      const grown = project.renderRecords.length - prevRecords;
      if (grown < 6)
        fail("第 2 次导出", `渲染记录仅 +${grown}（应 ≥6：追加不覆盖）`);
    }
    // 交付完整性：成功 RenderRecord 每条都带输出资产引用（outputAssetRef）
    // ——失败路径由 cleanupFailedJob 保证不落半成品记录（路由测试覆盖）。
    for (const record of project.renderRecords) {
      if (!record.outputAssetRef)
        fail("交付完整性", `RenderRecord ${record.renderId} 无输出引用`);
    }
    console.log(
      `[e2e-dual-export] 第 ${round} 轮 OK：双画幅 ${durations[0].toFixed(2)}s/aac/记录 ${project.renderRecords.length}`,
    );
    await page.click(".project-action");
    await page.locator(".project-open").first().waitFor({ timeout: 15_000 });
    await page.locator(".project-open").first().click();
    await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  }

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  console.log("[e2e-dual-export] OK: 连续两次一键横竖导出稳定，时长/音轨/记录全对账");
} finally {
  await browser.close();
}
