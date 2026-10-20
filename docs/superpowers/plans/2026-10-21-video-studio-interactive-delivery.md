# P3-A 交互 HTML 交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 CLI 把 `spec` 场景源的项目导出成单个自包含 `index.html`，使用者打开后可按「下一步」逐步点击观看每个镜头，并记录交付账。

**Architecture:** 复用 `svg-serialize.mjs` 把每个镜头采样成 CSS 翻页册 SVG；`interactive-player.mjs` 负责把各步 SVG 与固定播放器拼成一份 HTML；`export-interactive.mjs` 负责读项目、校验、渲染、写文件、追加 `DeliveryRecord`。页面零网络、零外部文件，`file://` 与 iframe 均可用。

**Tech Stack:** Node 22 ESM、`node:test`、`playwright-core`、`@acs/video-document`（校验）、`@acs/video-scene`（场景渲染与注册表）。

**Spec:** `docs/superpowers/specs/2026-10-21-video-studio-interactive-delivery-design.md`

## Global Constraints

- 交付物是**单个** `index.html`：无外部 `src`/`href`、无网络请求、无 `<link>`、不写时间戳/UUID 进页面（确定性）。
- 只接受 `sceneSource.type === "spec"` 的镜头；`media-clip`、`editor-binding` 必须导出失败并带镜头号。
- 上限 `index.html ≤ 8 MiB`（`Buffer.byteLength`）。
- 新 UI 文案只用中文：`上一步`、`下一步`、`重新开始`、`第 N / M 步`。
- 交付落账沿用 `appendDelivery`，失败文案前缀 `[export-interactive]` / `[e2e-interactive]`。
- 不改 Remotion 渲染路径、不改媒体链路；`artifacts/`、导出产物、宿主页不入库。
- 所有测试命令在 `D:\codex\animate\.claude\worktrees\video-studio-p0` 下运行。

---

### Task 1: DeliveryRecord 可选扩展与追加器

**Files:**
- Modify: `packages/video-document/src/types.ts`
- Modify: `packages/video-document/src/validate.ts`
- Modify: `scripts/video/delivery.mjs`
- Test: `packages/video-document/src/validate.test.ts`, `scripts/video/export-gif.test.mjs`（追加器单测就近放这里）

**Interfaces:**
- Consumes: 现有 `appendDelivery(project, {versionIds, renderIds, frameMap})` 与 `validateVideoProject`。
- Produces: `DeliveryRecord` 新增可选 `kind?: "interactive-html"`、`outputRef?: string`、`digest?: string`；`appendDelivery(project, {versionIds, renderIds, frameMap, kind?, outputRef?, digest?})`，**未传的键不得出现在记录里**（保持旧记录字节形状）。

- [ ] **Step 1: 写失败测试（类型/校验）**

在 `validate.test.ts` 的 deliveries 用例旁新增：一条带 `kind:"interactive-html"`、`outputRef:"index.html"`、`digest:"a".repeat(64)` 的交付应通过；`kind:"game"`、`digest:"xyz"`、`outputRef:""` 各自必须 `throw`（断言 message 含 `deliveries[0]`）。先运行确认失败：

```bash
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"
```

- [ ] **Step 2: 扩展类型与校验**

`types.ts` 的 `DeliveryRecord` 内追加三个可选字段并写一行注释（P3-A 交互交付）。`validate.ts` 在 deliveries 循环里**仅当字段存在时**校验：`kind` 只认 `"interactive-html"`；`outputRef` 非空字符串且不含 `..` 与路径分隔符；`digest` 匹配 `/^[0-9a-f]{64}$/`。错误文案以 `deliveries[i].<字段>` 开头。

- [ ] **Step 3: 扩展追加器并补单测**

`appendDelivery` 的入参解构新增三项，记录构造改为条件展开：

```js
const delivery = {
  deliveryId, at, versionIds, renderIds, frameMap,
  ...(kind === undefined ? {} : { kind }),
  ...(outputRef === undefined ? {} : { outputRef }),
  ...(digest === undefined ? {} : { digest }),
};
```

在 `export-gif.test.mjs` 追加两条：传三项时记录含三键；不传时 `Object.keys(delivery)` 恰为原五键（防旧导出字节形状变化）。

- [ ] **Step 4: 跑测试**

```bash
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"
node --test scripts/video/export-gif.test.mjs
```

Expected: 全绿，且原有 GIF/SVG 导出测试不变红。

- [ ] **Step 5: 提交**

```bash
git add packages/video-document/src/types.ts packages/video-document/src/validate.ts packages/video-document/src/validate.test.ts scripts/video/delivery.mjs scripts/video/export-gif.test.mjs
git commit -m "feat(video-studio): P3-A 交付记录支持交互 HTML 元数据"
```

---

### Task 2: 播放器 HTML 构建器

**Files:**
- Create: `scripts/video/interactive-player.mjs`
- Test: `scripts/video/interactive-player.test.mjs`

**Interfaces:**
- Produces: `MAX_HTML_BYTES = 8 * 1024 * 1024`；`buildPlayerHtml({ title, width, height, steps }) -> string`，`steps` 为 `[{ svg: string }]`，`steps.length >= 1`；非法输入抛 `Error`，文案中文且可定位（`步骤数为 0`、`页面体积超限…`）。

- [ ] **Step 1: 写失败测试**

`interactive-player.test.mjs`（`node:test` + `assert/strict`）覆盖：
1. 输出含 `<!doctype html>`、`lang="zh-CN"`、`data-total="2"`、`<title>` 中的标题已转义（标题传 `云 & 雨`，断言 `云 &amp; 雨`）。
2. SVG 中的 `</script>` 与 `<` 已被转义：步骤 svg 传 `"<svg><text>a</text></svg></script>"`，断言输出不含原始 `</script></script>`，且 `JSON.parse` 数据块能取回原串（用正则截取 `id="steps-data"` 内容验证）。
3. 自包含：不含 `src=`、`href=`、`<link`、`fetch(`、`XMLHttpRequest`。
4. 确定性：同输入两次调用字符串全等。
5. 边界：`steps: []` 抛 `步骤数为 0`；塞入 `"<svg>" + "x".repeat(MAX_HTML_BYTES)` 抛 `页面体积超限`。

先运行 `node --test scripts/video/interactive-player.test.mjs` 确认因模块缺失失败。

- [ ] **Step 2: 实现构建器**

导出 `buildPlayerHtml`。数据块写法：`JSON.stringify(payload).replace(/</g, "\\u003c")` 放进 `<script type="application/json" id="steps-data">`。播放器脚本为固定字符串：读取 JSON、`stage.innerHTML = steps[i].svg`、更新 `body.dataset.step`、`indicator.textContent = \`第 ${i + 1} / ${steps.length} 步\``、按首末步禁用按钮、绑定点击与键盘（按钮聚焦时跳过 Space/Enter）。样式按 spec §3：深色底 `#0b1020`、居中舞台、`svg{width:100%;height:auto;display:block}`、`.controls` 可换行。所有用户可见文案为 `上一步`/`下一步`/`重新开始`/`第 N / M 步`。

- [ ] **Step 3: 跑测试**

```bash
node --test scripts/video/interactive-player.test.mjs
```

Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add scripts/video/interactive-player.mjs scripts/video/interactive-player.test.mjs
git commit -m "feat(video-studio): P3-A 自包含逐步播放器 HTML 构建器"
```

---

### Task 3: 导出管线与 CLI

**Files:**
- Create: `scripts/video/export-interactive.mjs`
- Create: `scripts/video/export-interactive.test.mjs`
- Create: `scripts/video/fixtures/interactive-sample.video-project.json`

**Interfaces:**
- Consumes: `buildPlayerHtml`（Task 2）、`appendDelivery`（Task 1）、`svg-serialize.mjs`、`delivery.mjs` 再导出的 `validateVideoProject`、`@acs/video-scene` 的 `defaultRegistry/seededRandom/validateSceneSpec/assertNodeBudget`。
- Produces: `FPS_CHOICES = [1,2,3,4,6,8,12,24]`、`DIMENSIONS = {landscape:[1280,720], portrait:[720,1280]}`、`buildInteractiveExport({project, fps, aspect}) -> { html, versionIds, frameMap, digest }`（纯函数，不写盘）；CLI 成功时写 `index.html`、追加交付、回写项目。

- [ ] **Step 1: 固定夹具**

从本工作树现有产物 `artifacts/video-studio-flow/e2e.video-project.json` 取 3 个镜头的 `sceneSource.spec`（`text-animation`、`flow-steps`、`text-animation`），把项目 id、versionId、时间戳改为固定常量，`deliveries`/`renderRecords` 置空，`savedVersion: 1`，写到 `scripts/video/fixtures/interactive-sample.video-project.json`；用 `validateVideoProject` 与 `validateSceneSpec` 各过一遍。

- [ ] **Step 2: 写失败测试**

`export-interactive.test.mjs`：
1. 读夹具 → `buildInteractiveExport({fps:12, aspect:"landscape"})`：`versionIds.length === 3`、`frameMap` 3 个正整数、`digest` 匹配 64 hex 且等于 `sha256(html)`、`html` 含 `data-total="3"`。
2. 两次调用 `html` 全等（确定性）。
3. 把第 2 镜头改成 `media-clip`（补最小 `mediaAssets` 账本使其通过文档校验）→ 抛错且 message 含 `镜头 2` 与 `media-clip`。
4. `fps: 5` → 抛错含 `不整除`；`aspect:"square"` → 抛错含 `landscape/portrait`。

先跑确认失败。

- [ ] **Step 3: 实现纯函数与 CLI**

`buildInteractiveExport`：按 `shots` 顺序取 working version；非 `spec` 立即抛 `镜头 N 的场景源不是 spec（…），P3-A 交互交付不支持`；`validateSceneSpec`；校验 `spec.durationMs === version.durationMs`；按 `quantizeTimeline`（从 `@acs/video-document` 动态导入）取 `durationFrames`，用与 `export-shot-svg.mjs` 相同的 `renderFrame`（`defaultRegistry.get(...).render(...)` + `assertNodeBudget`）与 `sampledFrameCount` 采样，`buildAnimatedSvg` 得每步 SVG；`buildPlayerHtml` 拼页；`digest = sha256(html)`。CLI：`parseArgs`（`--project` 必填、`--out` 默认项目目录、`--fps` 默认 12、`--aspect` 默认 landscape）、`fail()` 打印 `[export-interactive] …` 并 `exit 1`、成功写 `<out>/index.html` 后 `appendDelivery`，再写回项目。

- [ ] **Step 4: 跑测试与手跑 CLI**

```bash
node --test scripts/video/export-interactive.test.mjs
node scripts/video/export-interactive.mjs --project scripts/video/fixtures/interactive-sample.video-project.json --out D:/tmp/p3a-smoke
```

Expected: 测试全绿；CLI 打印步数/字节/交付 id；`D:/tmp/p3a-smoke/index.html` 存在；项目文件 `deliveries` 末条含 `kind:"interactive-html"` 与 `digest`。

- [ ] **Step 5: 提交**

```bash
git add scripts/video/export-interactive.mjs scripts/video/export-interactive.test.mjs scripts/video/fixtures/interactive-sample.video-project.json
git commit -m "feat(video-studio): P3-A 交互 HTML 导出 CLI 与固定夹具"
```

---

### Task 4: 真实浏览器 e2e、QA 登记与文档收口

**Files:**
- Create: `scripts/video/e2e-interactive.mjs`
- Modify: `qa/registry.json`
- Modify: `docs/superpowers/specs/2026-10-21-video-studio-interactive-delivery-design.md`（状态改「已实施」）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`

**Interfaces:**
- Consumes: CLI（Task 3）、`playwright-core`。
- Produces: QA 用例 `VID-024`（`tier:"integration"`、`requiresPorts: []`、`argv:["node","scripts/video/e2e-interactive.mjs"]`、`cwd:"."`）。

- [ ] **Step 1: 写 e2e**

`e2e-interactive.mjs` 流程（临时目录 `D:/tmp/acs-interactive-e2e-<rand>/`）：复制夹具 → 跑 CLI 两次（第二次前清空输出）→ 断言两次 `index.html` SHA-256 相同 → `chromium.launch({headless:true})`：

1. `file://` 打开：`body[data-step="1"]`、`#stage svg` 存在、`#prev` disabled；点 `#next` → `data-step="2"` 且 `#stage` innerHTML 变化；`ArrowRight` → 3；`ArrowLeft` → 2；`Home` → 1；回到第 1 步后再点 `#restart`，用 `MutationObserver` 断言 `#stage` 子节点被替换（重新开始必须重播当前步动画，含已在第 1 步时）。
2. 宿主页 `host.html`（`<iframe src="index.html" width="960" height="540">`）打开：`frameLocator` 内点 `#next` → `data-step="2"`。
3. 请求监听：除两个文档外 0 请求；控制台 0 error。
4. 失败打印 `[e2e-interactive] FAIL at <步骤>: <原因>`，尽力关浏览器，`exit 1`。
5. 证据顺手写 `artifacts/video-studio-interactive/evidence.md`（untracked）：双跑哈希、步数、字节数、交付 id、台账行数前后。

- [ ] **Step 2: 登记 QA 与文档**

`qa/registry.json` 追加 VID-024（checks 五条对应 spec §5 的 1/3/4/5/8，措辞只声称脚本真正验证的）。spec 状态改「已实施」。`CURRENT_STATE.md` 顶部加 P3-A 条目（含提交号、`qa:validate` 计数 84 automated/51 manual、e2e 哈希）。

- [ ] **Step 3: 全量验证**

```bash
node scripts/qa/run-regression.mjs validate
node --test scripts/video/*.test.mjs
node scripts/video/e2e-interactive.mjs
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"
pnpm --filter @acs/web run typecheck
npx biome check .
wc -l artifacts/tts-usage.jsonl
```

Expected: validate 84/51；video 测试全绿；e2e exit 0；typecheck 0；biome 无 fix；台账仍 34 行。

- [ ] **Step 4: 提交**

```bash
git add scripts/video/e2e-interactive.mjs qa/registry.json docs/superpowers/specs/2026-10-21-video-studio-interactive-delivery-design.md AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md
git commit -m "test(video-studio): P3-A 交互交付 e2e 与 QA 登记"
```

---

## Review Focus

- **在 `file://` 下内容被浏览器拦截**（`fetch`/模块脚本）：页面必须全部内联、用普通 `<script>`，e2e 必须真用 `file://` 打开，不用本地服务器掩盖问题。
- **iframe 嵌入被沙箱或头部拦截**：宿主页必须通过 `frameLocator` 真点击，断言状态推进；不能只断言 iframe 存在。
- **非 spec 镜头静默丢失**：只要有一步非 spec 就必须整次导出失败并报镜头号，禁止跳过。
- **确定性被隐藏变量打破**：页面不得含时间戳/UUID/随机 id；两次导出必须逐字节一致（包括 JSON key 顺序）。
- **交付账写坏项目**：`appendDelivery` 后必须 `validateVideoProject` 通过并写回；`renderIds` 必须为空数组、`frameMap` 必须正整数，避免重开项目失败。

---
