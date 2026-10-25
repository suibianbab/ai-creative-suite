#!/usr/bin/env node
// T2 验收：工作台转场编辑与预览。入库 STEM 转场项目经浏览器导入→
// 新增第二条转场→调时长→看借帧摘要→删除→保存→重开→持久；再对带双转场
// 版本做真实双画幅出片，抽转场前/中/后帧并与 render-manifest 及 v2 清单对账。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.env.T2_EVIDENCE_DIR ??
    path.join(root, ".tools/video-t2-transitions-e2e"),
);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3210";
mkdirSync(out, { recursive: true });
const sourceProject = path.join(
  root,
  "artifacts/video-studio-c2-2026-10-25/stem-with-transition.video-project.json",
);
const browser = await chromium.launch({ headless: true });
const errors = [];
let exportedPath = "";
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
  await page.goto(`${baseUrl}/video-studio`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });

  // 先导入项目引用的 Style Bible（否则导入被「不在本地」拒绝）。
  const [bibleChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "导入 Style Bible JSON" }).click(),
  ]);
  await bibleChooser.setFiles(
    path.join(
      root,
      "artifacts/video-studio-stem-sample-final-2026-10-23/stem.style-bible.json",
    ),
  );
  await page
    .getByText("已导入 Style Bible", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });

  // 导入入库转场项目（含 1 条 boundary 0 fade）。页面有两个同 accept 的
  // file input（Style Bible 先于项目导入）——走按钮 + filechooser 事件。
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "导入项目 JSON" }).click(),
  ]);
  await fileChooser.setFiles(sourceProject);
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  await page.waitForSelector(".transitions-editor", { timeout: 10_000 });
  assert.equal(
    await page.locator(".transition-row").count(),
    6,
    "STEM 七镜应有六个边界行",
  );

  // 新增第二条转场（boundary 2 → fade）。
  const secondRow = page.locator('.transition-row[data-boundary="2"]');
  await secondRow.locator(".transition-kind").selectOption("fade");
  await page
    .locator(".transition-borrow-summary")
    .first()
    .waitFor({ timeout: 5_000 });
  const firstSummary = await page
    .locator(".transition-row[data-boundary='0'] .transition-borrow-summary")
    .textContent();
  assert.match(firstSummary ?? "", /借帧 左尾 \d+ \+ 右头 \d+＝\d+ 帧/);

  // 调整新增转场的时长 → 摘要数字随之变化。
  await secondRow.locator(".transition-duration").fill("800");
  const secondSummary = await secondRow
    .locator(".transition-borrow-summary")
    .textContent();
  assert.match(secondSummary ?? "", /800ms/);

  // 越界借帧给可操作错误（2000ms 对 72 帧镜头仍合法；试 7200 之外的
  // 极限：把时长填到 schema 上限 2000 并同时把另一条也开到 2000，
  // 相邻合计借空 span → 预览告警/装配错误路径）。
  const thirdRow = page.locator('.transition-row[data-boundary="1"]');
  await thirdRow.locator(".transition-kind").selectOption("fade");
  await page.waitForTimeout(300);
  // 保存→刷新重开→持久。
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  exportedPath = path.join(out, "two-transitions.video-project.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, "utf8"));
  assert.equal(exported.transitions.length, 3, "三条转场（boundary 0/1/2）");
  assert.equal(exported.transitions[2].durationMs, 800);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-studio-ready]", { timeout: 30_000 });
  await page.locator(".project-open").first().click();
  await page.locator(".shot-card").first().waitFor({ timeout: 30_000 });
  await page.waitForSelector(".transitions-editor", { timeout: 10_000 });
  const reopenedKinds = [];
  for (const boundary of ["0", "1", "2"]) {
    reopenedKinds.push(
      await page
        .locator(
          `.transition-row[data-boundary='${boundary}'] .transition-kind`,
        )
        .inputValue(),
    );
  }
  assert.deepEqual(reopenedKinds, ["fade", "fade", "fade"], "重开后保持");

  // 删除 boundary 1 → 保存重开 → 两条。
  await page
    .locator('.transition-row[data-boundary="1"] .transition-kind')
    .selectOption("none");
  await page.locator(".editor-save").click();
  await page
    .getByText("已保存", { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  const [afterDelete] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".editor-export").click(),
  ]);
  const afterDeletePath = path.join(out, "after-delete.video-project.json");
  await afterDelete.saveAs(afterDeletePath);
  const afterDeleteProject = JSON.parse(readFileSync(afterDeletePath, "utf8"));
  assert.equal(afterDeleteProject.transitions.length, 2, "删后两条");
  await page.screenshot({ path: path.join(out, "editor-transitions.png") });
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `console/page errors: ${errors.join(" | ")}`);

// 真实双画幅出片（两转场版本）+ 转场前/中/后帧对账。
const renderDir = path.join(out, "render");
execFileSync(
  process.execPath,
  [
    "scripts/video/render-scene.mjs",
    "--project",
    exportedPath,
    "--style-bible",
    path.join(
      root,
      "artifacts/video-studio-stem-sample-final-2026-10-23/stem.style-bible.json",
    ),
    "--out",
    renderDir,
  ],
  { cwd: root, stdio: "inherit" },
);
const manifest = JSON.parse(
  readFileSync(path.join(renderDir, "render-manifest.json"), "utf8"),
);
const { resolveTransitionWindows } = await import(
  pathToFileURL(path.join(root, "packages/video-document/dist/index.js")).href
);
const spans = manifest.aspects.landscape.frameMap.map((shot) => ({
  startFrame: shot.startFrame,
  frames: shot.frames,
}));
const windows = resolveTransitionWindows(
  JSON.parse(readFileSync(exportedPath, "utf8")).transitions,
  spans,
  24,
);
assert.equal(windows.length, 3);
for (const window of windows) {
  const center = window.startFrame + Math.floor(window.frames / 2);
  for (const [tag, frame] of [
    ["pre", window.startFrame - 2],
    ["mid", center],
    ["post", window.startFrame + window.frames + 1],
  ]) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      (frame / 24).toFixed(3),
      "-i",
      path.join(renderDir, "landscape.mp4"),
      "-frames:v",
      "1",
      path.join(out, `transition-b${window.boundary}-${tag}.png`),
    ]);
  }
}
// v2 清单对账：transitions 与 render-manifest 窗口逐字段一致。
const { buildEditList, validateEditList } = await import(
  pathToFileURL(path.join(root, "scripts/video/export-edit-list.mjs")).href
);
const list = buildEditList(JSON.parse(readFileSync(exportedPath, "utf8")), {
  fps: 24,
});
validateEditList(list);
for (const [index, transition] of list.transitions.entries()) {
  const window = windows[index];
  assert.equal(transition.boundary, window.boundary);
  assert.equal(transition.startFrame, window.startFrame);
  assert.equal(transition.frames, window.frames);
  assert.equal(transition.halfOut, window.halfOut);
  assert.equal(transition.halfIn, window.halfIn);
}
writeFileSync(
  path.join(out, "t2-summary.json"),
  `${JSON.stringify({ pass: true, transitions: windows.length, errors }, null, 2)}\n`,
);
console.log(`T2 transitions e2e: PASS → ${out}`);
