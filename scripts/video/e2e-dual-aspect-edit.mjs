#!/usr/bin/env node
// VID-036：双画幅预览与镜头级画幅微调的真实浏览器端到端用例（2026-10-23）。
// 流程：数据样片 → 长标题 + 12 点长标签折线图 → 保存 → 竖版检查（覆写前截图）
// → 画幅微调（标题换行 + 标签间隔 + 短标签）→ 应用/保存/刷新重开 →
// 导出 JSON 断言（layout 仅在竖版）→ SVG 断言（横版不受竖版覆写影响）。
// 产物：before-portrait(-chart).png / after-portrait.png / after-landscape.png /
// export.video-project.json，落在 artifacts/video-studio-dual-aspect-edit-2026-10-23/。
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(
  ROOT,
  "artifacts/video-studio-dual-aspect-edit-2026-10-23",
);
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const LONG_TITLE = "双画幅预览与镜头级微调验收标题";
const TITLE_LINES = "双画幅预览与镜头级微调\n验收标题";
const LINE_DATA = Array.from(
  { length: 12 },
  (_, i) => `第${i + 1}季度表现,${(i + 1) * 9}`,
).join("\n");

const { quantizeTimeline } = await import(
  pathToFileURL(
    path.join(ROOT, "packages/video-document/dist/index.js"),
  ).href
);

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });

  const exportProject = async (name) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".editor-export").click(),
    ]);
    const file = path.join(OUT, `${name}.video-project.json`);
    await download.saveAs(file);
    return JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(file, "utf8")));
  };

  await page.goto(`${BASE_URL}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".sample-card").nth(1).locator(".sample-use").click();
  await page.locator(".shot-card").first().waitFor({ timeout: 45_000 });

  // 1) 长标题（文字镜头）
  const textShot = page.locator(".shot-card").nth(0);
  await textShot.locator(".shot-edit-toggle").click();
  await textShot.locator(".shot-title-input").fill(LONG_TITLE);
  await textShot.locator(".shot-apply").click();
  await textShot.locator(".shot-edit-toggle").click();

  // 2) 折线图模板 + 12 点长标签
  const chartShot = page.locator(".shot-card").nth(1);
  await chartShot.locator(".shot-edit-toggle").click();
  await chartShot
    .locator(".chart-template-select")
    .selectOption("line-trend-8");
  await chartShot.locator(".chart-title-input").fill("十二个数据点压力测试");
  await chartShot.locator(".chart-data-input").fill(LINE_DATA);
  await chartShot.locator(".shot-apply").click();
  await chartShot.locator(".shot-edit-toggle").click();
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });

  const shotFrames = (project) => {
    const durations = project.shots.map((shot) => {
      const version = shot.contentVersions.find(
        (candidate) => candidate.versionId === shot.workingVersionId,
      );
      return version.durationMs;
    });
    return quantizeTimeline(durations, 24).shots.map((span) => ({
      start: span.startFrame,
      frames: span.frames,
    }));
  };
  const parkPiecePreview = async (shotIndex, aspect) => {
    const piece = page.locator(".piece-preview");
    await piece.scrollIntoViewIfNeeded();
    const target = piece
      .getByRole("button", { name: aspect === "portrait" ? "竖版" : "横版" });
    await target.click();
    await page.waitForFunction(
      (viewBox) =>
        document
          .querySelector(".piece-preview .preview-canvas")
          ?.getAttribute("viewBox") === viewBox,
      aspect === "portrait" ? "0 0 720 1280" : "0 0 1280 720",
    );
    // 暂停在目标镜头中段
    await piece.locator(".preview-toggle").click();
    const project = await exportProject("frame-park");
    const span = shotFrames(project)[shotIndex];
    await piece
      .locator(".preview-slider")
      .fill(String(span.start + Math.floor(span.frames / 2)));
    return piece;
  };

  // 3) 覆写前：竖版检查截图（文字镜头 + 折线镜头）
  await (
    await parkPiecePreview(0, "portrait")
  ).screenshot({ path: path.join(OUT, "before-portrait.png") });
  await (
    await parkPiecePreview(1, "portrait")
  ).screenshot({ path: path.join(OUT, "before-portrait-chart.png") });

  // 4) 画幅微调：标题两行 + 折线标签间隔/短标签
  await textShot.locator(".shot-edit-toggle").click();
  await textShot.locator(".layout-title-lines").fill(TITLE_LINES);
  await textShot.locator(".shot-apply").click();
  assert.equal(
    await textShot.locator(".layout-edit-error").count(),
    0,
    "标题换行覆写不应报错",
  );
  await textShot.locator(".shot-edit-toggle").click();

  await chartShot.locator(".shot-edit-toggle").click();
  await chartShot.locator(".layout-label-step").fill("2");
  await chartShot.locator(".layout-short-label-input").first().fill("Q1");
  const hints = await chartShot.locator(".layout-label-hints").innerText();
  assert.match(hints, /已隐藏/);
  assert.match(hints, /截断|已简写/);
  await chartShot.locator(".shot-apply").click();
  assert.equal(
    await chartShot.locator(".layout-edit-error").count(),
    0,
    "标签覆写不应报错",
  );
  await chartShot.locator(".shot-edit-toggle").click();
  await page.locator(".editor-save").click();
  await page
    .locator(".editor-message", { hasText: "已保存" })
    .waitFor({ timeout: 20_000 });

  // 5) 导出 JSON：layout 只在竖版、归属新内容版本
  const edited = await exportProject("export");
  const workingSpecOf = (shotIndex) => {
    const shot = edited.shots[shotIndex];
    const version = shot.contentVersions.find(
      (candidate) => candidate.versionId === shot.workingVersionId,
    );
    return version.sceneSource.spec;
  };
  const textSpec = workingSpecOf(0);
  assert.deepEqual(textSpec.layout.portrait.titleLines, [
    "双画幅预览与镜头级微调",
    "验收标题",
  ]);
  assert.equal(textSpec.layout.landscape, undefined, "横版无覆写");
  const chartSpec = workingSpecOf(1);
  assert.equal(chartSpec.layout.portrait.labelStep, 2);
  assert.deepEqual(chartSpec.layout.portrait.shortLabels, [
    { index: 0, text: "Q1" },
  ]);

  // 6) 刷新重开：覆写随内容版本持久化
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  const reopened = await exportProject("reopened");
  const reopenedText = reopened.shots[0].contentVersions.find(
    (candidate) => candidate.versionId === reopened.shots[0].workingVersionId,
  );
  assert.deepEqual(
    reopenedText.sceneSource.spec.layout.portrait.titleLines,
    ["双画幅预览与镜头级微调", "验收标题"],
  );

  // 7) SVG 级独立生效：竖版两行/横版单行；标签竖版 7 个含 Q1、横版 12 个
  const svgTexts = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(".piece-preview .preview-canvas text"),
      ].map((node) => node.textContent ?? ""),
    );
  await parkPiecePreview(0, "portrait");
  let texts = await svgTexts();
  assert.ok(texts.includes("双画幅预览与镜头级微调"), "竖版标题第 1 行");
  assert.ok(texts.includes("验收标题"), "竖版标题第 2 行");
  assert.ok(
    !texts.includes(LONG_TITLE),
    "竖版不应出现未换行的整条标题",
  );
  await page.locator(".piece-preview").screenshot({
    path: path.join(OUT, "after-portrait.png"),
  });

  await parkPiecePreview(0, "landscape");
  texts = await svgTexts();
  assert.ok(
    texts.includes(LONG_TITLE),
    "横版仍是自动单行（竖版覆写不越界）",
  );

  await parkPiecePreview(1, "portrait");
  texts = await svgTexts();
  const labels = texts.filter((text) => text.includes("季度") || text === "Q1");
  assert.equal(labels.length, 7, `竖版标签应 7 个（间隔 2 + 末点），实得 ${labels.length}`);
  assert.ok(labels.includes("Q1"), "短标签 Q1 生效");
  await parkPiecePreview(1, "landscape");
  texts = await svgTexts();
  assert.equal(
    texts.filter((text) => text.includes("季度")).length,
    12,
    "横版 12 个标签全显（横版无覆写）",
  );
  await page.locator(".piece-preview").screenshot({
    path: path.join(OUT, "after-landscape.png"),
  });

  assert.deepEqual(errors, []);
  console.log("E2E DUAL-ASPECT EDIT PASS");
} finally {
  await browser.close();
}
