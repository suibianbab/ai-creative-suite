# W1 镜头配方目录 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「按用途选镜头」的 ShotRecipe 目录：三条配方（文字重点/数据结论/商品画面）编译为普通 ContentVersion 追加到当前项目，带元数据、SVG 预览与占位输入，完成全链路验收。

**Architecture:** 纯函数层（元数据 + 编译 + 应用）先行，UI 复用样片库区块模式与 apply-plan 的「追加后待保存确认」语义；编译目标只限已注册组件 spec 或受控 media-clip，零新注册组件、零第二项目模型、零任意代码入口。

**Tech Stack:** @acs/video-scene 组件 render（预览帧）、@acs/video-document 项目契约、Next.js 工作台 UI、Playwright e2e、render-scene CLI。

**Spec:** `docs/VIDEO_STUDIO_EXTERNAL_PROJECTS_DEVELOPMENT_PLAN_2026-10-23.md` §W1；概念收编关系见 `artifacts/handoffs/claude-video-shot-recipes-2026-10-24.md` §概念边界。

## Global Constraints

- 分支 `claude/video-shot-recipes`，基线 `origin/main@518203e`；只提交本分支。
- 文件边界：新建 `apps/web/src/app/video-studio/shot-recipes.ts(+test)`；修改 `page.tsx` 样片入口区块、`video-studio.css`；新建 `scripts/video/e2e-shot-recipes.mjs`、`qa/registry.json`（VID-049）、`artifacts/video-studio-shot-recipes-2026-10-24/`。不改 video-scene 组件、schema、render API、tts-*。
- 四层概念不混淆：族模板/组合模板=镜头内换装；样片库=项目级起点；**ShotRecipe=用途导向镜头卡，编译追加到当前项目**（W1 唯一新层）。
- 配方编译产物必须过 `validateSceneSpec`（组件参数界内）；media 配方无可用资产时明确报错，不产生半吊子镜头。
- 应用配方只改内存文档（与 apply-plan 同口径），点「保存」才落 IndexedDB。
- 预览 SVG 中用户文本必须 XML 转义。
- 旧五样片入口与既有 e2e 的 nth 顺序零影响（目录区块放在样片库之后、独立 class 命名）。
- 证据口径：预览帧与导出对应帧文本一致；「测试通过」≠商业画质。

## Review Focus

1. **media 配方无资产**：项目无 mediaAssets 时配方卡可见但应用报「先导入素材」，不追加镜头（Task 1 测试）。
2. **编译产物合法性**：三条配方默认占位与用户输入（含空串、超长）编译后均过 validateSceneSpec（Task 1 测试：超长输入按组件截断/报错口径）。
3. **未保存放弃**：应用配方后不点保存直接换项目/刷新，IndexedDB 无新镜头（Task 3 测试纯函数不触库 + e2e 验证保存语义）。
4. **SVG 注入**：占位文本含 `<>&"` 时预览 SVG 转义（Task 2 测试）。
5. **旧样片回归**：GALLERY_SAMPLES 卡序不变，stem 样片 e2e 仍绿（Task 5 步骤）。

---

### Task 1: ShotRecipe 元数据与编译核心

**Files:**
- Create: `apps/web/src/app/video-studio/shot-recipes.ts`
- Test: `apps/web/src/app/video-studio/shot-recipes.test.ts`

**Interfaces:**
- Produces: `type ShotRecipe = { id: string; version: number; purpose: string; topics: string[]; aspects: ("landscape"|"portrait")[]; durationMs: { min: number; defaultMs: number; max: number }; componentId: string; placeholders: Record<string, { label: string; example: string }>; requiresAsset: boolean; license: string; previewFrame: number; verified: boolean; build(inputs: RecipeInputs): { spec: SceneSpec } | { error: string } }`；`type RecipeInputs = { title?: string; subtitle?: string; labels?: string[]; values?: number[]; assetId?: string; durationMs?: number }`；`SHOT_RECIPES: readonly ShotRecipe[]`（三条：`recipe-text-point`/text-animation、`recipe-data-bar`/bar-chart、`recipe-product-clip`/media-clip）。

- [ ] **Step 1: 失败测试** — 元数据完备（每条含上述全部字段且 verified=true、aspects 双画幅、license 注明「仓库自有程序化，无第三方素材」或商品条「素材由用户自备」）；`build` 三条默认输入产出过 `validateSceneSpec`；文字条替换 title/subtitle 生效；数据条 labels/values 长度 2..8 校验（越界 error）；商品条 `requiresAsset=true` 且无 assetId 时 error「请先选择媒体素材」；build 内 durationMs 钳到 min..max。
- [ ] **Step 2: 跑测确认失败** — `pnpm --filter @acs/web test`，新用例 FAIL（模块不存在）。
- [ ] **Step 3: 实现** — 三条 build 分别构造 text-animation（沿用样片库 data 开场参数形状）、bar-chart（沿用 data 样片四柱形状，颜色取浅色字系交 bible 重着色）、media-clip sceneSource 由 Task 3 的应用层组装（build 返回 spec 仅限前两条；商品条 build 返回 error 占位，实际编译走 Task 3 的 asset 分支——测试锁定该口径）。
- [ ] **Step 4: 跑测转绿** — web 全套绿。
- [ ] **Step 5: Commit** — `feat(video-studio): shot recipe metadata and compile core`。

### Task 2: 配方 SVG 预览

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-recipes.ts`
- Test: 同文件测试追加

**Interfaces:**
- Consumes: Task 1 的 `previewFrame`、build。
- Produces: `recipePreviewSvg(recipe: ShotRecipe): string`——默认输入 build（media 条用占位图形分支）后 `defaultRegistry` 组件 render 一帧（ctx 320×180、frame=previewFrame、fps=24），SvgNode 树序列化为 SVG 字符串（属性值 XML 转义、text 转义）。

- [ ] **Step 1: 失败测试** — 三条配方各返回以 `<svg` 开头且含默认标题文本的字符串；注入用例：title=`<b>&"` 的预览串中不出现裸 `<b>`；media 条预览含占位矩形+文字「商品画面占位」。
- [ ] **Step 2: 确认失败** — FAIL（函数未定义）。
- [ ] **Step 3: 实现** — SvgNode 递归序列化（约 20 行）；ctx 构造参照 packages/video-scene FrameContext 形状（width/height/frame/fps）。
- [ ] **Step 4: 转绿 + Commit** — `feat(video-studio): recipe svg preview with escaping`。

### Task 3: 应用配方到项目（纯函数）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-recipes.ts`
- Test: 追加

**Interfaces:**
- Produces: `applyShotRecipe(document: VideoProject, recipeId: string, inputs: RecipeInputs, mediaAssets: MediaAsset[]): { document: VideoProject; notice: string } | { error: string }`——追加镜头（contentVersion 形状沿 sample-gallery：durationMs/description/narrationText（配方默认旁白文案，可被输入覆盖）/sceneSource/provenance `{engineId:"shot-recipe", engineVersion:String(recipe.version)}`），brief.applications 追加 `{recipeId, appendedShotCount:1, appliedAt}`；notice 沿 apply-plan 文案风格；media 条校验 assetId 存在于 mediaAssets 且构造 media-clip sceneSource（inMs 0/outMs min(3000, 时长)）。

- [ ] **Step 1: 失败测试** — 空项目应用文字条：返回文档 shots=1、validateVideoProject 通过、provenance engineId=shot-recipe、notice 含「确认无误后点保存」；已有 2 镜项目追加后 shots=3 且原镜不动；media 条 assetId 不在传入资产列表 → error；旁白文案默认值存在。
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: 转绿** → **Step 5: Commit** — `feat(video-studio): apply shot recipe appending content version`。

### Task 4: 目录 UI

**Files:**
- Modify: `apps/web/src/app/video-studio/page.tsx`（样片库区块之后、project-toolbar 之前插「按用途选镜头」section）
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- Consumes: Task 1–3 的 SHOT_RECIPES/recipePreviewSvg/applyShotRecipe。
- Produces: `.recipe-catalog` section：`recipe-filter` chips（全部 + 按 topics 去重）、`.recipe-card`（预览 SVG dangerouslySetInnerHTML、标题/purpose/时长徽章/双画幅徽章/占位说明列表/许可行）、`.recipe-apply` 按钮；输入面板 `.recipe-inputs`（文字条 title/subtitle、数据条 title+labels/values 4 组、商品条资产下拉 `.recipe-asset-select` 列当前项目 mediaAssets）；无项目打开时整区禁用+文案「先新建或打开项目」。

- [ ] **Step 1: 实现 UI**（无组件测试基建，正确性由 Task 5 e2e 锁定；本步含 CSS）。
- [ ] **Step 2: 手动冒烟** — dev server 起本 worktree 端口（3216），目检三条卡、筛选、无项目禁用态。
- [ ] **Step 3: 门禁** — web 测试 + typecheck + biome 绿。
- [ ] **Step 4: Commit** — `feat(video-studio): recipe catalog ui in gallery pane`。

### Task 5: e2e、双画幅出片与证据

**Files:**
- Create: `scripts/video/e2e-shot-recipes.mjs`
- Modify: `qa/registry.json`（VID-049 automated browser）
- Create: `artifacts/video-studio-shot-recipes-2026-10-24/`（REPORT、render、keyframes、project JSON）

**Interfaces:**
- Consumes: Task 4 的选择器（`.recipe-card` nth、`.recipe-apply`、`.recipe-inputs` 输入、`.recipe-asset-select`）。

- [ ] **Step 1: e2e 脚本** — 新建空项目 → 依次应用三条配方（各填输入；商品条先经媒体导入取 assetId——复用 product 样片链路或 API 上传小 MP4）→ 改文字条标题 → 保存 → 刷新重开断言三镜在 → 横竖预览 viewBox 断言 → 导出项目 JSON；断言配方卡 SVG 预览文本与出片代表帧文本一致（导出后 render-scene 双画幅 + 抽帧文本比对）；控制台零错误。
- [ ] **Step 2: 手动跑通**（web :3216）→ exit 0。
- [ ] **Step 3: VID-049 登记 + registry validate 绿**。
- [ ] **Step 4: 旧样片回归** — `SAMPLE_ID=stem e2e-gallery.mjs` failures=0。
- [ ] **Step 5: REPORT.md 四态 + Commit** — `test(video-studio): shot recipe e2e, dual-aspect renders and VID-049`。

### Task 6: 全门禁与交接单终稿

- [ ] **Step 1: 全门禁**（video-scene/video-document/web/typecheck/biome/qa validate + 本线两脚本）。
- [ ] **Step 2: 未验证项记录**（TTS 不涉及——配方镜头 narrationText 存在但本轮出片无声；next build 已知失败；视觉为抽帧级）。
- [ ] **Step 3: 交接单终稿（HEAD、清单、验收脚本、集成注意）+ Commit**。
