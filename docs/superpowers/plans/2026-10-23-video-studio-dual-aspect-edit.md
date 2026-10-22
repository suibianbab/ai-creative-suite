# Video Studio 双画幅预览与镜头级微调 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 工作台的单镜/整片预览支持横竖版切换（画布坐标与出片一致、安全区辅助线可开关），文字与折线图镜头支持按画幅的版式覆写（走同一内容版本修订链），并以自动测试 + 真实浏览器 + 真实双画幅出片三线验证。

**Architecture:** 画幅尺寸/帧率常量收口到 `@acs/video-document`（`EXPORT_DIMENSIONS`/`EXPORT_FPS`），预览与 CLI 共同引用；预览组件把出片画布尺寸传入既有 `SpecCanvas`→`component.render` 同一条渲染路径，仅显示尺寸用 CSS 控制。覆写是 `SceneSpec` 顶层可选字段 `layout?: { portrait?, landscape? }`，由 `validateSceneSpec` 按组件新增的可选 `validateLayout` 深度校验，`reviseWorkingVersion`/编辑器链路原样携带——预览与出片天然同规则，无第二份数据或时间线。

**Tech Stack:** TypeScript / React 19 / Next.js App Router / node:test + tsx / Biome / playwright-core（浏览器用例）/ Remotion CLI（真出片）

**Spec:** `artifacts/video-studio-next-dual-aspect-edit-brief.md`（基于 main `226a488`，2026-10-22）

## Global Constraints

- 不改 `VideoProject`/`Shot`/`ContentVersion`/`ShotEvent` 任何字段；覆写只存在于 `sceneSource.spec.layout`（`type:"spec"` 在 `validateVideoProject` 只做浅校验，深度校验归 `@acs/video-scene`，旧项目零迁移）。
- 旧项目（无 `layout` 字段）渲染结果必须与现状一致：现有 144 条 video-scene 测试全绿是硬门槛。
- 预览画布坐标 = 出片坐标（1280×720 / 720×1280，24 fps，量化 span 帧数）；显示尺寸仅由 CSS 控制；安全区辅助线只存在于预览 DOM，永不进入导出路径。
- 数据值与原始标签不得被静默改写：`line-chart` 既有「>6 字截断」行为对未覆写标签保持原样，但编辑器必须列出被隐藏/截断/简写的标签。
- 覆写经既有 `reviseWorkingVersion` → `saveVideoProject` → `rollbackWorkingVersion` 链路管理，归属同一镜头内容版本；不复制镜头、不建第二时间线。
- 用户可见文案全部中文；新增 CSS 类名用 `preview-`/`aspect-`/`safe-` 前缀的扁平类。
- 只在隔离工作树内改动；不 `git push`、不合并 main；每个 commit 末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；不暂存 `artifacts/`、`.superpowers/`、`qa/reports/`、`.tools/`。
- 改 `apps/web` 前先查 `apps/web/node_modules/next/dist/docs/` 相关指南（AGENTS.md 要求，Next 版本与训练数据可能有出入）。
- 每任务收尾跑（按改动范围取用）：`pnpm --filter @acs/video-scene test`；`pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test`；`pnpm --filter @acs/web test`；`pnpm exec biome check .`；全工作区 `pnpm -r typecheck`（需先构建，等同根 `pnpm typecheck`）。
- 真出片用系统 Chrome（render-scene 既有逻辑）； ffmpeg 分析遵循 Remotion 定制 ffmpeg 无 signalstats/select 的限制（scale=1:1 + Node 解 PNG 亮度，见 qa VID-025 口径）。

## Review Focus

- **旧 spec 无 `layout` 字段**：渲染必须逐字节等价——各组件「无覆写=原路径」回归 + 既有 144 测试（Task 4/5/6 测试钉住）。
- **`layout` 挂到不支持覆写的组件**（如 bar-chart、map-*）：`validateSceneSpec` 必须明确报错，不得静默忽略（Task 4 测试）。
- **改内容后旧覆写失效**：文字标题改了但 `layout.portrait.titleLines` 仍是旧标题的拆分 → 校验报错并提示重设；图表数据点数变少后 `shortLabels.index` 越界 → 报错（Task 5/6 校验 + Task 8 编辑器展示）。
- **预览与出片坐标不一致**：媒体裁切/字幕字号仍按 640×360 或恒横版 → Task 2 用 `mediaClipCss` 出片参数一致性测试 + 竖版截图核查。
- **覆写被后续编辑静默丢弃**：`buildRevisePatch`/`buildChartRevisePatch` 以 spread 保留 `layout`（Task 8 测试）；换模板（`resolveAnyTemplate`）产生新基底时丢弃是预期行为，编辑器须重置覆写草稿（Task 8）。
- **竖版预览显示不可用**（过高撑破布局）或辅助线误入导出：Task 2 CSS 限高 + 导出审计帧无辅助线（Task 10 审计断言）。

---

### Task 1: 共享画幅常量与安全区矩形导出

**Files:**
- Create: `packages/video-document/src/aspect.ts`
- Modify: `packages/video-document/src/index.ts`（追加一行导出）
- Test: `packages/video-document/src/aspect.test.ts`
- Modify: `packages/video-scene/src/safe-layout.ts`（抽 `SAFE_INSET_RATIO` + 新增 `safeFrameRect`）
- Modify: `packages/video-scene/src/index.ts`（导出 `safe-layout.js`）
- Test: `packages/video-scene/src/safe-layout.test.ts`（追加）
- Modify: `scripts/video/render-scene.props.mjs`（`DIMENSIONS`/`PROPS_FPS` 改为从 `@acs/video-document` 导入再重导出，脚本消费方不变）

**Interfaces:**
- Produces:
  - `export const EXPORT_FPS = 24;`（`packages/video-document/src/aspect.ts`）
  - `export const EXPORT_DIMENSIONS: Readonly<Record<AspectTarget, readonly [number, number]>> = { landscape: [1280, 720], portrait: [720, 1280] };`
  - `export const SAFE_INSET_RATIO = 0.1;` 与 `export function safeFrameRect(width: number, height: number): { x: number; y: number; width: number; height: number }`（video-scene；`safeFrame` 改为基于同一常量实现，行为不变）
- Consumes: `AspectTarget`（`./types.js`）；`emUnits` 不变。

- [x] **Step 1: 写失败测试**（`aspect.test.ts`：断言 `EXPORT_FPS === 24`、两画幅尺寸元组、`Record` 键恰好 landscape/portrait；`safe-layout.test.ts` 追加：`safeFrameRect(1280,720)` = `{x:128,y:72,w:1024,h:576}`，`safeFrameRect(720,1280)` = `{x:72,y:128,w:576,h:1024}`，与 `safeFrame(ctx)` 推导一致）
- [x] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document exec node --test dist/aspect.test.js`（模块不存在）；video-scene 同理 `pnpm --filter @acs/video-scene test`
- [x] **Step 3: 实现** `aspect.ts`、`safeFrameRect`、两处 index 导出、props.mjs 改引包（若 .mjs 解析 workspace 包失败，回退：保留本地常量并在 aspect.test.ts 加跨包一致性断言——此时在 commit message 注明）
- [x] **Step 4: 跑测试确认通过**（两条包测试 + `node scripts/video/render-scene.mjs --help` 冒烟，确认 props.mjs 导入不炸）
- [x] **Step 5: Commit** `feat(video): centralize export aspect dimensions and safe-frame rect`

### Task 2: 双画幅预览（A 主体）

**Files:**
- Modify: `apps/web/src/app/video-studio/piece-preview.ts`（新增 `singleShotSpanFrames`）
- Test: `apps/web/src/app/video-studio/piece-preview.test.ts`（追加）
- Modify: `apps/web/src/app/video-studio/scene-preview.tsx`（`ScenePreview`/`TimelinePreview`/`MediaStage`/安全区辅助线）
- Modify: `apps/web/src/app/video-studio/video-studio.css`（画幅切换控件、竖版限高、辅助线、字幕比例）

**Interfaces:**
- Produces:
  - `export function singleShotSpanFrames(durationMs: number): number`（= `quantizeTimeline([durationMs], 24).shots[0]!.frames`；与 remotion `root.tsx` 的 `sceneCalculateMetadata` 同口径）
  - `ScenePreview({ spec }: { spec: SceneSpec })` 签名不变，内部：fps 改 24、`durationFrames` 走 `singleShotSpanFrames`、新增本地 `aspect`/`showSafeGuide` 状态与切换控件（单镜预览只挂在 page.tsx:696，无需页面改动）
  - `TimelinePreview({ items, timeline, transitions?, assets? })` 签名不变，内部新增本地 `aspect`/`showSafeGuide` 状态与切换控件；`SpecCanvas` 显式传 `EXPORT_DIMENSIONS[aspect]` 与 `shotCanvasContext` 结果；`MediaStage` 新增 `stageWidth`/`stageHeight` props 传给 `mediaClipCss`（替代写死的 `PREVIEW_WIDTH/HEIGHT`）
  - 预览字幕：按画幅分支与出片同比例（横版 ≈36/1280、竖版 ≈58/720 → 以 stage 上的 CSS 变量 `--preview-subtitle-size` 控制，位置维持 bottom 8%）
  - 删除 `FPS = 30`/`PREVIEW_WIDTH`/`PREVIEW_HEIGHT` 常量（`PIECE_FPS` 由 `EXPORT_FPS` 替代）
- Consumes: Task 1 的 `EXPORT_DIMENSIONS`/`EXPORT_FPS`/`safeFrameRect`；`@acs/video-document` 的 `quantizeTimeline`。

- [x] **Step 1: 写失败测试** — `piece-preview.test.ts` 追加：`singleShotSpanFrames(1600) === 38`（与既有注释同例，禁 ceil 重算）、`singleShotSpanFrames(1000) === 24`、非正 duration 抛错口径与 `quantizeTimeline` 一致
- [x] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/web exec node --import tsx --test src/app/video-studio/piece-preview.test.ts`
- [x] **Step 3: 实现 `singleShotSpanFrames`**，跑测试通过
- [x] **Step 4: 改造 scene-preview.tsx**：画幅状态与切换控件（两个 `.preview-toggle` 风格按钮 + 「安全区」checkbox，遵循既有 label+input 模式）；`SpecCanvas`/`MediaStage`/字幕/missing 占位全部按 `EXPORT_DIMENSIONS[aspect]`；辅助线 = `.piece-stage` 内绝对定位虚线框（`safeFrameRect` 换算为百分比 inset）+ 「安全区（仅预览）」角标，`aria-hidden`；先查 `apps/web/node_modules/next/dist/docs/` 确认客户端组件/事件用法无版本坑
- [x] **Step 5: CSS**：`.preview-aspect-controls`、`.safe-guide`（虚线 1px、pointer-events:none）、竖版限高（外框 `aspect-ratio` + `max-height` 居中，SVG `width/height:100%`）、`--preview-subtitle-size` 分支；横版维持现状视觉
- [x] **Step 6: 浏览器冒烟** — 起 dev server（`pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3210`），用 playwright-core 截图：数据样片整片预览 横/竖 × 安全区开关 4 张 + 单镜预览竖版 1 张，存 `artifacts/video-studio-dual-aspect-edit-2026-10-23/smoke/`；人工核查竖版可读、媒体/字幕不变形、控件不挤爆布局
- [x] **Step 7: 全量验证** — `pnpm --filter @acs/web test` + `pnpm exec biome check .` + `pnpm -r typecheck`；停 dev server（按端口找 PID）
- [x] **Step 8: Commit** `feat(video-studio): dual-aspect preview with export-exact canvas and safe-area guides`

### Task 3: aspect-layout 契约（容器校验 + layoutFor + 注册表接线）

**Files:**
- Create: `packages/video-scene/src/aspect-layout.ts`
- Test: `packages/video-scene/src/aspect-layout.test.ts`
- Modify: `packages/video-scene/src/registry.ts`（`SceneSpecLike` 增 `layout?: AspectLayoutContainer`；`SceneComponent` 增可选 `validateLayout?(aspectValue: unknown, params: unknown): void`）
- Modify: `packages/video-scene/src/spec.ts`（`layout` 存在时：容器形状 + 至少一画幅 + 逐画幅 `component.validateLayout`；组件未实现 → `fail("组件 X@V 不支持 layout 覆写")`）
- Modify: `packages/video-scene/src/index.ts`（导出）

**Interfaces:**
- Produces:
  - `export type AspectLayoutContainer = { portrait?: Record<string, unknown>; landscape?: Record<string, unknown> }`
  - `export function layoutFor(spec: SceneSpecLike, ctx: FrameContext): Record<string, unknown> | undefined`（按 `isPortrait(ctx)` 取 `layout.portrait`/`layout.landscape`）
  - 组件侧约定：`validateLayout` 抛错即校验失败（与 `validateParams` 同错误直抛口径）；容器内未知键由组件校验负责
- Consumes: `FrameContext`、`SceneSpecLike`、`isPortrait`。

- [x] **Step 1: 写失败测试** — 无 `layout` 的既有 spec 校验通过且 `layoutFor` 返回 undefined；`layout: {}`（空容器）报错；仅 portrait / 仅 landscape / 双画幅合法；`layout` 挂在未实现 `validateLayout` 的组件（bar-chart）→ `/不支持 layout 覆写/`；`layout: 42` 非对象报错；`portrait: "x"` 非对象报错；text-animation 的 `validateLayout` 由 Task 4 提供，本任务测试用一个本地 `defineComponent` 临时组件验证接线
- [x] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/video-scene test`
- [x] **Step 3: 实现**；既有 144 测试保持全绿（旧 spec 无 layout 不进新分支）
- [x] **Step 4: 跑测试确认通过**；`pnpm -r typecheck`
- [x] **Step 5: Commit** `feat(video-scene): optional per-aspect layout override contract on scene specs`

### Task 4: text-animation 覆写（校验 + 渲染）

**Files:**
- Modify: `packages/video-scene/src/components/text-animation.ts`
- Test: `packages/video-scene/src/components/text-animation.test.ts`（追加）

**Interfaces:**
- Produces（组件内类型，经 `validateLayout` 强制）:
  - `TextLayoutOverride = { titleLines?: string[]; titleScale?: number; verticalOffset?: number }`
  - `titleLines`：1..4 行、每行 trim 后 1..80 字符、所有行去空白拼接 === `params.title` 去空白（空白不敏感口径，注释说明拉丁文空格场景）
  - `titleScale`：0.5..1.3 有限数；`verticalOffset`：-0.25..0.25
  - 渲染语义（两画幅一致）：`titleLines` 存在 → 以给定行为准（每行按画幅安全宽钳字号的等比缩小），否则自动 `fitWrappedText`；`titleScale` 乘在自动/钳制后的字号上；`verticalOffset` 把文字块中心从画布中心平移 `offset × height`（正 = 下移）；副标题布局随之平移
- Consumes: Task 3 `layoutFor`、`fitWrappedText`、`safeFrame`、`emUnits`。

- [x] **Step 1: 写失败测试** — 竖版：`titleLines` 三行按行渲染且行序一致、`titleScale=1.3` 字号大于默认、`verticalOffset=0.2` 块中心下移（首行 y 增大）、无覆写时输出与现状逐节点等价（构造同 spec 双渲染对比 attrs）；横版：`titleLines` 两行生效（现状是单行）、无覆写等价；校验：行拼接≠标题报错、5 行报错、空行报错、`titleScale=1.4` 报错、`verticalOffset=-0.3` 报错、未知键 `foo` 报错
- [x] **Step 2: 跑测试确认失败**
- [x] **Step 3: 实现**（portrait/landscape 两分支共用一个「解覆写 → 行列表 + 字号 + 块 top」的小函数，避免两份平移数学）
- [x] **Step 4: 跑测试确认通过**（含既有用例全绿）+ `pnpm -r typecheck`
- [x] **Step 5: Commit** `feat(video-scene): text-animation per-aspect title layout override`

### Task 5: line-chart 覆写（校验 + 渲染）

**Files:**
- Modify: `packages/video-scene/src/components/line-chart.ts`
- Test: `packages/video-scene/src/components/line-chart.test.ts`（追加）

**Interfaces:**
- Produces:
  - `LineChartLayoutOverride = { labelStep?: number; shortLabels?: Array<{ index: number; text: string }> }`
  - `labelStep`：1..points.length 整数；显示规则 = `index % step === 0 || index === points.length - 1`（末点恒显）
  - `shortLabels`：`index` 在 0..n-1 内且唯一、`text` 1..12 字符；命中则按 `text` 原样显示（**绕过既有 >6 字截断**），未命中标签维持既有截断行为
  - 数据点坐标/数值/描画动效不受覆写影响（只动标签层）
- Consumes: Task 3 `layoutFor`；既有 `fitFontSize`。

- [x] **Step 1: 写失败测试** — 12 点 + `labelStep=2`：横/竖版都只渲染 `0,2,4,6,8,10,11` 号标签；`shortLabels=[{index:1,text:"Q1'25 首季"}]` 原样显示（9 字不截断）；未覆写的 >6 字标签仍 `前6字…`；`labelStep` 与 `shortLabels` 可并用；覆写不改变 path/marker 节点数与坐标（对比 attrs）；校验：step=0/13 报错、index 越界/重复报错、text 空/13 字报错、未知键报错
- [x] **Step 2: 跑测试确认失败**
- [x] **Step 3: 实现**（两分支共用「标签可见性 + 显示文本」纯函数）
- [x] **Step 4: 跑测试确认通过** + `pnpm -r typecheck`
- [x] **Step 5: Commit** `feat(video-scene): line-chart label readability override`

### Task 6: 渲染干跑门双画幅

**Files:**
- Modify: `scripts/video/frame-dryrun.mjs`（`width`/`height` 参数化，默认 1280×720）
- Modify: `scripts/video/render-scene.mjs`（干跑按 `project.brief.aspectTargets` 逐画幅执行；其余逻辑不动）

**Interfaces:**
- Consumes: Task 1 `EXPORT_DIMENSIONS`（或 props.mjs 重导出值）。
- Produces: 无新导出；行为 = 竖版项目在出片前先在 720×1280 干跑（此前只跑横版，portrait-only 布局问题会漏到 Remotion 渲染期才炸）。

- [x] **Step 1: 手工验证现状缺口** — 读 `frame-dryrun.mjs` 调用点，确认写死 1280×720
- [x] **Step 2: 实现**（参数化 + 循环；`--skip-dryrun` 语义不变）
- [x] **Step 3: 验证** — 用 Task 8 之前的临时 spec 或既有 fixture 项目跑 `node scripts/video/render-scene.mjs --project ... --out <tmp>` 观察两画幅干跑日志（可 `--skip-dryrun` 跳过的路径不受影响）
- [x] **Step 4: Commit** `fix(video): dry-run gate covers both export aspects`

### Task 7: Web 覆写编辑器（画幅微调）

**Files:**
- Create: `apps/web/src/app/video-studio/aspect-layout-edit.ts`
- Test: `apps/web/src/app/video-studio/aspect-layout-edit.test.ts`
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（「画幅微调」区块 + 应用链接入）
- Modify: `apps/web/src/app/video-studio/shot-edit.test.ts`（追加 layout 保留断言）
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- Produces:
  - `export type TextOverrideFields = { titleLinesText: string; titleScale: string; verticalOffset: string }`（输入框原始字符串；空串 = 未设置）
  - `export type LineChartOverrideFields = { labelStepText: string; shortLabels: Record<number, string> }`
  - `export type LayoutEditDraft = { portrait: TextOverrideFields | LineChartOverrideFields; landscape: 同形 }`（按 spec.componentId 取一种）
  - `export function layoutDraftFromSpec(spec: SceneSpec): LayoutEditDraft`（无 layout → 空草稿）
  - `export function applyLayoutToSpec(spec: SceneSpec, draft: LayoutEditDraft): { spec: SceneSpec } | { error: string }`（构造/清除 `layout` 字段；末尾 `validateSceneSpec` 整体校验，错误转中文文案；全空草稿 → 移除 `layout` 键回到自动布局）
  - `export function describeLineChartLabels(params: { points: Array<{ label?: string; value: number }> }, layout: AspectLayoutContainer | undefined, aspect: AspectTarget): { hidden: number[]; truncated: Array<{ index: number; from: string; to: string }>; shortened: Array<{ index: number; from: string; to: string }> }`（UI 提示数据；与 Task 5 显示规则同实现口径——通过共享纯函数或同断言测试钉住）
- Consumes: Task 3 `AspectLayoutContainer`、`EXPORT_DIMENSIONS` 无关；`validateSceneSpec`/`defaultRegistry`。
- shot-editor-card 接线：`text-animation` 与 `line-chart` 的 spec 臂内渲染「画幅微调」fieldset（画幅页签 竖版默认/横版可选、按组件出对应字段、折线图列出 hidden/truncated/shortened 提示、清除覆写按钮）；草稿随 `shot.workingVersionId` 重置；「应用修订」链在 `buildRevisePatch`（或图表模板链产物）之后调 `applyLayoutToSpec`，错误显示在区块内（`setLayoutError`），不落库。

- [x] **Step 1: 写失败测试** — 草稿往返（spec→draft→apply 幂等）；`titleLines` 拼接不符 → 错误文案；空草稿 apply 移除 `layout`；`buildRevisePatch` 输出的 spec 保留 `layout`（构造带 layout 的 spec 走既有文字编辑臂）；`buildChartRevisePatch` 同样保留（数据编辑不清覆写）；`describeLineChartLabels`：12 点 step=2 → hidden=[1,3,5,7,9]、>6 字未覆写 → truncated、shortLabels 命中 → shortened、无 layout → 全空
- [x] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/web exec node --import tsx --test src/app/video-studio/aspect-layout-edit.test.ts src/app/video-studio/shot-edit.test.ts src/app/video-studio/chart-templates.test.ts`
- [x] **Step 3: 实现** 纯函数模块 → 通过
- [x] **Step 4: shot-editor-card 区块 + CSS**（先查 next docs；沿用既有 label/select/textarea 模式；组件模板切换 `pendingTemplateId` 生效时重置覆写草稿——换模板=新视觉基底）
- [x] **Step 5: 验证** — `pnpm --filter @acs/web test` + biome + typecheck
- [x] **Step 6: Commit** `feat(video-studio): per-aspect layout override editing in shot cards`

### Task 8: 浏览器端到端用例（VID-036）

**Files:**
- Create: `scripts/video/e2e-dual-aspect-edit.mjs`（playwright-core，headless chromium，参照 `e2e-gallery.mjs`）
- Create: `artifacts/video-studio-dual-aspect-edit-2026-10-23/`（截图与导出 JSON 落此）

**Interfaces:**
- Consumes: dev server `http://127.0.0.1:3210`；样片库「季度销量数据动画」；Task 2/7 的 UI。
- Produces: 脚本退出码 0 = 全部断言通过；产物：`before-portrait.png`（覆写前竖版）、`after-portrait.png`、`after-landscape.png`、`export.video-project.json`。

- [x] **Step 1: 写脚本** — 流程：打开数据样片 → 把一个图表镜头切到折线图模板并录入 12 点长标签（≥7 字）、文字镜头改长标题 → 保存 → 整片预览切竖版截图（before）→ 镜头卡设置 `titleLines` + `labelStep=2` + 一条 shortLabel → 应用修订 → 保存 → 刷新重开（`openVideoProject` 路径）→ 导出 JSON 断言 `layout.portrait` 存在、`layout.landscape` 不存在或与竖版独立 → 预览横版截图确认横版未受竖版覆写影响（标题仍单行自动布局）→ 竖版 after 截图
- [x] **Step 2: 起服跑通**（3210 端口配方见记忆：`next dev --hostname 127.0.0.1 --port 3210`；截图断言 DOM 内 `.preview-canvas` 的 viewBox 分别为 `0 0 720 1280` / `0 0 1280 720`）
- [x] **Step 3: Commit** `test(video-studio): dual-aspect edit browser e2e`

### Task 9: 真实双画幅出片 + 审计（VID-035）

**Files:**
- Create: `artifacts/video-studio-dual-aspect-edit-2026-10-23/make-stress-project.mjs`（由 e2e 导出的项目或手构 4 镜头项目：长标题 text ×2、12 点长标签 line-chart ×1、bar-chart 或 number-counter ×1）
- Create: `artifacts/video-studio-dual-aspect-edit-2026-10-23/audit-exports.mjs`（参照 `video-aspect-layout-2026-10-22/audit-exports.mjs`：ffprobe 尺寸/帧率/时长、渲染记录追加核对、安全区逐帧抽检、**标签可读性关键帧单独列节**）
- Create: `artifacts/video-studio-dual-aspect-edit-2026-10-23/REPORT.md`（含人工审片节：与安全区抽检分开陈述）
- Modify: `qa/registry.json`（VID-035 integration = audit 脚本 + requiresFiles；VID-036 browser = e2e 脚本，tier/字段照抄 VID-030/034 惯例）

**Interfaces:**
- Consumes: `node scripts/video/render-scene.mjs --project <副本> --out <dir>`；Remotion ffmpeg 限制（亮度走 scale=1:1+Node 解 PNG）；Task 6 双画幅干跑。
- Produces: `landscape.mp4`/`portrait.mp4`（12 秒级、双画幅）+ 无覆写对照出片（同项目去掉 layout 字段重渲，或覆写前保存的副本）供 before/after。

- [x] **Step 1: 构建压力项目并真出片**（先无覆写版、后有覆写版，各双画幅；共 4 条 MP4）
- [x] **Step 2: 写 audit 脚本并跑 PASS**（断言：分辨率/时长/帧率、renderRecords 追加数、安全区 0 越界、覆写版竖版标签可见数 = labelStep 规则、对照版存在截断标签的关键帧差异）
- [x] **Step 3: 人工审片** — 抽取覆写前后竖版关键帧 PNG 并排入 REPORT.md，逐镜评价可读性（字号、遮挡、换行美感）；已知限制如实列出（如 titleScale 上限造成的安全区回缩）
- [x] **Step 4: 注册 VID-035/036** — `node scripts/qa/run-regression.mjs validate` 通过
- [x] **Step 5: Commit** `test(video): dual-aspect edit export audit and QA registry entries`（含 artifacts；qa/reports/ 不入库）

### Task 10: 收尾验证与交接文档

**Files:**
- Create: `docs/VIDEO_STUDIO_DUAL_ASPECT_EDIT_2026-10-23.md`（进度文档：范围、验证命令与结果、证据索引、已知限制）
- Modify: 本计划勾选框全勾。

- [x] **Step 1: 全量回归** — `pnpm --filter @acs/video-scene test`、`pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test`、`pnpm --filter @acs/web test`、`pnpm -r typecheck`、`pnpm exec biome check .`、`node scripts/qa/run-regression.mjs validate`
- [x] **Step 2: 代码评审** — superpowers:requesting-code-review（whole-branch）
- [x] **Step 3: 完成度核验** — superpowers:verification-before-completion（逐条对照 brief §三 C.1–C.4）
- [x] **Step 4: Commit + 总结给用户的合并指引**（`git -C D:/codex/animate merge --ff-only video-studio/dual-aspect-edit` 交用户执行；不 push）

## Self-Review 记录

- Spec 覆盖：brief §三 A（Task 1/2）、B 文字（Task 4/7）、B 图表一线压力案例（Task 5/7）、B 版本链与兼容（Task 3/7 测试）、§三 C.1（各任务测试 + Task 10）、C.2（Task 8）、C.3（Task 9）、C.4（Task 9 REPORT + Task 10 文档）；§四 边界（Global Constraints）。
- 类型一致性：`AspectLayoutContainer`/`layoutFor`/`EXPORT_DIMENSIONS`/`singleShotSpanFrames`/`applyLayoutToSpec` 各任务引用同名同参。
- 比例：11 任务对 52 行密集 spec，步骤只锁接口与断言，不写实现正文。
