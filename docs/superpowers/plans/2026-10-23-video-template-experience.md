# Video Studio 模板创作体验线 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增两个非 STEM 题材的可编辑完整项目样片（家装方案讲解、设备操作说明），补齐模板预填语义的操作提示，并打磨新样片暴露的布局问题——让非 STEM 用户能从样片入口开始创作。

**Architecture:** 全部复用既有机制：`GALLERY_SAMPLES` 元数据 + `sampleShots()` 构建器 + 独立 Style Bible（`createGallerySample` 内 `styleSceneSpec` + `applyStyleBible`）；镜头只用已注册组件（text-animation / explainer-composition flow+drawing / sketch-note / number-counter）。零 schema 改动、零新组件、零行为语义变更（预填裁决只加提示不改行为）。

**Tech Stack:** Next.js (apps/web) + @acs/video-scene 已注册组件 + @acs/video-document 项目/Style Bible + Playwright e2e + render-scene CLI。

**Spec:** `docs/VIDEO_STUDIO_CODEX_CLAUDE_PARALLEL_PLAN_2026-10-23.md` 第 2 节（任务范围与验收）、第 4 节（worktree/交接/互审）、第 5 节（门禁与边界）。

## Global Constraints

- 分支 `claude/video-template-experience`，基线 `main@d5470be`；只提交本分支，不合并不推送 main。
- 文件边界（spec §2）：`sample-gallery*`、`composition-templates*`、`shot-editor-card.tsx`、相应 CSS、模板浏览器脚本、本线报告；另加验收要求的 `qa/registry.json` 与 `apps/web/public/samples/` 海报。**不改** `packages/video-document` schema、`packages/media-store`、`scripts/video/render-scene.mjs`。
- 预填裁决（spec §2.3 + 2026-10-23 R1 用户裁决）：「选中模板即预填、选回当前组件不撤销预填」是既定语义，**只加提示文案，不改任何行为**。
- 标注坐标须在 explainer-composition 校验界内：y ∈ 650..800、portraitY ∈ 800..1450；flow 步骤标签 ≤10 字（建议 2–4 字）。
- 新样片全部程序化（无外部素材、无 TTS 依赖）；海报用仓库自有 SVG。
- 证据口径（spec §5）：写实际命令、退出码、产物路径；「测试通过」≠「商业成片质量」。
- 新 worktree 引导：`pnpm install --frozen-lockfile && pnpm -r build`（`@acs/shared` 等从 dist 导出，不 build 则 tsc TS2307）。勿并发跑 install 与测试。

## Review Focus

1. **GALLERY_SAMPLES 追加顺序**：现有 e2e 用 `.sample-card` nth(1) 定位 data 样片——新样片必须**追加在数组末尾**，不得插队（测试：Task 4 e2e 对 nth(1) 的既有断言仍通过）。
2. **两新样片与 Style Bible 的对比约束**：深浅 palette 切换后标题/正文对比 ≥4.5:1 且 `workingStyleIssues` 为空（测试：sample-gallery.test.ts 按 stem 用例模式对 renovation/appliance 复制断言，Task 1/2 Step 1）。
3. **标注与字幕带**：竖版 portraitY ≤1450 且含半字号余量后不压字幕带（测试：抽帧视觉检查 + 参数界内由 validateSceneSpec 保证，Task 5）。
4. **提示文案不得改变行为**：预填语义提示是纯静态 DOM；e2e 断言提示出现且浏览→还原→应用链路行为与 d5470be 一致（Task 4 复用 r4 锁定断言）。
5. **海报可访问性**：sample-card-poster 有 aria-label（现有模式），新海报 SVG 须实际存在于 public/samples/（测试：page 无 404 由 e2e 加载成功隐含覆盖；SVG 内容在 Task 1/2 Step 4 目检）。

---

### Task 1: 「家装方案讲解」样片（renovation）

**Files:**
- Modify: `apps/web/src/app/video-studio/sample-gallery.ts`
- Modify: `apps/web/src/app/video-studio/sample-gallery.test.ts`
- Create: `apps/web/public/samples/p4-renovation.svg`

**Interfaces:**
- Produces: `GallerySampleId` 增加 `"renovation"`；`GALLERY_SAMPLES` 末尾追加条目 `{ id: "renovation", title: "两房变三房 · 家装方案", poster: "/samples/p4-renovation.svg", ... }`；`sampleShots()` 新增 renovation 分支（5 镜头，总时长 16000ms）。`createGallerySample("renovation")` 返回挂暖木色 bible 的项目。

- [ ] **Step 1: 写失败测试** — 在 `sample-gallery.test.ts`：id 列表断言改为 `["stem", "data", "product", "renovation", "appliance"]`（appliance 由 Task 2 实现，本步先红）；新增测试「家装样片：5 镜头、总时长 16 秒、全部镜头可校验且挂独立 bible」——`createGallerySample("renovation")`：`shots.length === 5`、总 durationMs 16000、每镜头有 narrationText、`validateVideoProject` 通过、`workingStyleIssues(project, version)` 为空、每镜头 spec 过 `validateSceneSpec`、含 ≥1 个 explainer-composition flow 镜头与 ≥1 个 drawing 镜头。
- [ ] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/web test`，预期 renovation 相关用例 FAIL（样片不存在抛「未知样片」）。
- [ ] **Step 3: 实现样片** — `RENOVATION_PALETTE = { background: "#241c14", foreground: "#f5efe6", secondary: "#e3cfae", accent: "#d97a3d", object: "#7d8b5a" }`；bible 名「暖木家装」。镜头（复用 `text()`/`spec()` 助手，seed 4401–4405）：
  1. text「两房变三房」/「一次讲清改造方案」3000ms；
  2. explainer-composition flow「改造四步」steps 量房/设计/施工/验收，annotation「工期与预算可控」(x500, y730, portraitY1260, enterMs2000) 3500ms；
  3. explainer-composition drawing「户型调整示意」paths 两笔：外框 `M 220 300 L 780 300 L 780 620 L 220 620 Z` 与拆改线 `M 500 300 L 500 620`（虚墙由 strokeColor 表达），annotation「非承重墙可移除」(x500, y740, portraitY1240, enterMs1800) 3500ms；
  4. sketch-note「两个关键提醒」items「承重墙不可拆」(下划线) /「水电走顶易检修」(圈) 3000ms；
  5. text「从方案到入住」/「下一步：预约实地量房」3000ms。
  GALLERY_SAMPLES 末尾追加卡片条目（title「两房变三房 · 家装方案」，summary「四步流程＋户型示意＋关键提醒的家装讲解」，detail「5 镜头 · 约 16 秒 · 可改标题、流程、标注与户型线稿」）。
- [ ] **Step 4: 跑测试确认通过（appliance 项仍红属预期）** — `pnpm --filter @acs/web test`：renovation 用例 PASS。
- [ ] **Step 5: 海报** — 创建 `p4-renovation.svg`：参照 `p4-stem.svg` 尺寸与结构，暖木底色 + 四步流程块示意 + 标题条；目检无外部引用。
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(video-studio): renovation gallery sample with warm-wood bible"`。

### Task 2: 「设备操作说明」样片（appliance）

**Files:**
- Modify: `apps/web/src/app/video-studio/sample-gallery.ts`
- Modify: `apps/web/src/app/video-studio/sample-gallery.test.ts`
- Create: `apps/web/public/samples/p4-appliance.svg`

**Interfaces:**
- Consumes: Task 1 的 id 列表断言。
- Produces: `GallerySampleId` 增加 `"appliance"`；`sampleShots()` appliance 分支（5 镜头 16500ms）；`createGallerySample("appliance")` 挂蓝灰技术 bible。

- [ ] **Step 1: 写失败测试** — 新增「设备样片：5 镜头、总时长 16.5 秒、含 number-counter 镜头、可校验」用例（同 Task 1 断言模式，另断言 ≥1 个 number-counter 镜头）。
- [ ] **Step 2: 跑测试确认失败** — `pnpm --filter @acs/web test`，预期 FAIL。
- [ ] **Step 3: 实现样片** — `APPLIANCE_PALETTE = { background: "#141a22", foreground: "#eef3f8", secondary: "#c3d4e6", accent: "#4aa3d9", object: "#5b7fa6" }`；bible 名「蓝灰技术」。镜头（seed 4501–4505）：
  1. text「换滤芯只需四步」/「咖啡机维护指南」3000ms；
  2. explainer-composition flow「维护四步」steps 断电/开盖/更换/复位，annotation「热水排空后再操作」(x500, y730, portraitY1250, enterMs2200) 3500ms；
  3. sketch-note「安全提醒」items「只用原厂滤芯」(下划线) /「先断电再开盖」(圈) 3000ms；
  4. number-counter「滤芯更换周期」value 90、suffix " 天"、decimals 0 2500ms；
  5. text「维护到位，风味常在」/「到期自动提醒更省心」3000ms；注：sketch-note 与 number-counter 的颜色参数取浅色（fg 系），交由 `styleSceneSpec` 重着色。
  GALLERY_SAMPLES 末尾追加条目（title「换滤芯四步 · 设备操作」，summary「操作流程＋安全提醒＋维护参数的设备指南」，detail「5 镜头 · 约 16.5 秒 · 可改步骤、提醒与周期数字」）。
- [ ] **Step 4: 跑测试确认全部通过** — `pnpm --filter @acs/web test`：Task 1 遗留的 appliance id 断言转绿。
- [ ] **Step 5: 海报** — 创建 `p4-appliance.svg`（蓝灰底 + 四步编号块 + 参数数字条）。
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(video-studio): appliance operation gallery sample"`。

### Task 3: 模板预填语义提示（零行为变更）

**Files:**
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（组件模板 label 区，约 :692）

**Interfaces:**
- Produces: 组件模板 select 下方的静态提示 `<p className="aspect-layout-hint">`（复用既有样式类，无新 CSS、无状态、无行为）。

- [ ] **Step 1: 插入提示文案** — 在 `chart-template-select` 所在 label 之后加：`选中模板即把模板内容预填进下方编辑区；改回「保持当前组件」不会撤销预填，应用修订时按编辑区当前内容保存。`
- [ ] **Step 2: 验证无行为改动** — `git diff` 仅一处纯 JSX 文本节点；`pnpm --filter @acs/web test` 全绿（既有 r4/G1 用例守护行为）。
- [ ] **Step 3: Commit** — `git commit -m "docs(video-studio): surface template prefill semantics in shot editor"`。

### Task 4: 双题材全链路 e2e + QA 注册表

**Files:**
- Create: `scripts/video/e2e-gallery-extensions.mjs`
- Modify: `qa/registry.json`

**Interfaces:**
- Consumes: Task 1/2 的样片卡（`.sample-card` nth(3)/nth(4)）；Task 3 的提示文案选择器 `.aspect-layout-hint`。
- Produces: `VID-043`（双题材浏览器全链路）、`VID-044`（双题材双画幅出片审计）注册表条目；证据目录默认 `.tools/video-gallery-extensions-e2e`，环境变量 `GALLERY_EVIDENCE_DIR`、`BASE_URL`。

- [ ] **Step 1: 写 e2e 脚本** — 参照 `e2e-composition-templates.mjs` 结构，对 renovation、appliance 各执行：点样片卡创建 → 断言 5 张镜头卡 → 展开首镜断言预填提示可见 → 改一个标题 + 一条标注 → 应用（版本数 +1）→ 刷新重开项目 → 回滚该镜头 → 横/竖预览切换各断言一次画布尺寸 → 导出项目 JSON 存证。控制台零错误。既有 nth(1) 定位不受影响（追加序保证）。
- [ ] **Step 2: 手动跑通**（web :3210，本 worktree dev server）— `node scripts/video/e2e-gallery-extensions.mjs`，预期退出码 0、证据目录含 before/edited/reopened/rollback 四组 × 两题材项目 JSON。
- [ ] **Step 3: 注册表条目** — `qa/registry.json` automated 追加：VID-043（cwd `.`，argv `["node","scripts/video/e2e-gallery-extensions.mjs"]`，checks 含「两题材创建→改→存→重开→回滚→双画幅预览」「预填提示可见且语义未变」）；VID-044（argv 指向 Task 5 的出片审计脚本 `["node","scripts/video/audit-gallery-extensions.mjs"]`，checks 含「双题材横竖 MP4 关键帧与时长」「审计 JSON 数字吻合」）。
- [ ] **Step 4: 验证** — `node scripts/qa/run-regression.mjs validate` 通过（schema 合法）。
- [ ] **Step 5: Commit** — `git commit -m "test(video-studio): dual-theme gallery extension e2e and QA registry entries"`。

### Task 5: 双画幅真实出片、视觉检查与布局打磨

**Files:**
- Create: `scripts/video/audit-gallery-extensions.mjs`
- Create: `artifacts/video-template-experience-2026-10-23/`（REPORT.md、render/、keyframes/）
- Modify（仅当视觉检查暴露问题）: `sample-gallery.ts` 标注/offset 参数

**Interfaces:**
- Consumes: Task 4 导出的两题材项目 JSON。
- Produces: 每题材横竖 MP4（render-scene CLI，无 TTS）、逐镜中段抽帧、`render-audit.json`（帧数/尺寸/SHA-256）、视觉检查结论与修复记录。

- [ ] **Step 1: 出片与抽帧** — 对两题材 edited JSON 跑 `node scripts/video/render-scene.mjs --project <json> --out <dir>`（横竖各一）；ffmpeg 抽每镜中段帧。
- [ ] **Step 2: 视觉检查** — 用视觉模型审全部抽帧：字幕/标注遮挡、文字截断、背景对比、竖版留白、双画幅差异；逐项记录。
- [ ] **Step 3: 修复暴露的问题** — 仅调样片参数（标注坐标、diagramOffset、字号经由组件既有参数）；每修一处重出片对比；不扩组件不加自由画布。
- [ ] **Step 4: 审计脚本** — `audit-gallery-extensions.mjs` 校验两题材双画幅存在、帧数=时长×24、记录 SHA-256、断言渲染记录回写；输出 PASS JSON 入证据目录。
- [ ] **Step 5: REPORT.md** — 记录链路、命令与退出码、抽帧结论、已知视觉限制（如竖版纯文字镜头留白大）、修改前后对照。
- [ ] **Step 6: Commit** — `git commit -m "test(video-studio): dual-theme dual-aspect renders, visual review and audit"`。

### Task 6: 全门禁、交接单与收尾

**Files:**
- Create: `artifacts/handoffs/claude-video-template-experience.md`（若未在开工前创建，此时补齐终稿）
- Modify: 本计划文件（勾选完成项）

**Interfaces:**
- Produces: 交接单终稿（实际修改文件清单、接口假设、验收脚本、绝对路径+分支名+提交范围、未验证项）。

- [ ] **Step 1: 全门禁** — `pnpm --filter @acs/video-scene test && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test && pnpm -r typecheck && pnpm exec biome check . && node scripts/qa/run-regression.mjs validate`；另跑本线 `e2e-gallery-extensions.mjs`、`audit-gallery-extensions.mjs`。全部退出码 0。
- [ ] **Step 2: 未验证项如实记录** — 至少含：`next build` 在本 worktree 失败未查（非门禁）；TTS 旁白未生成（样片 narrationText 存在但 MP4 无声）；视觉检查为抽帧级人工/模型审，非逐帧商业验收。
- [ ] **Step 3: 交接单终稿 + Commit** — 分支名、HEAD 提交范围、证据绝对路径写入 `artifacts/handoffs/`；`git commit -m "docs(video-studio): template experience handoff and plan closure"`。
