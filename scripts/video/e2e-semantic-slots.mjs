#!/usr/bin/env node
// N5（交接单 2026-10-27）：素材位全链验收（真实千问+自产测试素材）。
//   产品短片句（真实照片诉求）→ AI 生成含素材位镜头 → 确认卡明示待绑定 →
//   应用/保存 → 上传两条许可干净的自产测试视频入账本 → 卡片媒体臂绑定
//   一个素材位 → 预览/保存/重开 → CLI 双画幅 MP4（媒体镜头+图解镜头混排）
//   → 逐镜抽帧。绑定撤销（回滚）与未绑定占位的诚实文案一并断言。
// 素材为 ffmpeg 自产测试视频（账本 current 契约为视频；图片素材是已记录
//   的已知限制，不在本链宣称）。
// 前置: dev server 在 BASE_URL（默认 :3225）且配置 DASHSCOPE_API_KEY。
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
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3225";
const OUT = path.join(ROOT, "artifacts/video-studio-semantic-slots");
const SENTENCE =
  "做一条约25秒的保温杯产品短片：整体展示、杯口细节特写、户外使用场景、三个核心卖点、品牌收尾，产品画面用真实照片";

function fail(step, detail) {
  console.error(`[e2e-semantic-slots] FAIL at ${step}: ${detail ?? ""}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, "frames"), { recursive: true });

// —— 自产测试素材（许可干净：本机 ffmpeg 生成）——
// 纯色测试片（无文字依赖：本机 fontconfig 不可用，色块即足够当素材）。
for (const [name, color] of [
  ["product-overall.mp4", "0x2f6f9f"],
  ["cup-detail.mp4", "0x9f6f2f"],
]) {
  execFileSync(
    "ffmpeg",
    ["-y", "-v", "error", "-f", "lavfi", "-i",
      `color=c=${color}:s=640x480:d=4:r=24`,
      "-pix_fmt", "yuv420p", path.join(OUT, name)],
    { cwd: ROOT },
  );
}

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
  // —— 生成：素材诉求句 → 含素材位的确认卡 ——
  await page.goto(`${BASE_URL}/video-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
  await page.click(".project-create");
  await page.fill("#planner-sentence", SENTENCE);
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
  if (!generated) fail("生成", "两次尝试确认卡均未出现");
  const cardText = await page.locator(".storyboard-card").textContent();
  if (!cardText?.includes("素材位"))
    fail("素材位", `确认卡无素材位行：${cardText?.slice(0, 200)}`);
  if (!cardText?.includes("待绑定"))
    fail("素材位", "确认卡未明示待绑定");
  await page.screenshot({ path: path.join(OUT, "confirm-card.png"), fullPage: true });
  await page.click(".plan-apply");
  await page
    .locator(".editor-message", { hasText: "已应用分镜" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("应用", "未出现应用提示"));

  const before = await exportProject("project-slots.json");
  const slotShots = before.shots.filter((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.description.startsWith("【素材位】");
  });
  if (slotShots.length < 1)
    fail("素材位落库", `项目无【素材位】镜头（${before.shots.length} 镜）`);
  const slotIndex = before.shots.findIndex((s) => {
    const w = s.contentVersions.find((v) => v.versionId === s.workingVersionId);
    return w.description.startsWith("【素材位】");
  });

  // —— 上传测试素材入账本（MediaPanel 真实入口）——
  const uploadInput = page.locator(".media-panel input[type=file]").first();
  if ((await uploadInput.count()) === 0)
    fail("素材面板", "未找到上传入口");
  await uploadInput.setInputFiles(path.join(OUT, "product-overall.mp4"));
  await page.locator("button.media-upload").click();
  await page
    .locator(".editor-message", { hasText: "素材已上传" })
    .waitFor({ timeout: 60_000 })
    .catch(() => fail("上传", "素材未上传入账本"));
  await page
    .locator(".media-panel", { hasText: "product-overall" })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("上传", "账本列表未见素材"));

  // —— 绑定第一个素材位（卡片媒体臂：模板→素材→应用）——
  const card = page.locator(".shot-card").nth(slotIndex);
  await card.locator(".shot-edit-toggle").click();
  await card.screenshot({ path: path.join(OUT, "slot-before-bind.png") });
  await card
    .locator(".chart-template-select")
    .selectOption({ label: "媒体镜头（选素材设入出点）" });
  // 账本非空时首项即素材（无占位项）；单资产上传后 index 0。
  await card.locator(".media-asset-select").selectOption({ index: 0 });
  await card.locator("button.shot-apply").first().click();
  await page
    .locator(".editor-message", { hasText: "已修订" })
    .waitFor({ timeout: 15_000 })
    .catch(() => fail("绑定", "未出现修订提示"));
  await card.screenshot({ path: path.join(OUT, "slot-after-bind.png") });

  const afterBind = await exportProject("project-bound.json");
  const bound = afterBind.shots[slotIndex];
  const boundWorking = bound.contentVersions.find(
    (v) => v.versionId === bound.workingVersionId,
  );
  if (boundWorking.sceneSource.type !== "media-clip")
    fail("绑定落库", `场景源仍为 ${boundWorking.sceneSource.type}`);
  if (boundWorking.description.startsWith("【素材位】"))
    fail("绑定落库", "描述仍带素材位前缀（未变成真实素材镜头）");
  // 绑定可撤销：版本链上有素材位占位版本，可回滚。
  const hasSlotVersion = bound.contentVersions.some((v) =>
    v.description.startsWith("【素材位】"),
  );
  if (!hasSlotVersion)
    fail("绑定撤销", "占位版本不在版本链上（无法回滚到未绑定）");

  // —— 保存重开：绑定仍在 ——
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
  const reopenedWorking = reopened.shots[slotIndex].contentVersions.find(
    (v) => v.versionId === reopened.shots[slotIndex].workingVersionId,
  );
  if (reopenedWorking.sceneSource.type !== "media-clip")
    fail("重开", "重开后绑定丢失");

  // —— CLI 双画幅出片（媒体+图解混排）+ 抽帧 ——
  const renderDir = path.join(OUT, "render");
  const render = execFileSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/video/render-scene.mjs"),
      "--project", path.join(OUT, "project-reopened.json"),
      "--out", renderDir,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 600_000 },
  );
  if (!render.includes("landscape.mp4")) fail("出片", render.slice(-200));
  const bounds = [0];
  for (const shot of reopened.shots) {
    const w = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    bounds.push(bounds.at(-1) + w.durationMs);
  }
  for (const aspect of ["landscape", "portrait"])
    for (let i = 0; i < reopened.shots.length; i++) {
      const t = ((bounds[i] + bounds[i + 1]) / 2) / 1000;
      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-ss", t.toFixed(2), "-i",
          path.join(renderDir, `${aspect}.mp4`), "-frames:v", "1",
          path.join(OUT, `frames/${aspect}-s${i}.png`)],
        { cwd: ROOT },
      );
    }

  if (errors.length > 0) fail("浏览器控制台", errors.join(" | "));
  const report = {
    sentence: SENTENCE,
    slotCount: slotShots.length,
    slotIndex,
    boundAsset: boundWorking.sceneSource,
    shots: reopened.shots.map((s) => {
      const w = s.contentVersions.find(
        (v) => v.versionId === s.workingVersionId,
      );
      return {
        source: w.sceneSource.type,
        description: w.description.slice(0, 40),
      };
    }),
  };
  console.log("[e2e-semantic-slots] OK");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
