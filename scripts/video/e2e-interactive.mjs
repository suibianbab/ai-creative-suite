#!/usr/bin/env node
// P3-A 交互交付 e2e（VID-024，spec §5/R7）：真实浏览器 + file:// + iframe 嵌入。
//   临时目录 D:/tmp/acs-interactive-e2e-<rand>/：复制夹具 → 导出两次（第二次前清空输出）
//   → 双跑 SHA-256 相同 → 交付记录断言 → Chromium 打开 index.html 真实点击/键盘
//   → 宿主页 frameLocator 内点击 → 零非文档请求 / 控制台零 error
//   → 非 spec 镜头失败路径 exit 1 且指名镜头号 → 留存证据 → 清理临时目录。
// 退出码: 0 = 全部断言通过；1 = `[e2e-interactive] FAIL at <步骤>: <原因>`。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { validateVideoProject } from "./delivery.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FIXTURE = path.join(
  ROOT,
  "scripts/video/fixtures/interactive-sample.video-project.json",
);
const CLI = path.join(ROOT, "scripts/video/export-interactive.mjs");
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
const EVIDENCE_DIR = path.join(ROOT, "artifacts/video-studio-interactive");
const EVIDENCE = path.join(EVIDENCE_DIR, "evidence.md");
const EVIDENCE_INDEX = path.join(EVIDENCE_DIR, "index.html");
const EVIDENCE_HOST = path.join(EVIDENCE_DIR, "host.html");
const EVIDENCE_PROJECT = path.join(EVIDENCE_DIR, "e2e.video-project.json");
const EXPECTED_STEPS = 3;
const EXPECTED_FRAME_MAP = [24, 37, 24];

// fail()/顶层 catch 在退出前尽力关闭浏览器并清理临时目录；模块级变量的目的是让两条
// 路径都能访问到同一份引用（进程内其他异常也不会漏掉清理）。
let browser = null;
let tempDir = null;

function describeError(error) {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  return error.message ?? String(error);
}

function cleanupTemp() {
  if (!tempDir) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  } catch {
    // 清理失败不能掩盖原始失败原因。
  }
}

async function cleanupAll() {
  try {
    await browser?.close();
  } catch {
    // 关闭失败不掩盖原始失败原因。
  }
  browser = null;
  cleanupTemp();
}

async function fail(step, error) {
  console.error(`[e2e-interactive] FAIL at ${step}: ${describeError(error)}`);
  await cleanupAll();
  process.exit(1);
}

async function at(step, fn) {
  try {
    return await fn();
  } catch (error) {
    await fail(step, error);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function usageLines() {
  try {
    return readFileSync(USAGE_LEDGER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch (error) {
    // 契约（spec §7）：台账缺失按 0 行；其他读取错误必须暴露。
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

// spec §5.2：产物必须自包含（零外部引用、零网络 API、中文 lang）。
// SVG 的 `xmlns=` 是命名空间声明，不在禁列；按外部引用/网络调用的键名收窄。
function assertSelfContained(html) {
  for (const token of ["src=", "href=", "<link", "fetch(", "XMLHttpRequest"])
    assert.ok(
      !html.includes(token),
      `index.html 不应含外部引用/网络调用: ${token}`,
    );
  assert.ok(html.includes('lang="zh-CN"'), 'index.html 缺少 lang="zh-CN"');
  assert.ok(html.includes('data-total="3"'), "data-total 不是 3");
}

// 清空 --out 后跑一次 CLI：out 目录必须由本次运行重新生成。
function exportOnce(projectPath, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [CLI, "--project", projectPath, "--out", outDir],
    { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `CLI exit ${result.status}: ${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  const htmlPath = path.join(outDir, "index.html");
  if (!existsSync(htmlPath)) throw new Error(`产物不存在: ${htmlPath}`);
  return { htmlPath, stdout: (result.stdout ?? "").trim() };
}

// spec §5.8：交付记录逐字段断言（版本、空 renderIds、正整数 frameMap、摘要与实测一致）。
function assertDeliveryRecord(
  project,
  { savedVersion, count, digest, versionIds },
) {
  assert.equal(project.savedVersion, savedVersion, "savedVersion 未按次 +1");
  assert.equal(project.deliveries.length, count, "交付记录条数不符");
  const delivery = project.deliveries.at(-1);
  assert.equal(delivery.kind, "interactive-html", "kind 不符");
  assert.equal(delivery.outputRef, "index.html", "outputRef 不符");
  assert.deepEqual(delivery.versionIds, versionIds, "versionIds 不符");
  assert.deepEqual(delivery.renderIds, [], "renderIds 必须为空数组");
  assert.deepEqual(delivery.frameMap, EXPECTED_FRAME_MAP, "frameMap 不符");
  assert.match(delivery.digest, /^[0-9a-f]{64}$/, "digest 形状不符");
  assert.equal(delivery.digest, digest, "digest 与实测哈希不一致");
  return delivery;
}

function mediaClipProject() {
  // 最小资产账本：先让文档校验通过，再撞上「仅 spec」门禁（与单测构造一致）。
  const project = structuredClone(
    validateVideoProject(JSON.parse(readFileSync(FIXTURE, "utf8"))),
  );
  const assetId = "88888888-8888-4888-8888-888888888888";
  const shot = project.shots.find((candidate) => candidate.order === 1);
  const version = shot.contentVersions.find(
    (candidate) => candidate.versionId === shot.workingVersionId,
  );
  version.sceneSource = {
    type: "media-clip",
    mediaAssetId: assetId,
    inMs: 0,
    outMs: version.durationMs,
    fit: "cover",
    focalX: 0.5,
    audio: "mute",
  };
  project.mediaAssets = [
    {
      assetId,
      createdAt: "2026-10-21T00:00:00.000Z",
      origin: { kind: "local-upload", fileName: "demo.mp4" },
      original: {
        sha256: "a".repeat(64),
        bytes: 123456,
        durationMs: 30000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        hasAudio: true,
        storeKey: `${"a".repeat(16)}.mp4`,
      },
    },
  ];
  return validateVideoProject(project);
}

async function main() {
  const usageBefore = await at("计费台账（读取前）", () => usageLines());
  const fixtureProject = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const expectedVersionIds = [...fixtureProject.shots]
    .sort((a, b) => a.order - b.order)
    .map((shot) => shot.workingVersionId);

  tempDir = path.join(
    "D:/tmp",
    `acs-interactive-e2e-${randomUUID().slice(0, 8)}`,
  );
  const projectPath = path.join(tempDir, "sample.video-project.json");
  const outDir = path.join(tempDir, "out");

  await at("临时目录与夹具", () => {
    mkdirSync(tempDir, { recursive: true });
    copyFileSync(FIXTURE, projectPath);
  });

  // —— 导出两次（第二次前清空输出）与交付记录 ——
  const run1 = await at("导出 run1", () => {
    const result = exportOnce(projectPath, outDir);
    return {
      ...result,
      hash: sha256(result.htmlPath),
      bytes: readFileSync(result.htmlPath).byteLength,
    };
  });

  const delivery1 = await at("自包含与交付记录 run1", () => {
    const html = readFileSync(run1.htmlPath, "utf8");
    assertSelfContained(html);
    const project = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
    return assertDeliveryRecord(project, {
      savedVersion: 2,
      count: 1,
      digest: run1.hash,
      versionIds: expectedVersionIds,
    });
  });

  const run2 = await at("导出 run2", () => {
    const result = exportOnce(projectPath, outDir);
    return {
      ...result,
      hash: sha256(result.htmlPath),
      bytes: readFileSync(result.htmlPath).byteLength,
    };
  });

  const delivery2 = await at("交付记录 run2", () => {
    assert.equal(run2.hash, run1.hash, "双跑 index.html SHA-256 不一致");
    assert.equal(run2.bytes, run1.bytes, "双跑 index.html 字节数不一致");
    const project = validateVideoProject(
      JSON.parse(readFileSync(projectPath, "utf8")),
    );
    return assertDeliveryRecord(project, {
      savedVersion: 3,
      count: 2,
      digest: run2.hash,
      versionIds: expectedVersionIds,
    });
  });

  // —— 真实浏览器：file:// 逐步交互 ——
  const indexUrl = pathToFileURL(run2.htmlPath).href;
  const mainRequests = [];
  const consoleErrors = [];

  await at("启动浏览器", async () => {
    browser = await chromium.launch({ headless: true });
  });
  const context = await at("浏览器上下文", () =>
    browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
    }),
  );

  const mainPage = await at("打开 file:// 页面", async () => {
    const page = await context.newPage();
    page.on("request", (request) => mainRequests.push(request.url()));
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push(`[page] ${message.text().slice(0, 300)}`);
    });
    page.on("pageerror", (error) =>
      consoleErrors.push(`[pageerror] ${describeError(error).slice(0, 300)}`),
    );
    await page.goto(indexUrl, { waitUntil: "load", timeout: 30_000 });
    return page;
  });

  const stage1 = await at("第 1 步初始态", async () => {
    await mainPage.locator("#stage svg").first().waitFor({ timeout: 10_000 });
    assert.equal(
      await mainPage.locator("body").getAttribute("data-total"),
      "3",
    );
    assert.equal(await mainPage.locator("body").getAttribute("data-step"), "1");
    assert.equal(await mainPage.locator("#prev").isDisabled(), true);
    assert.equal(await mainPage.locator("#next").isDisabled(), false);
    return mainPage.locator("#stage").innerHTML();
  });

  await at("点击下一步 → 第 2 步", async () => {
    await mainPage.click("#next");
    await mainPage.locator('body[data-step="2"]').waitFor({ timeout: 5_000 });
    const stage2 = await mainPage.locator("#stage").innerHTML();
    assert.notEqual(stage2, stage1, "切步后舞台内容未变化");
  });

  await at("ArrowRight → 第 3 步（下一步禁用）", async () => {
    await mainPage.keyboard.press("ArrowRight");
    await mainPage.locator('body[data-step="3"]').waitFor({ timeout: 5_000 });
    assert.equal(await mainPage.locator("#next").isDisabled(), true);
    assert.equal(await mainPage.locator("#prev").isDisabled(), false);
  });

  await at("ArrowLeft → 第 2 步", async () => {
    await mainPage.keyboard.press("ArrowLeft");
    await mainPage.locator('body[data-step="2"]').waitFor({ timeout: 5_000 });
  });

  const stageBackAtOne = await at("Home → 第 1 步", async () => {
    await mainPage.keyboard.press("Home");
    await mainPage.locator('body[data-step="1"]').waitFor({ timeout: 5_000 });
    const inner = await mainPage.locator("#stage").innerHTML();
    assert.equal(inner, stage1, "Home 回到第 1 步后舞台内容与初始不一致");
    return inner;
  });

  // 重新开始必须在第 1 步也替换舞台子节点（重播当前步动画）。
  await at("第 1 步重新开始（MutationObserver）", async () => {
    await mainPage.evaluate(() => {
      const stage = document.getElementById("stage");
      window.__acsRestartMutations = 0;
      window.__acsRestartObserver = new MutationObserver((records) => {
        for (const record of records)
          window.__acsRestartMutations +=
            record.addedNodes.length + record.removedNodes.length;
      });
      window.__acsRestartObserver.observe(stage, { childList: true });
    });
    await mainPage.click("#restart");
    await mainPage.waitForFunction(
      () => window.__acsRestartMutations > 0,
      null,
      { timeout: 5_000 },
    );
    assert.equal(await mainPage.locator("body").getAttribute("data-step"), "1");
    assert.equal(
      await mainPage.locator("#stage").innerHTML(),
      stageBackAtOne,
      "重新开始后舞台内容不是第 1 步",
    );
    await mainPage.evaluate(() => window.__acsRestartObserver?.disconnect());
  });

  // —— 宿主页 iframe：frameLocator 内真实点击 ——
  // 宿主页与 index.html 同目录：`src="index.html"` 才能解析到同一文件。
  const hostPath = path.join(outDir, "host.html");
  const hostRequests = [];
  await at("宿主页 iframe 嵌入", async () => {
    writeFileSync(
      hostPath,
      [
        "<!doctype html>",
        '<html lang="zh-CN">',
        '<head><meta charset="utf-8"><title>交互页面宿主</title></head>',
        "<body>",
        '<iframe id="frame" src="index.html" width="960" height="540"></iframe>',
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
    const page = await context.newPage();
    page.on("request", (request) => hostRequests.push(request.url()));
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push(`[host] ${message.text().slice(0, 300)}`);
    });
    page.on("pageerror", (error) =>
      consoleErrors.push(
        `[host:pageerror] ${describeError(error).slice(0, 300)}`,
      ),
    );
    await page.goto(pathToFileURL(hostPath).href, {
      waitUntil: "load",
      timeout: 30_000,
    });
    const frame = page.frameLocator("#frame");
    await frame.locator("#stage svg").first().waitFor({ timeout: 10_000 });
    assert.equal(await frame.locator("body").getAttribute("data-step"), "1");
    await frame.locator("#next").click();
    await frame.locator('body[data-step="2"]').waitFor({ timeout: 5_000 });
  });
  const hostUrl = pathToFileURL(hostPath).href;

  // —— 零网络（只允许两个文档 URL）与控制台零 error ——
  await at("零网络与控制台", async () => {
    const mainAllowed = new Set([indexUrl]);
    const hostAllowed = new Set([hostUrl, indexUrl]);
    const unexpected = [
      ...mainRequests
        .filter((url) => !mainAllowed.has(url))
        .map((url) => `[page] ${url}`),
      ...hostRequests
        .filter((url) => !hostAllowed.has(url))
        .map((url) => `[host] ${url}`),
    ];
    assert.deepEqual(unexpected, [], "出现文档外的网络/资源请求");
    assert.ok(mainRequests.length > 0, "未观察到 index.html 文档请求");
    assert.ok(
      hostRequests.includes(indexUrl),
      "未观察到 iframe 内的 index.html 文档请求",
    );
    assert.deepEqual(consoleErrors, [], "控制台出现 error");
  });

  await at("关闭浏览器", async () => {
    await browser.close();
    browser = null;
  });

  // —— 失败路径：非 spec 镜头必须整次失败并报镜头号 ——
  const failureMessage = await at("失败路径（media-clip）", () => {
    const failureProject = path.join(tempDir, "media.video-project.json");
    const failureOut = path.join(tempDir, "media-out");
    writeFileSync(
      failureProject,
      `${JSON.stringify(mediaClipProject(), null, 2)}\n`,
    );
    const before = readFileSync(failureProject);
    const result = spawnSync(
      process.execPath,
      [CLI, "--project", failureProject, "--out", failureOut],
      { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
    );
    const message = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    assert.equal(result.status, 1, `CLI 应 exit 1，实际 ${result.status}`);
    assert.match(message, /镜头 2/, "失败文案未指名镜头 2");
    assert.match(message, /不是 spec/, "失败文案未说明「不是 spec」");
    assert.match(message, /media-clip/, "失败文案未点明 media-clip");
    assert.ok(
      !existsSync(path.join(failureOut, "index.html")),
      "失败路径不应产出 index.html",
    );
    assert.deepEqual(
      readFileSync(failureProject),
      before,
      "失败路径不应改写项目文件",
    );
    return message;
  });

  // —— 证据留存（spec §7，全部 untracked、不入库；先复制再删临时目录） ——
  const usageAfter = await at("计费台账（读取后）", () => usageLines());
  await at("证据留存", () => {
    assert.equal(usageAfter, usageBefore, "TTS 台账行数发生变化");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    copyFileSync(run2.htmlPath, EVIDENCE_INDEX);
    copyFileSync(hostPath, EVIDENCE_HOST);
    copyFileSync(projectPath, EVIDENCE_PROJECT);
    writeFileSync(
      EVIDENCE,
      [
        "# VID-024 交互 HTML 交付 e2e 证据",
        "",
        "- 日期：2026-10-21",
        "- 命令：`node scripts/video/e2e-interactive.mjs`（Playwright Chromium，headless）",
        `- 夹具：\`scripts/video/fixtures/interactive-sample.video-project.json\`（复制到临时目录 \`${tempDir}\`，tracked 夹具未改动）`,
        "- 留存文件（均 untracked，不入库）：`index.html`（导出产物）、`host.html`（iframe 宿主页）、`e2e.video-project.json`（两次导出后的项目 JSON，含 2 条交付记录）",
        '- 自包含：无 `src=`/`href=`/`<link`/`fetch(`/`XMLHttpRequest`；含 `lang="zh-CN"` 与 `data-total="3"`',
        `- 步骤数：${EXPECTED_STEPS}（\`data-total="3"\`）`,
        `- frameMap：${JSON.stringify(EXPECTED_FRAME_MAP)}（共 ${EXPECTED_FRAME_MAP.reduce((sum, frames) => sum + frames, 0)} 帧）`,
        `- index.html 字节数：${run1.bytes}（双跑一致）`,
        `- 双跑 SHA-256：\`${run1.hash}\`（两次独立导出，第二次前清空输出目录，逐字节一致）`,
        `- 交付记录：\`${delivery1.deliveryId}\`（短 id \`${delivery1.deliveryId.slice(0, 8)}\`），kind=\`interactive-html\`，outputRef=\`index.html\``,
        `- 交付记录：savedVersion 1 → 2 → 3；deliveries 1 → 2；第二条 \`${delivery2.deliveryId.slice(0, 8)}\``,
        `- 交付记录摘要：digest=${run2.hash}；renderIds=[]；frameMap=${JSON.stringify(delivery2.frameMap)}`,
        `- TTS 台账：${usageBefore} → ${usageAfter} 行（零计费）`,
        "- 浏览器断言：file:// 第 1 步（舞台含 SVG、上一步禁用）→ 点击下一步到第 2 步且舞台内容变化 → ArrowRight 到第 3 步（下一步禁用）→ ArrowLeft 回第 2 步 → Home 回第 1 步；第 1 步点重新开始触发 `#stage` childList 替换（MutationObserver）",
        "- 嵌入断言：宿主页 iframe（file://）内 frameLocator 点击下一步，`data-step` 1 → 2",
        "- 零网络：主页面仅 index.html 文档请求；宿主页仅 host.html + index.html 文档请求；控制台 0 error",
        `- 失败路径：第 2 镜头改 media-clip 后 CLI exit 1，文案含镜头号：${failureMessage.replace(/\r?\n/g, " ")}`,
        "",
      ].join("\n"),
    );
  });

  cleanupTemp();
  console.log(
    `[e2e-interactive] OK: 3 步 / ${run1.bytes} 字节 / 双跑 SHA-256 ${run1.hash} / 交付 ${delivery1.deliveryId.slice(0, 8)} / 台账 ${usageBefore}→${usageAfter}`,
  );
}

// 顶层兜底：main() 内未被 at() 包裹的意外异常（夹具读取/JSON.parse 等）也统一报错、
// 关闭浏览器并删除临时目录，避免以裸堆栈结束。
await main().catch(async (error) => {
  console.error(`[e2e-interactive] FAIL at 启动: ${describeError(error)}`);
  await cleanupAll();
  process.exit(1);
});
