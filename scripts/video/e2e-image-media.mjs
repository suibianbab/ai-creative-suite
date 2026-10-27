#!/usr/bin/env node
// 任务 1 浏览器验收（交接单 2026-10-28）：图片成为正式素材。
//   上传真实 PNG → 账本显示图片元信息 → 绑定到素材位镜头 → 保存重开 →
//   图片仍正确显示（<img> 舞台 + 版本链贯穿）；缺失素材给明确错误面。
// 前置: dev server 在 BASE_URL（默认 :3226，无需模型密钥——纯本地链）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3226";
const OUT = path.join(ROOT, "artifacts/video-image-media");

function fail(step, detail) {
  console.error(`[e2e-image-media] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
// 真实图片夹具：ffmpeg 画一张有内容的 PNG（产品色块 + 渐变，非纯色更接近实物）。
const pngPath = path.join(OUT, "product-real.png");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=1:size=800x600:rate=24",
    "-frames:v",
    "1",
    pngPath,
  ],
  { cwd: ROOT },
);

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  })
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
  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
  await page.click(".project-create");
  // 固定句式出 3 镜（无需 AI）：含一个素材位的最短路径是先用规则规划，
  // 再把第 2 镜改绑图片。
  await page.fill(
    "#planner-sentence",
    "做一个8秒的STEM解说视频，主题是水循环，分3个镜头",
  );
  await page.click(".planner-run:not(.planner-ai)");
  await page.locator(".storyboard-card").first().waitFor();
  await page.click(".plan-apply");
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });

  // —— 上传 PNG ——
  await page.locator(".media-panel input[type=file]").setInputFiles(pngPath);
  await page.locator("button.media-upload").click();
  await page
    .locator(".editor-message", { hasText: "素材已上传" })
    .waitFor({ timeout: 60_000 })
    .catch(() => fail("上传", "PNG 未入账本"));
  const panelText = await page.locator(".media-panel").textContent();
  if (!panelText?.includes("图片") || !panelText?.includes("800×600"))
    fail("账本元信息", `未见图片·尺寸：${panelText?.slice(0, 120)}`);
  await page.screenshot({ path: path.join(OUT, "panel-with-image.png") });

  // —— 绑定到第 2 镜（媒体臂）——
  const card = page.locator(".shot-card").nth(1);
  await card.locator(".shot-edit-toggle").click();
  await card
    .locator(".chart-template-select")
    .selectOption({ label: "媒体镜头（选素材设入出点）" });
  await card.locator(".media-asset-select").selectOption({ index: 0 });
  await card.locator("button.shot-apply").first().click();
  await page
    .locator(".editor-message", { hasText: "已修订" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("绑定", "图片绑定未生效"));

  const bound = await exportProject("project-image.json");
  const shot = bound.shots[1];
  const working = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  const src = working.sceneSource;
  if (src.type !== "media-clip") fail("绑定落库", `场景源 ${src.type}`);
  if (src.inMs !== 0) fail("绑定落库", `图片入点 ${src.inMs} ≠ 0`);
  if (src.audio !== "mute") fail("绑定落库", `图片 audio ${src.audio} ≠ mute`);
  const asset = bound.mediaAssets.find((a) => a.assetId === src.mediaAssetId);
  if (!asset || asset.original.kind !== "image")
    fail("绑定落库", "未指向图片资产");
  if (asset.original.width !== 800 || asset.original.height !== 600)
    fail("资产元数据", `尺寸 ${asset.original.width}×${asset.original.height}`);

  // —— 预览：<img> 舞台渲染——整片预览自动播放，等播放头走到图片镜 ——
  await page
    .locator("img.media-stage")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => fail("预览", "播放期间未见图片预览 img.media-stage"));
  await page.screenshot({ path: path.join(OUT, "bound-preview.png") });

  // —— 保存重开：绑定与显示仍在 ——
  await page.click(".editor-save");
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("保存", "未出现保存提示"));
  await page.click(".project-action");
  await page.locator(".project-open").first().waitFor({ timeout: 15_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 20_000 });
  const reopened = await exportProject("project-reopened.json");
  const reopenedShot = reopened.shots[1];
  const reopenedWorking = reopenedShot.contentVersions.find(
    (v) => v.versionId === reopenedShot.workingVersionId,
  );
  if (reopenedWorking.sceneSource.type !== "media-clip")
    fail("重开", "重开后绑定丢失");
  await page
    .locator("img.media-stage")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => fail("重开", "重开后图片预览消失"));

  // —— 缺失素材错误面：导出的项目里删掉资产 → 重开显示明确错误 ——
  const corrupted = JSON.parse(JSON.stringify(reopened));
  corrupted.mediaAssets = [];
  const corruptedPath = path.join(OUT, "project-missing-asset.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(corruptedPath, JSON.stringify(corrupted));
  await page.click(".project-action");
  await page.locator(".project-import").first().waitFor({ timeout: 15_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15_000 }),
    page.locator(".project-import").first().click(),
  ]);
  await chooser.setFiles(corruptedPath);
  // 文档级缺失面：媒体镜指向不存在的资产 → 严格校验拒绝导入并给明确原因
  //（资产不在账本），不会带病打开。
  await page
    .locator(".editor-message", { hasText: "未指向 mediaAssets" })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(async () => {
      const texts = await page.locator(".editor-message").allTextContents();
      fail(
        "缺失素材错误面",
        `导入损坏件未见明确错误：${texts.join("|").slice(0, 160)}`,
      );
    });

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  console.log(
    "[e2e-image-media] OK: 上传→账本(图片元信息)→绑定(入点0/静音)→预览(img)→保存重开→缺失素材错误面",
  );
} finally {
  await browser.close();
}
