# Video Studio P1 第一刀：多场景编排（时间线 + STEM 分镜 + 整片出片）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实施本计划。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 一句话 STEM 需求 → 多镜头分镜（规则规划器）→ 工作台时间线/整片预览 → 单文件整片双画幅 MP4 出片（累计边界量化拼接），并补上 P2-A 遗留的逐帧干跑超时。

**Architecture:** 复用 P0 的声明式 SceneSpec 组件与量化器：多镜头 = 每镜头一个 spec + 全局帧→(镜头,本地帧) 的映射。渲染端新增 Timeline 合成（Remotion），工作台新增 TimelinePreview（rAF），两边共用 video-document 的 `quantizeTimeline`/新增 `mapGlobalFrame`。出片 CLI 从单镜头限制泛化为整片渲染，RenderRecord 按（画幅 × 镜头内容版本）追加。

**Tech Stack:** 既有栈——@acs/video-document（量化/演进/校验）、@acs/video-scene（组件注册表+门禁）、@acs/remotion-engine（Remotion 合成）、apps/web（React 客户端组件）、scripts/video/*.mjs（CLI）。

**Spec:** docs/adr/0003-video-studio-shot-schema.md（§2 执行边界、§3.5 量化、§3.1 只追加）；docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md P1 行。

## Global Constraints

- 全程 TDD（先看失败再实现）；一条任务一提交，提交信息末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不碰 Image Studio / PhotoCraft 任何文件；媒体证据维持 SHA-256+本机复核标注（gitignore 约定不动）。
- 禁网络/墙钟/未播种随机入渲染路径（determinism-gate 已在 video-scene 套件内巡检）。
- 零帧镜头是编排错误：规划/应用阶段就用 quantizeTimeline(…,24) 预检并给人话错误，不许静默。
- 本刀零计费调用（DashScope TTS 属后续刀）。
- Biome 全绿；改 .ts 后跑对应包 build+test；web 改动跑 `node --import tsx --test "src/app/video-studio/*.test.ts"` + `pnpm typecheck`。

## Review Focus（本刀测试没覆盖、最容易咬人的五类输入）

1. 秒数小/镜头多的组合在某 fps 量化出零帧 → 规划器必须先量化预检再给结果（如「1秒分8镜头」→ 拒绝并说原因）。
2. 总时长分配取整后各镜头 durationMs 之和 ≠ 需求总时长 → 末镜头吸收余数，断言 Σ=总时长。
3. 全局帧落在边界帧（startFrame 恰好等于某镜头起点）与超尾帧（frame ≥ totalFrames）→ mapGlobalFrame 必须钳制/归属正确。
4. 对已有镜头的项目应用分镜 → 只追加不重写；旧 shots 逐字段原样（assertAppendOnlyEvolution 通过）。
5. 多镜头 props 里混入非法 spec（未注册组件/时长不一致）→ Timeline 合成与 CLI 都必须在渲染前校验失败，不产半截 MP4。

---

### Task 1: video-document `mapGlobalFrame` 纯映射

**Files:**
- Modify: `packages/video-document/src/quantize.ts`
- Test: `packages/video-document/src/quantize.test.ts`（追加用例）

**Interfaces:**
- Produces: `mapGlobalFrame(timeline: QuantizedTimeline, frame: number): { shotIndex: number; localFrame: number }` — frame 钳到 [0, totalFrames-1]；边界帧归后一镜头起点正确；空 timeline 抛错。

- [ ] Step 1: 失败测试：三镜头 [1600,1600,1600]ms@24 → spans [38,39,38]（累计边界量化）；map(t,0)={0,0}、map(t,38)={1,0}、map(t,76)={2,0}、map(t,200)={2,37}（钳制）、map(空) 抛错
- [ ] Step 2: `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test` 看新用例 FAIL
- [ ] Step 3: 实现 mapGlobalFrame（二分或线性查找边界）
- [ ] Step 4: 同命令全绿（28+新增）
- [ ] Step 5: 提交 `feat(video-document): mapGlobalFrame 全局帧→镜头本地帧映射`

### Task 2: 规划器 STEM 多镜头分镜

**Files:**
- Modify: `apps/web/src/app/video-studio/planner.ts`、`planner.test.ts`

**Interfaces:**
- Produces: `type StoryboardShot = { label: string; plan: PlanResult & { ok: true } }`；`type StoryboardResult = { ok: true; title: string; totalMs: number; shots: StoryboardShot[] } | { ok: false; reason: string; guidance: string }`；`planStoryboard(sentence: string): StoryboardResult`
- 句式：`做一个<3..120>秒的STEM解说视频，主题是<标题>[，分<3..8>个镜头]`（默认 4）
- 镜头构成：首镜头 text-animation（标题、无副标题、fade-up）；中间镜头交替 text-animation 要点（副标题=「要点 N」）/ basic-shapes 示意；末镜头 text-animation 结语。每镜头 seed=FNV-1a(句子+镜头序号)；时长均分、末镜头吸收余数；出场即 `quantizeTimeline(durations,24)` 预检，ZeroFrameShotError → ok:false 人话原因
- 单镜头句式（P0 语法）不受影响

- [ ] Step 1: 失败测试 ×5：合法 30s/4 镜头（4 shots、Σ=30000、每 spec 过 validateSceneSpec、renderHint 点名内容）；默认镜头数；`分3个镜头` 生效；秒数/镜头数越界拒绝；1 秒分 8 镜头零帧拒绝
- [ ] Step 2: web 测试命令看 FAIL
- [ ] Step 3: 实现 planStoryboard
- [ ] Step 4: web 套件全绿
- [ ] Step 5: 提交 `feat(video-studio): STEM 一句话多镜头分镜规划器`

### Task 3: applyPlan 追加分镜模式

**Files:**
- Modify: `apps/web/src/app/video-studio/apply-plan.ts`、`apply-plan.test.ts`

**Interfaces:**
- Produces: `applyStoryboard(document: VideoProject, sentence: string, storyboard: StoryboardResult, ids: { shot: () => string; version: () => string }): { mode: "storyboard-append"; notice: string; document: VideoProject }`
- 语义：N 个新 shot 追加到 shots 尾部（order 接续现有最大+1），每镜头一个 contentVersion+submitted 事件，brief.sentence 更新为分镜句；对已有镜头零改动。结果必须过 `assertAppendOnlyEvolution(base, result)`
- 单镜头 applyPlan 双模式（first-shot / save-as-new）不动

- [ ] Step 1: 失败测试 ×3：空项目应用（4 shots、order 0..3、事件 submitted、Σ 时长=30000）；非空项目追加（旧 1 镜头 → 5 镜头、旧镜头逐字段不变、assertAppendOnlyEvolution 通过）；locked 镜头存在的项目追加（允许——locked 管的是该镜头自身内容，不管新增镜头）
- [ ] Step 2: 看 FAIL → 实现 → 全绿
- [ ] Step 3: 提交 `feat(video-studio): 分镜应用为追加镜头（只追加演进）`

### Task 4: remotion-engine Timeline 合成

**Files:**
- Modify: `packages/remotion-engine/src/scene-spec-composition.tsx`、`root.tsx`
- Test: 无独立包测试（Remotion 组件），行为由 Task 6 CLI+E2E 覆盖；导出纯函数 `buildTimelineProps` 供 CLI 复用并单测在哪？→ 放 `packages/video-document` 不合适（含 spec 校验依赖 video-scene）→ 纯数据拼装留在 CLI，合成层保持薄

**Interfaces:**
- Produces: `TimelineProps = { shots?: Array<{ spec: SceneSpec; startFrame: number; frames: number }> }`；`TimelineScene: FC<TimelineProps>`——useCurrentFrame → 线性找 startFrame ≤ frame < startFrame+frames 的镜头 → 复用提取的 `renderSpecNode(spec, {frame: local, ...})`（从 SceneSpecScene 抽公共：validate→component.render→assertNodeBudget→SvgTree）；无 props 返回 null
- root.tsx 注册 `Timeline-Landscape/Portrait`，calculateMetadata 从 props Σframes（无 props 144 占位）

- [ ] Step 1: 抽取 renderSpecNode（SceneSpecScene 行为不变，typecheck+既有路径回归）
- [ ] Step 2: TimelineScene + 注册；`pnpm --filter @acs/remotion-engine typecheck`
- [ ] Step 3: 手干跑：临时 props 渲染冒烟（并入 Task 6 的 CLI 验证，不单独提交产物）
- [ ] Step 4: 提交 `feat(remotion-engine): Timeline 多镜头合成与帧归属`

### Task 5: 工作台时间线 UI + 整片预览

**Files:**
- Modify: `apps/web/src/app/video-studio/page.tsx`、`scene-preview.tsx`、`video-studio.css`
- Test: `piece-preview.test.ts`（新）——整片预览的纯逻辑：给定 durations 与 fps，播放循环的全局帧推进/镜头切换点序列

**Interfaces:**
- Produces: `ScenePreview` 重构出 `SpecCanvas({spec, frame, width?, height?})`；新 `TimelinePreview({ items: Array<{ spec; startFrame; frames }> })`（rAF 驱动全局帧 → mapGlobalFrame → SpecCanvas）；编辑器 shots 面板：镜头卡列表（序号/组件/时长/描述）+ 量化时间条（span 宽度按 frames 占比）；规划卡：planStoryboard ok → 分镜卡（逐镜头 label+renderHint），按钮「确认应用（追加 N 镜头）」走 applyStoryboard
- 现有单镜头句式 UI 流程不变；`.plan-card`/`.editor-*` 选择器保留（E2E 依赖）

- [ ] Step 1: 失败测试：piece 帧推进纯逻辑（推进跨镜头边界、循环回零）
- [ ] Step 2: 实现 SpecCanvas/TimelinePreview + 面板接线 + css
- [ ] Step 3: web 套件 + typecheck 全绿；`npx biome check --write` 改动文件
- [ ] Step 4: 提交 `feat(video-studio): 镜头时间线、分镜确认卡与整片预览`

### Task 6: render CLI 多镜头整片出片 + 逐帧干跑超时

**Files:**
- Modify: `scripts/video/render-scene.mjs`
- Create: `scripts/video/frame-dryrun.mjs`（worker 干跑）、`scripts/video/frame-dryrun.test.mjs`
- Test: frame-dryrun 单测 + 真实多镜头项目冒烟（artifacts/video-studio-multishot/）

**Interfaces:**
- render-scene.mjs：去掉单镜头限制 → shots 全部 working version 且 spec；`quantizeTimeline(durations,24)` 帧图；每画幅写 props `{shots:[{spec,startFrame,frames}]}` 渲染 `Timeline-*` 合成；ffprobe 核对总帧数；RenderRecord 按（画幅 × 镜头版本）追加（frames=该镜头 span，output=整片 mp4）；manifest 增 `frameMap`；渲染前跑 frame-dryrun（`--skip-dryrun` 可跳）
- frame-dryrun.mjs：worker_threads 池对每（镜头×帧）执行 component.render，单帧预算默认 500ms 超时 → 进程非零退出并点名镜头/帧；单测用慢组件 fixture（video-scene 注册表外直构 render 函数）验证超时路径与正常路径

- [ ] Step 1: frame-dryrun 失败测试（正常快组件通过；人为死循环 render 超时被杀并报帧号）
- [ ] Step 2: 实现 worker 干跑 → 单测绿
- [ ] Step 3: render-scene 泛化多镜头；用 Task 2/3 产出的 4 镜头项目真实出片（双画幅、ffprobe、RenderRecord ×8、savedVersion+1）
- [ ] Step 4: 单镜头旧路径回归（video-studio-smoke 夹具重渲一致）
- [ ] Step 5: 提交 `feat(video): 整片多镜头出片与逐帧干跑超时（P2-A 补齐）`

### Task 7: 多镜头 E2E 闭环 + 证据 + 文档

**Files:**
- Create: `scripts/video/e2e-multishot.mjs`、`artifacts/video-studio-multishot/E2E_MULTISHOT.md`
- Modify: `qa/registry.json`（VID-008 干跑门禁 automated、VID-009 多镜头闭环 manual）、`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`

- [ ] Step 1: E2E：STEM 句 → 分镜卡（4 镜头预告）→ 应用 → 保存 v2 → 导出 → CLI 整片出片 → 导入 → 断言 v3、RenderRecord 区块含 8 条（1280×720×4 + 720×1280×4）、同项目 ID、控制台零错误、截图
- [ ] Step 2: 证据 md（SHA-256 表 + 如实可复核性声明）+ registry + CURRENT_STATE
- [ ] Step 3: 全量回归：pnpm lint / typecheck / 各包 test / qa:validate / qa:video-determinism / 两条 E2E
- [ ] Step 4: 提交 `feat(video-studio): 多镜头端到端闭环与 P1 第一刀收口证据`
- [ ] Step 5: push origin worktree-video-studio-p1
