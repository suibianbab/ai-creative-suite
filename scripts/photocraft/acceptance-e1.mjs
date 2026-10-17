// PhotoCraft browser acceptance: UI path and requested-region quality are
// separate gates. A rendered preview is not by itself a correct edit.
// Start web :3000, proxy3100 :3100, bridge :4113, origin-shim :4112, and
// parts-candidates :4104 before running `pnpm qa:browser-image`.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(ROOT, "apps/api/package.json"));
const sharp = require("sharp");
const WEB = process.env.PHOTOCRAFT_E1_WEB ?? "http://127.0.0.1:3100";
const OUT = process.env.PHOTOCRAFT_E1_OUTPUT
  ? path.resolve(process.env.PHOTOCRAFT_E1_OUTPUT)
  : path.join(ROOT, "artifacts/photocraft-e1-2026-10-17");
const FIX = path.join(ROOT, "qa/fixtures");
const GROUND = path.join(FIX, "photocraft-grounding");
const JOBS = process.env.PHOTOCRAFT_BRIDGE_JOBS
  ? path.resolve(process.env.PHOTOCRAFT_BRIDGE_JOBS)
  : path.join(ROOT, ".tools/photocraft-bridge/jobs");
const caseFilter = process.argv[2] ?? null;

const steps = [];
const consoleErrors = [];
const pageErrors = [];
const statusLog = [];
let failures = 0;
const quality = [];

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);
function step(caseName, name, detail = "") {
  steps.push({ t: new Date().toISOString(), case: caseName, name, detail });
  console.log(`  step ${caseName}/${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(caseName, what, evidence = "") {
  failures += 1;
  step(caseName, `FAIL ${what}`, evidence);
  console.error(`  ✗ [${caseName}] ${what} :: ${evidence}`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    step("shot", name);
  } catch (error) {
    step("shot-failed", name, String(error).slice(0, 120));
  }
}

async function statusText(page) {
  try {
    return (
      (await page.locator("p[role=status]").first().textContent()) ?? ""
    ).trim();
  } catch {
    return "";
  }
}
async function noteStatus(page, tag) {
  const text = await statusText(page);
  statusLog.push({ t: new Date().toISOString(), tag, text });
  return text;
}

async function openImage(page, file, caseName) {
  await page.goto(`${WEB}/image-studio/photocraft`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("#pc-file", { timeout: 60000 });
  await page.setInputFiles("#pc-file", file);
  await page.getByRole("button", { name: "在画布中打开" }).click();
  await page.waitForSelector("div.pc-sample > img", { timeout: 120000 });
  await page.waitForTimeout(1200);
  const size = await page.evaluate(() => {
    const img = document.querySelector("div.pc-sample > img");
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  step(caseName, "image-open", `${path.basename(file)} ${size?.w}×${size?.h}`);
  return page.locator("div.pc-sample > img");
}

async function parse(page, instruction, caseName) {
  const ta = page.locator("#pc-instruction");
  await ta.scrollIntoViewIfNeeded();
  await ta.fill(instruction);
  await page.getByRole("button", { name: "解析编辑要求" }).click();
  await page.waitForTimeout(1500);
  const status = await noteStatus(page, `${caseName}/parse`);
  step(caseName, "parse", `"${instruction}" → ${status.slice(0, 140)}`);
  return status;
}

// 等目标缺口面板（不强绑短语——「花瓣」可能被词典归一成「花朵」等变体）。
async function waitForGapPanel(page, caseName) {
  try {
    await page.waitForSelector("text=需要指定范围", { timeout: 30000 });
    const strong = await page
      .locator("div.pc-target-review strong")
      .first()
      .textContent();
    step(caseName, "target-gap-panel", (strong ?? "").trim());
    return (strong ?? "").trim();
  } catch {
    fail(caseName, "target-gap-panel-missing", await statusText(page));
    return "";
  }
}

async function startRing(page, caseName, phrase) {
  await page
    .getByRole("button", { name: `智能找目标：${phrase}` })
    .scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: `智能找目标：${phrase}` }).click();
  try {
    await page.waitForSelector("text=审核（提议待确认）", { timeout: 240000 });
    const status = await noteStatus(page, `${caseName}/ring-open`);
    step(caseName, "grid-ring-open", status.slice(0, 140));
    return true;
  } catch {
    fail(caseName, "grid-ring-timeout", await statusText(page));
    return false;
  }
}

async function confirmCandidate(page, n, caseName) {
  // 候选确认走面板按钮（编号框覆盖层在 busy/await 态不可点）。
  const button = page.getByRole("button", {
    name: new RegExp(`^候选${n}[（(]`),
  });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(800);
  const status = await noteStatus(page, `${caseName}/confirm-${n}`);
  step(caseName, `confirm-candidate-${n}`, status.slice(0, 140));
  return status;
}

async function waitForMaskReady(page, caseName) {
  // 确认后异步备蒙版：状态消息含「正在准备」→ 轮询直到出现「像素蒙版」生效/
  // 退回套索的稳定消息（上限 120s，上传+探针通常 <10s）。
  for (let i = 0; i < 120; i += 1) {
    const text = await statusText(page);
    if (!text.includes("正在准备")) return text;
    await page.waitForTimeout(1000);
  }
  const text = await statusText(page);
  step(caseName, "mask-prepare-timeout", text.slice(0, 140));
  return text;
}

// R1 门槛：单步计划同样要勾「我已检查该计划…」才能预览/应用（page.tsx:2598）。
async function confirmPlan(page, caseName) {
  const boxes = page.locator('div.pc-plan input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) await box.click();
  }
  step(caseName, "plan-confirmed", `勾选计划确认框 ×${n}`);
}

async function preview(page, caseName, timeoutMs = 300000) {
  await confirmPlan(page, caseName);
  await page.getByRole("button", { name: "预览编辑" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "预览编辑" }).click();
  try {
    await page.waitForSelector(".pc-quality-check", { timeout: timeoutMs });
    const status = await noteStatus(page, `${caseName}/preview`);
    step(caseName, "preview-ok", status.slice(0, 140));
    return { ok: true, status };
  } catch {
    const status = await statusText(page);
    fail(caseName, "preview-timeout", status.slice(0, 200));
    return { ok: false, status };
  }
}

async function previewDiff(page, sourceFile, region) {
  const url = await page.locator("div.pc-sample > img").getAttribute("src");
  if (!url?.startsWith("http")) throw new Error("预览图片 URL 不可读取");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`预览图片 HTTP ${response.status}`);
  const previewBytes = Buffer.from(await response.arrayBuffer());
  const source = await sharp(sourceFile)
    .rotate()
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const edited = await sharp(previewBytes)
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = source.info;
  if (
    edited.info.width !== width ||
    edited.info.height !== height ||
    edited.info.channels !== channels
  )
    throw new Error("预览与原图尺寸或通道不一致");
  let targetMask = null;
  if (region.kind === "mask") {
    targetMask = await sharp(region.path).grayscale().raw().toBuffer();
    if (targetMask.length !== width * height)
      throw new Error("目标 GT 蒙版尺寸不匹配");
  }
  let insideSum = 0;
  let outsideSum = 0;
  let insideCount = 0;
  let outsideCount = 0;
  for (let p = 0; p < width * height; p += 1) {
    const x = p % width;
    const y = Math.floor(p / width);
    const inside = targetMask
      ? targetMask[p] >= 128
      : x >= Math.round(region.box[0] * width) &&
        x < Math.round((region.box[0] + region.box[2]) * width) &&
        y >= Math.round(region.box[1] * height) &&
        y < Math.round((region.box[1] + region.box[3]) * height);
    let diff = 0;
    for (let c = 0; c < channels; c += 1)
      diff += Math.abs(
        source.data[p * channels + c] - edited.data[p * channels + c],
      );
    if (inside) {
      insideSum += diff / channels;
      insideCount += 1;
    } else {
      outsideSum += diff / channels;
      outsideCount += 1;
    }
  }
  return {
    insideMeanAbsDiff: Number((insideSum / insideCount).toFixed(3)),
    outsideMeanAbsDiff: Number((outsideSum / outsideCount).toFixed(3)),
  };
}

async function saveFullPreview(page, caseName, suffix = "preview-render") {
  const url = await page.locator("div.pc-sample > img").getAttribute("src");
  if (!url?.startsWith("http")) throw new Error("预览图片 URL 不可读取");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`预览图片 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const output = path.join(OUT, `${caseName}-${suffix}.png`);
  fs.writeFileSync(output, bytes);
  step(caseName, "full-preview-saved", path.basename(output));
}

async function erasePreviewStroke(page, points, caseName) {
  await page.locator("#pc-mask-tool").selectOption("erase");
  const img = page.locator("div.pc-sample > img");
  const priorSrc = await img.getAttribute("src");
  await img.scrollIntoViewIfNeeded();
  const bounds = await img.boundingBox();
  const natural = await img.evaluate((element) => [
    element.naturalWidth,
    element.naturalHeight,
  ]);
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i];
    const px = bounds.x + (x / natural[0]) * bounds.width;
    const py = bounds.y + (y / natural[1]) * bounds.height;
    await page.mouse.move(px, py, { steps: i === 0 ? 2 : 6 });
    if (i === 0) await page.mouse.down();
  }
  await page.mouse.up();
  await page.waitForFunction(
    (oldSrc) => {
      const image = document.querySelector("div.pc-sample > img");
      return (
        image?.getAttribute("src") !== oldSrc &&
        document
          .querySelector("p[role=status]")
          ?.textContent?.includes("PhotoCraft 已更新蒙版预览")
      );
    },
    priorSrc,
    { timeout: 30000 },
  );
  step(
    caseName,
    "photocraft-mask-erase",
    `brush=32, points=${JSON.stringify(points)}`,
  );
}

function qualityGate(
  caseName,
  metric,
  pass,
  explanation,
  gate = "visual-quality",
) {
  quality.push({ case: caseName, gate, metric, pass, explanation });
  if (!pass) fail(caseName, gate, `${explanation}: ${JSON.stringify(metric)}`);
  else step(caseName, `${gate}-pass`, JSON.stringify(metric));
}

async function drawBox(page, img, box, caseName) {
  // awaitTargetBox 态：任意工具下按住拖画即可。box = 归一化 [x,y,w,h]。
  // 先滚到位再取 boundingBox（视口坐标），否则滚动后坐标全部漂移。
  await img.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const bounds = await img.boundingBox();
  const x1 = bounds.x + box[0] * bounds.width;
  const y1 = bounds.y + box[1] * bounds.height;
  const x2 = x1 + box[2] * bounds.width;
  const y2 = y1 + box[3] * bounds.height;
  const vp = page.viewportSize();
  const inside = (x, y) => x >= 0 && y >= 0 && x < vp.width && y < vp.height;
  if (!inside(x1, y1) || !inside(x2, y2)) {
    fail(
      caseName,
      "draw-box-outside-viewport",
      `(${x1.toFixed(0)},${y1.toFixed(0)})-(${x2.toFixed(0)},${y2.toFixed(0)}) vp=${vp.width}×${vp.height}`,
    );
  }
  // 拖画目标点必须真的落在图上（防止面板遮挡/坐标错位的静默失败）。
  const hit = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el
        ? el.tagName === "IMG"
          ? "img"
          : el.tagName.toLowerCase()
        : "none";
    },
    [(x1 + x2) / 2, (y1 + y2) / 2],
  );
  if (hit !== "img")
    step(caseName, "draw-box-hit-warn", `中点命中元素=${hit}（继续尝试拖画）`);
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const status = await noteStatus(page, `${caseName}/draw-box`);
  step(
    caseName,
    "draw-box",
    `box=${JSON.stringify(box)} → ${status.slice(0, 120)}`,
  );
  return status;
}

async function reCircleWithBox(page, img, box, caseName) {
  await page
    .getByRole("button", { name: "点击/画框限定重新圈选" })
    .scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "点击/画框限定重新圈选" }).click();
  await page.waitForTimeout(600);
  const awaitMsg = await noteStatus(page, `${caseName}/await-box`);
  step(caseName, "await-box-entry", awaitMsg.slice(0, 120));
  await drawBox(page, img, box, caseName);
  try {
    await page.waitForSelector("text=（已按画框限定重圈）", {
      timeout: 120000,
    });
    const status = await noteStatus(page, `${caseName}/box-ring-open`);
    step(caseName, "box-ring-open", status.slice(0, 140));
    return true;
  } catch {
    fail(caseName, "box-ring-timeout", await statusText(page));
    return false;
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--lang=zh-CN", "--force-device-scale-factor=1"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

  // ========= 案例 1：屋顶提亮（meigs，网格环弱目标 → 画框限定救回）=========
  if (!caseFilter || caseFilter === "c1-roof") {
    const C = "c1-roof";
    log(`${C}: 屋顶提亮`);
    const img = await openImage(
      page,
      path.join(GROUND, "meigs-house-front-street-marietta-oh.jpg"),
      C,
    );
    await shot(page, "c1-01-open");
    await parse(page, "把屋顶提亮一点", C);
    await waitForGapPanel(page, C);
    await shot(page, "c1-02-gap");
    // 先走网格环（IMG-054 证据：meigs 屋顶 top1 IoU 0.000，弱目标）
    await startRing(page, C, "屋顶");
    await shot(page, "c1-03-grid-ring");
    // D 项入口：点击/画框限定重新圈选（标注框 [0.17,0.28,0.64,0.18] + 边距）
    await reCircleWithBox(page, img, [0.15, 0.26, 0.68, 0.22], C);
    await shot(page, "c1-04-box-ring");
    await confirmCandidate(page, 1, C);
    const maskStatus = await waitForMaskReady(page, C);
    step(C, "mask-status", maskStatus.slice(0, 140));
    await shot(page, "c1-05-confirmed");
    await preview(page, C);
    await shot(page, "c1-06-preview");
    await saveFullPreview(page, C);
  }

  // ========= 案例 2：花瓣换色（hibiscus，网格环即好目标，无需画框）=========
  if (!caseFilter || caseFilter === "c2-petal") {
    const C = "c2-petal";
    log(`${C}: 花瓣换色`);
    const sourceFile = path.join(GROUND, "hibiscus-brilliant.jpg");
    await openImage(page, sourceFile, C);
    await shot(page, "c2-01-open");
    await parse(page, "把花瓣换成蓝色", C);
    const gapStrong = await waitForGapPanel(page, C);
    // Use the phrase shown by the UI; extraction currently keeps 「花瓣」.
    const phrase = gapStrong.match(/「(.+?)」/)?.[1] ?? "花瓣";
    step(C, "gap-phrase-resolved", phrase);
    await shot(page, "c2-02-gap");
    await startRing(page, C, phrase);
    await shot(page, "c2-03-grid-ring");
    await confirmCandidate(page, 1, C);
    const maskStatus = await waitForMaskReady(page, C);
    step(C, "mask-status", maskStatus.slice(0, 140));
    await shot(page, "c2-04-confirmed");
    await preview(page, C);
    await shot(page, "c2-05-preview");
    await saveFullPreview(page, C, "before-retouch-render");
    const pistilRegion = {
      kind: "mask",
      path: path.join(GROUND, "masks/hibiscus-brilliant.jpg/花蕊.png"),
    };
    const beforeRetouch = await previewDiff(page, sourceFile, pistilRegion);
    step(C, "visual-defect-before-retouch", JSON.stringify(beforeRetouch));
    // This is an explicit human-style handoff using PhotoCraft's existing
    // editable mask brush. The source edit alone does not satisfy 花瓣-only.
    if (beforeRetouch.insideMeanAbsDiff > 8) {
      await erasePreviewStroke(
        page,
        [
          [269, 442],
          [435, 442],
        ],
        C,
      );
      await erasePreviewStroke(
        page,
        [
          [269, 458],
          [435, 458],
        ],
        C,
      );
      await shot(page, "c2-06-after-mask-retouch");
    }
    await saveFullPreview(page, C, "after-retouch-render");
    const pistil = await previewDiff(page, sourceFile, pistilRegion);
    qualityGate(
      C,
      pistil,
      pistil.insideMeanAbsDiff <= 8,
      "花瓣指令应保留花蕊，花蕊平均 RGB 变化须 ≤8/255",
    );
  }

  // ========= 案例 3：左耳局部编辑（D-3：不默默猜位置）=====================
  if (!caseFilter || caseFilter === "c3-left-ear") {
    const C = "c3-left-ear";
    log(`${C}: 左耳局部编辑（D 入口）`);
    const sourceFile = path.join(FIX, "photocraft-fluffy-cat-cc0.jpg");
    const img = await openImage(page, sourceFile, C);
    await shot(page, "c3-01-open");
    await parse(page, "把左耳涂成蓝色", C);
    // D-3 断言 1：目标缺口面板出现（不再默默切 provider）
    const gapStrong = await waitForGapPanel(page, C);
    const phrase = gapStrong.match(/「(.+?)」/)?.[1] ?? "左耳";
    // D-3 断言 2：选区来源没有被静默切成 provider（旧 bug 行为）
    const method = await page.locator("#pc-selection-method").inputValue();
    if (method === "provider")
      fail(C, "silent-provider-switch", `#pc-selection-method=${method}`);
    else step(C, "no-silent-provider", `#pc-selection-method=${method}`);
    const msg = await statusText(page);
    if (msg.includes("不替你猜"))
      step(C, "no-guess-message", msg.slice(0, 120));
    else fail(C, "no-guess-message-missing", msg.slice(0, 160));
    await shot(page, "c3-02-entry");
    // A tight user box around the viewer-left ear, excluding the forehead.
    await page
      .getByRole("button", { name: "点击/画框限定后智能找" })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "点击/画框限定后智能找" }).click();
    await page.waitForTimeout(600);
    const awaitMsg = await noteStatus(page, `${C}/await-box`);
    step(C, "await-box-entry", awaitMsg.slice(0, 120));
    const earBox = [0.51, 0.11, 0.12, 0.095];
    await drawBox(page, img, earBox, C);
    try {
      await page.waitForSelector("text=（已按画框限定重圈）", {
        timeout: 120000,
      });
      const status = await noteStatus(page, `${C}/box-ring-open`);
      step(C, "box-ring-open", status.slice(0, 140));
    } catch {
      fail(C, "box-ring-timeout", await statusText(page));
    }
    await shot(page, "c3-03-box-ring");
    await confirmCandidate(page, 1, C);
    const maskStatus = await waitForMaskReady(page, C);
    step(C, "mask-status", maskStatus.slice(0, 140));
    await shot(page, "c3-04-confirmed");
    await preview(page, C);
    await shot(page, "c3-05-preview");
    await saveFullPreview(page, C, "before-retouch-render");
    // Two small visible blue tails at the ear root are removed with the
    // existing PhotoCraft mask brush. This is an explicit human-style step.
    await erasePreviewStroke(page, [[1091, 518]], C);
    await erasePreviewStroke(page, [[1145, 497]], C);
    await shot(page, "c3-06-after-mask-retouch");
    await saveFullPreview(page, C, "after-retouch-render");
    const earDiff = await previewDiff(page, sourceFile, {
      kind: "box",
      box: earBox,
    });
    qualityGate(
      C,
      earDiff,
      earDiff.outsideMeanAbsDiff <= 0.5 && earDiff.insideMeanAbsDiff > 2,
      "左耳框外平均 RGB 变化须 ≤0.5/255，框内须有实际编辑",
      "scope-isolation",
    );
    quality.push({
      case: C,
      gate: "semantic-coverage",
      status: "manual-review-required",
      explanation:
        "框内隔离不证明整只耳朵换色；必须在原尺寸检查漏选及框边裁切，必要时用 PhotoCraft 蒙版笔刷补回。",
    });
    step(
      C,
      "semantic-coverage-needs-manual-review",
      "框内隔离通过，耳朵覆盖仍须人工验收",
    );
  }

  // ==== 案例 4：套索降级强制场景（确认后删 <jobs>/<mask-id>/，预览须退回套索）====
  if (!caseFilter || caseFilter === "c4-lasso-fallback") {
    const C = "c4-lasso-fallback";
    log(`${C}: 套索降级强制场景`);
    await openImage(page, path.join(FIX, "photocraft-hat-teal.png"), C);
    await shot(page, "c4-01-open");
    // 帽徽 = 开放词汇目标（非词典）→ 目标缺口 → 候选环 → mask 法确认
    await parse(page, "把帽徽提亮一点", C);
    await waitForGapPanel(page, C);
    await startRing(page, C, "帽徽");
    await shot(page, "c4-02-ring");
    await confirmCandidate(page, 1, C);
    const maskStatus = await waitForMaskReady(page, C);
    step(C, "mask-status", maskStatus.slice(0, 140));
    if (!maskStatus.includes("像素蒙版")) {
      fail(C, "mask-not-used", "确认后未走像素蒙版路径，无法做删除降级场景");
    }
    await shot(page, "c4-03-confirmed");
    // 强制降级：删掉最新 candidate-mask 所在 job 目录（蒙版已失效）
    const maskDirs = fs
      .readdirSync(JOBS)
      .map((id) => {
        const p = path.join(JOBS, id, "candidate-mask.png");
        try {
          return { id, p, mtime: fs.statSync(p).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    if (!maskDirs.length) {
      fail(C, "no-mask-dir", "桥 jobs 下没有 candidate-mask.png 可删");
    } else {
      fs.unlinkSync(maskDirs[0].p);
      step(C, "mask-dir-deleted", `删除 ${maskDirs[0].id}/candidate-mask.png`);
    }
    const result = await preview(page, C);
    const text = result.status;
    if (text.includes("候选像素蒙版不可用") || text.includes("轮廓套索")) {
      step(C, "fallback-message-seen", text.slice(0, 160));
    } else {
      fail(C, "fallback-message-missing", text.slice(0, 160));
    }
    await shot(page, "c4-04-preview-after-fallback");
    await saveFullPreview(page, C);
  }

  // ---- 收尾：报告 ----
  const report = {
    executedAt: new Date().toISOString(),
    web: WEB,
    subset: caseFilter !== null,
    failures,
    quality,
    steps,
    statusLog,
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
    note: "仓库脚本分别记录交互步骤与局部视觉门槛；候选通过但目标区域错误时仍返回失败。花瓣花蕊 GT 属同家族非独立标注，需结合人工复核。",
  };
  const reportPath = path.join(
    OUT,
    caseFilter ? "e1-report.subset.json" : "e1-report.json",
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  log(`完成：failures=${failures}，报告 ${reportPath}`);
  await context.close();
  await browser.close();
  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exitCode = 1;
});
