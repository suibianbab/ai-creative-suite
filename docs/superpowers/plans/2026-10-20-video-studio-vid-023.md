# Video Studio P2.5-T6 VID-023 Sample E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 Wikimedia 素材跑通「编辑器全链路 + CLI 出片」样片 e2e（VID-023），并把片内署名裁定固化为「不叠画面、只记元数据」。

**Architecture:** 一支独立 Node 脚本 `scripts/video/e2e-stock.mjs`，用 `playwright-core`（仓内已装 Chromium）驱动真实工作台（新建 → 分镜规划 → 媒体模板 → 在线素材检索/下载并应用 → 保存 → 重开 → 预览），再调 `render-scene.mjs` 双画幅出片并做确定性/帧亮度断言；不改产品代码。

**Tech Stack:** Node 22 ESM、`playwright-core@1.64.1`（`chromium.launch({ headless: true })`，沿既有 e2e）、Next 16.4 dev server（3210 + 3211 raw proxy）、`node:test` 无关（本刀是 e2e 脚本本身）、ffmpeg/ffprobe、`@acs/video-document`。

**Spec:** `docs/superpowers/specs/2026-10-20-video-studio-vid-023-design.md`

## Global Constraints

- **零计费**：任何步骤不得调用 TTS；`artifacts/tts-usage.jsonl` 行数前后不变（本机 34）。
- **不入库**：导出 JSON、渲染产物、截图、临时媒体仓、证据文件全部 untracked/仓外；只提交脚本、QA 登记、CURRENT_STATE 与 spec/plan。
- **固定素材**：`File:Clouds-seloncourt.ogv` 的 480p WebM；找不到即失败，不静默换片。
- **中文文案**：只断言既有逐字文案（`素材已下载并应用（镜头 1）`、`已保存`），不新增 spec §3 文案。
- **不改产品代码**：若 e2e 暴露真实缺陷，停下并在报告中说明；修复须另立 TDD 步骤与提交，不改 spec §3 文案。
- **不 push / 不 merge**；主检出 `D:\codex\animate` 只读。
- 工作目录：`D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`）。

## Review Focus

1. **网络/素材漂移**：Wikimedia 不可达或候选消失时，脚本必须 `exit 1` 并指名步骤，不得跳过或换片。
2. **代理环境**：dev server 未带 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` 时，检索会失败；脚本与证据必须固定这一前提，不能把它误报成产品缺陷。
3. **同源门**：经 3211 proxy 时 `/api/*` 的 Origin 被剥离或与 Host 同源；导入必须 200，不能被 403 掩盖。
4. **保存/重开**：`mediaAssetId`、入出点、focal、audio 在导出 JSON 与重开后的下拉里都保持；重开前必须真的返回列表再打开。
5. **确定性**：同一导出 JSON 双跑出片逐字节一致；镜头 1 的帧亮度证明素材真的进了画面，而不是黑帧或占位。

---

### Task 1: e2e 脚本 `e2e-stock.mjs`

**Files:**
- Create: `scripts/video/e2e-stock.mjs`

**Interfaces:**
- Consumes: T5 的卡内面板类名 `.stock-search-input` / `.stock-search-button` / `.stock-candidate` / `.stock-derivative-select` / `.stock-download` / `.stock-badge-imported`；既有编辑器类名 `.project-create` / `#planner-sentence` / `.planner-run` / `.storyboard-card` / `.plan-apply` / `.shot-list` / `.shot-edit-toggle` / `.chart-template-select` / `.media-asset-select` / `.editor-save` / `.editor-export` / `.project-action` / `.project-table` / `.project-open` / `.preview-slider` / `.media-stage`；导出 JSON 的 `mediaAssets` / `shots[].contentVersions[].sceneSource`。
- Produces: `node scripts/video/e2e-stock.mjs` exit 0/1；控制台最后打印项目 id、版本、storeKey、双跑哈希与 YAVG。

- [ ] **Step 1: 写脚本骨架与常量**

文件头注释说明 VID-023 与前置条件。常量：

```js
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const OUT_DIR = path.join(ROOT, "artifacts/video-studio-vid-023");
const EXPORTED = path.join(OUT_DIR, "e2e.video-project.json");
const BASELINE = path.join(OUT_DIR, "baseline.video-project.json");
const SENTENCE = "做一个9秒的STEM解说视频，主题是云，分3个镜头";
const PAGE_TITLE = "File:Clouds-seloncourt.ogv";
const DERIVATIVE_URL = "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fb/Clouds-seloncourt.ogv/Clouds-seloncourt.ogv.480p.vp9.webm";
const SOURCE_PAGE = "https://commons.wikimedia.org/wiki/File:Clouds-seloncourt.ogv";
const USAGE_LEDGER = path.join(ROOT, "artifacts/tts-usage.jsonl");
```

Helpers：`fail(step, detail)`（打印 `[e2e-stock] FAIL at ...` 后 exit 1）、`sha256(file)`、`usageLines()`（文件缺失返回 0）、`frameYavg(video, frame)`（沿 `e2e-loading.mjs` 的 ffmpeg signalstats 口径）、`renderProject(project, outDir, step)`（spawn `render-scene.mjs --project --out`，超时 600s，非 0 失败）、`waitForMessage(page, text, step, timeout = 10_000)`（等 `.editor-message` 含给定文本）、`setPreviewFrame(page, frame)`（沿 `e2e-shot-editor.mjs` 的原型 setter + input 事件）。

- [ ] **Step 2: 去程——新建、规划、应用、保存基线**

```js
const usageBefore = usageLines();
const consoleErrors = [];
const browser = await chromium.launch({ headless: true }); // 仓内 playwright 浏览器；沿其余 e2e
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
await page.goto(`${BASE_URL}/video-studio`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("html[data-studio-ready]", { timeout: 20_000 });
await page.click(".project-create");
await page.fill("#planner-sentence", SENTENCE);
await page.click(".planner-run");
await page.locator(".storyboard-card").waitFor({ timeout: 20_000 });
await page.click(".plan-apply");
await waitForMessage(page, "首个 3 个镜头", "规划应用");
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存基线");
// 基线导出：记录镜头 2、3 的 planner componentId，供导入后比对。
const [baselineDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.click(".editor-export"),
]);
await baselineDownload.saveAs(BASELINE);
```

（规划应用文案实测为 `已应用分镜（首个 3 个镜头 / 9 秒）…`；只断言其中的 `首个 3 个镜头`。）

- [ ] **Step 3: 镜头 1 换媒体模板并下载固定素材**

```js
const card1 = page.locator(".shot-list > li").nth(0);
await card1.locator(".shot-edit-toggle").click();
// 选中媒体模板 = 只播种 mediaDraft 并切到媒体臂（露出 `.media-asset-select`
// 与在线素材面板）；不点 `.shot-apply`——下载并应用自己会落成新的工作版本。
await card1.locator(".chart-template-select").selectOption("media-clip");
await card1.locator(".stock-search-input").fill("clouds");
await card1.locator(".stock-search-button").first().click();
const candidate = card1.locator(".stock-candidate", { hasText: "Clouds-seloncourt" });
await candidate.waitFor({ timeout: 60_000 }); // 真实网络
// 默认档位必须是 480p，再显式选中（幂等）。
const defaultDerivative = await candidate.locator(".stock-derivative-select").inputValue();
if (defaultDerivative !== DERIVATIVE_URL) fail("默认档位", defaultDerivative);
await candidate.locator(".stock-derivative-select").selectOption(DERIVATIVE_URL);
// 下载前挂响应观察：导入必须真的 200，不能被泛化错误文案掩盖。
const importResponse = page.waitForResponse(
  (response) => response.request().method() === "POST" && response.url().includes("/api/media/stock/import"),
  { timeout: 120_000 },
);
await candidate.locator(".stock-download").click();
const importResult = await importResponse;
if (importResult.status() !== 200) fail("导入状态", String(importResult.status()));
// 首次下载约 7s（固定 480p 文件 ≈0.83MB），给足预算（含上游重试）。
await waitForMessage(page, "素材已下载并应用（镜头 1）", "下载并应用", 120_000);
await candidate.locator(".stock-badge-imported").waitFor({ timeout: 10_000 });
await page.click(".editor-save");
await waitForMessage(page, "已保存", "保存媒体镜头");
```

（候选卡标题文本是 `displayTitle`，固定片实测为 `Clouds-seloncourt`；「已入库」徽标复用同一候选卡片。）

- [ ] **Step 4: 导出并断言文档结构**

点击 `.editor-export`，`waitForEvent("download")` → `saveAs(EXPORTED)`；解析后断言：

```js
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click(".editor-export"),
]);
await download.saveAs(EXPORTED);
const exported = JSON.parse(readFileSync(EXPORTED, "utf8"));
if (exported.shots.length !== 3) fail("镜头数", String(exported.shots.length));

// 导入前基线（Step 2 保存后导出）用于证明镜头 2、3 未被素材导入改动。
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const workingOf = (project, index) => {
  const shot = project.shots[index];
  const version = shot?.contentVersions.find((v) => v.versionId === shot.workingVersionId);
  if (!version) fail(`镜头${index + 1}`, "找不到工作版本");
  return version;
};

const asset = exported.mediaAssets?.[0];
if (!asset) fail("账本", "mediaAssets 为空");
if (asset.origin.kind !== "stock-source" || asset.origin.sourceId !== "wikimedia") fail("origin", JSON.stringify(asset.origin));
if (asset.origin.sourcePageUrl !== SOURCE_PAGE) fail("sourcePageUrl", asset.origin.sourcePageUrl);
if (asset.origin.license.name !== "CC BY 2.0") fail("license", asset.origin.license.name);
if (asset.origin.license.author !== "Thomas Bresson") fail("author", asset.origin.license.author);
if (Number.isNaN(Date.parse(asset.origin.retrievedAt))) fail("retrievedAt", asset.origin.retrievedAt);
if (!/^[0-9a-f]{64}$/.test(asset.original.sha256)) fail("sha256", asset.original.sha256);
if (asset.original.width !== 854 || asset.original.height !== 480) fail("尺寸", `${asset.original.width}x${asset.original.height}`);
if (asset.original.durationMs !== 28600) fail("时长", String(asset.original.durationMs));
if (asset.original.hasAudio !== false) fail("hasAudio", String(asset.original.hasAudio));
if (asset.original.storeKey !== `${asset.original.sha256.slice(0, 16)}.webm`) fail("storeKey", asset.original.storeKey);
if (asset.original.proxy !== undefined) fail("proxy", "不应生成 proxy");

const s1 = workingOf(exported, 0);
if (s1.sceneSource.type !== "media-clip") fail("镜头1类型", s1.sceneSource.type);
const clip = s1.sceneSource; // media-clip 字段平铺在 sceneSource 上
if (clip.mediaAssetId !== asset.assetId) fail("mediaAssetId", clip.mediaAssetId);
if (clip.inMs !== 0 || clip.outMs !== 2000) fail("入出点", `${clip.inMs}-${clip.outMs}`);
if (clip.fit !== "cover" || clip.focalX !== 0.5 || clip.audio !== "mute") fail("默认值", JSON.stringify(clip));
if (s1.durationMs !== 2000) fail("镜头1时长", String(s1.durationMs));
for (const index of [1, 2]) {
  const source = workingOf(exported, index).sceneSource;
  const before = workingOf(baseline, index).sceneSource;
  if (source.type !== "spec") fail(`镜头${index + 1}`, "应为 spec");
  if (before.type !== "spec" || source.spec.componentId !== before.spec.componentId) fail(`镜头${index + 1}组件`, `${source.spec?.componentId} ≠ ${before.spec?.componentId}`);
}
```

（`focalX` 契约是 0..1，编辑器草稿里的 `50%` 落库为 `0.5`；`media-clip` 字段平铺在 `sceneSource` 上。）

- [ ] **Step 5: 保存/重开/预览**

```js
// 返回列表 → 用导出件里的标题定位同一行 → `.project-open`（文案「打开」）。
await page.click(".project-action");
await page.locator(".project-import").waitFor({ timeout: 10_000 });
const row = page.locator(".project-table tr", { hasText: exported.title });
await row.locator(".project-open").click();
await page.locator(".shot-list > li").nth(0).locator(".shot-edit-toggle").click();
const select = page.locator(".shot-list > li").nth(0).locator(".media-asset-select");
if ((await select.inputValue()) !== asset.assetId) fail("重开素材", await select.inputValue());
// 重开后草稿五项也要回填：媒体入/出点、fit、focal、audio。
const reopened = {
  inMs: await page.locator(".media-in-input").inputValue(),
  outMs: await page.locator(".media-out-input").inputValue(),
  fit: await page.locator(".media-fit-select").inputValue(),
  focalPercent: await page.locator(".media-focal-input").inputValue(),
  audio: await page.locator(".media-audio-select").inputValue(),
};
if (reopened.inMs !== "0" || reopened.outMs !== "2000" || reopened.fit !== "cover" || reopened.focalPercent !== "50" || reopened.audio !== "mute") {
  fail("重开字段", JSON.stringify(reopened));
}
// 整片预览默认自动播放；先按 React 受控 range 的原型 setter 把帧拨到 12
// （500ms，仍在镜头 1 的 0..47 帧域内，同时暂停）——既避免镜头 1（仅 2000ms）
// 被播过去后 .media-stage 卸载，也强制 MediaStage 做一次 seek 取帧。
await setPreviewFrame(page, 12);
const video = page.locator(".media-stage").first();
await video.waitFor({ timeout: 10_000 });
await page
  .waitForFunction(() => (document.querySelector(".media-stage")?.readyState ?? 0) >= 2, { timeout: 10_000 })
  .catch(() => fail("预览", "readyState 未达 2（取不到当前帧数据）"));
const state = await video.evaluate((el) => ({ readyState: el.readyState, w: el.videoWidth, duration: el.duration, err: el.error?.message ?? null, src: el.currentSrc || el.src }));
if (state.readyState < 2 || state.w !== 854 || !(state.duration > 28) || state.err !== null) fail("预览", JSON.stringify(state));
if (!state.src.includes(asset.original.storeKey)) fail("预览 src", state.src);
```

（`setPreviewFrame` 沿 `scripts/video/e2e-shot-editor.mjs:59-68` 的口径：原型 setter + `input` 事件，React 受控 range 才会更新。`readyState` 断言 ≥2 而非写死 4：本地文件可能仍停在 metadata/当前帧缓冲，两者都证明可解码可播。）

- [ ] **Step 6: 出片、双跑一致性、帧亮度**

```js
// 产物固定为 <out>/landscape.mp4 与 <out>/portrait.mp4（render-scene 双画幅）。
const RENDER_DIR = path.join(OUT_DIR, "render");
const RERUN_DIR = path.join(OUT_DIR, "rerun");
// 清掉上一次的产物，避免出片静默少写一档时仍拿旧文件通过确定性断言。
rmSync(RENDER_DIR, { recursive: true, force: true });
rmSync(RERUN_DIR, { recursive: true, force: true });
const renderHashes = {};
renderProject(EXPORTED, RENDER_DIR, "出片 run1");
renderProject(EXPORTED, RERUN_DIR, "出片 run2");
for (const aspect of ["landscape", "portrait"]) {
  for (const dir of [RENDER_DIR, RERUN_DIR]) {
    const file = path.join(dir, `${aspect}.mp4`);
    if (!existsSync(file)) fail("出片产物", file);
  }
  const hash = sha256(path.join(RENDER_DIR, `${aspect}.mp4`));
  if (hash !== sha256(path.join(RERUN_DIR, `${aspect}.mp4`))) fail("确定性", `${aspect} 双跑哈希不同`);
  // 镜头 1 帧域 0..47（2000ms @24fps）：帧 24 = 1000ms，素材应可见。
  const yavg = frameYavg(path.join(RENDER_DIR, `${aspect}.mp4`), 24);
  if (yavg < 100) fail("素材帧", `${aspect} 第 24 帧 YAVG=${yavg} < 100`);
  renderHashes[aspect] = hash;
  console.log(`[e2e-stock] ${aspect}: 双跑一致 ${hash}，帧 24 YAVG=${yavg}`);
}
```

- [ ] **Step 7: 零计费与控制台**

```js
const usageAfter = usageLines();
if (usageAfter !== usageBefore) fail("计费", `${usageBefore} → ${usageAfter}`);
if (consoleErrors.length > 0) fail("控制台", consoleErrors.join(" | "));
console.log(`[e2e-stock] OK: 项目 ${exported.id} v${exported.savedVersion}，storeKey=${asset.original.storeKey}，台账 ${usageAfter} 行不变`);
for (const [aspect, hash] of Object.entries(renderHashes)) console.log(`[e2e-stock] ${aspect} sha256 ${hash}`);
await browser.close();
```

- [ ] **Step 8: 起环境并跑绿**

```bash
# 固定仓外隔离目录：三个终端必须用同一个 STORE，否则 CLI 出片找不到媒体文件。
STORE="D:/tmp/acs-stock-e2e/store"
rm -rf "$STORE"   # 需要全新仓时先清；不清也可（内容寻址幂等）

# 终端 A（worktree 根）——系统代理只给 dev server，不进全局环境
# 必须绑 127.0.0.1：3211 代理上游写死 127.0.0.1:3210，本机 localhost 可能先解析到 ::1。
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 ACS_MEDIA_STORE="$STORE" \
  pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3210
# 终端 B
node scripts/dev/proxy-3211.mjs
# 终端 C —— 同一个 ACS_MEDIA_STORE（render-scene 用它在仓里找素材）
ACS_MEDIA_STORE="$STORE" node scripts/video/e2e-stock.mjs
```

Expected: `[e2e-stock] OK ...`，exit 0。若失败，按步骤名修脚本（不改产品）；网络/素材漂移按 `fail` 处理并在报告中记录。

- [ ] **Step 9: 提交**

```bash
git add scripts/video/e2e-stock.mjs \
  docs/superpowers/specs/2026-10-20-video-studio-vid-023-design.md \
  docs/superpowers/plans/2026-10-20-video-studio-vid-023.md
git commit -m "feat(video-studio): T6 VID-023 样例 e2e（Wikimedia 素材全链路出片）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: QA 登记、证据与 CURRENT_STATE

**Files:**
- Modify: `qa/registry.json`（`automated` 数组，VID-022 之后追加 VID-023）
- Create: `artifacts/video-studio-vid-023/evidence.md`（**不提交**，仅本地证据）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部 P2.5 条目追加 T6 段）
- Test: `pnpm qa:validate`

**Interfaces:**
- Consumes: Task 1 的脚本与实测输出。
- Produces: `VID-023` 登记；`qa:validate` 计数 +1；CURRENT_STATE 记录。

- [ ] **Step 1: 登记 VID-023**

在 `qa/registry.json` 的 `automated` 数组、VID-022 条目之后追加：

```json
{
  "id": "VID-023",
  "tier": "integration",
  "title": "Video Studio stock source full-chain sample (Wikimedia search, download, media clip, render)",
  "cwd": ".",
  "argv": ["node", "scripts/video/e2e-stock.mjs"],
  "requiresPorts": [3211],
  "checks": [
    "Stock search finds the pinned Wikimedia candidate and imports the 480p WebM through the real editor panel",
    "Exported project books origin license/author/sourcePageUrl/retrievedAt and a content-addressed storeKey with no proxy",
    "Shot 1 becomes a media-clip (0-2000ms, cover, focal 0.5, mute) while shots 2-3 remain spec; asset survives save and reopen",
    "Browser preview plays the stored media (readyState >= 2, 854px wide) and renders both aspects deterministically (double run byte-identical, media frame YAVG >= 100)",
    "Attribution ruling: no in-frame credit; metadata only. No TTS billing and zero console errors"
  ]
}
```

- [ ] **Step 2: 验证登记**

Run: `pnpm qa:validate`
Expected: automated 计数从 82 → 83，零错误。

- [ ] **Step 3: 写证据文件（untracked）**

`artifacts/video-studio-vid-023/evidence.md`：环境（代理/隔离仓/dev 端口）、项目 id 与版本、素材字段、导出 JSON 位置、双跑 SHA-256、YAVG、台账行数、署名裁定复述。不要 `git add`。

- [ ] **Step 4: CURRENT_STATE 追记**

顶部 P2.5-T5 条目末尾的「下一步」改为 T6 完成段：脚本路径、VID-023、固定素材、裁定 L6（不叠画面）、回归计数、零计费、证据不入库。

- [ ] **Step 5: 全量回归**

```bash
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"
pnpm --filter @acs/video-scene test
pnpm --filter @acs/media-store test
pnpm --filter @acs/web test
node --test scripts/video/*.test.mjs
pnpm --filter @acs/web run typecheck
pnpm --filter @acs/remotion-engine run typecheck
npx biome check .
wc -l artifacts/tts-usage.jsonl
```

Expected: 111 / 136 / 63 / 203 / 83 全绿；双 typecheck 零错；biome clean；台账 34。

- [ ] **Step 6: 提交**

```bash
git add qa/registry.json AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "docs(video-studio): T6 VID-023 登记与收口（署名裁定 L6：不叠画面）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** §2 裁定（Task 2 Step 4）、§3 样片（Task 1 Steps 2-4）、§4 断言 1-9（Steps 3-7）、§5 环境（Step 8）、§6 非目标（不改产品）、§7 证据/登记（Task 2）。
- **Step scan:** 每个 Step 给出选择器、断言值或命令；选择器与字段形状均已对照当前树核验（媒体臂选中即出面板、`media-clip` 平铺、`focalX` 0..1、列表 `.project-open`、预览 `.media-stage`）。
- **Type consistency:** `media-clip` 字段形状以 `types.ts` 为准；`assetId`/`storeKey`/`sha256` 名称与 T5 契约一致。
- **Review Focus:** 5 条分别落在 Step 3（漂移）、Step 8（代理）、Step 3（同源 200）、Step 5（保存/重开）、Step 6（确定性）。
