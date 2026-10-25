# W2 风格代表帧确认与派生 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 代表镜头双画幅关键帧的「生成→确认→变更失效→再确认→导出闸门」全链路，加派生风格版本与三套内部对照样片。

**Architecture:** 关键帧由镜头注册表在导出坐标空间（1280×720 / 720×1280）直接渲染为 SVG（与出片同组件同 spec，字符串级一致）；确认记录存为项目级加法可选字段 `styleFrameApprovals`（当前态可改写，同 transitions 先例），绑定内容版本 + 风格版本摘要 + 帧 SVG SHA-256 三重身份；失效 = 三者任一不匹配。派生 = Bible 新不可变版本带 `derivedFrom`（影响 digest，天然新身份）。SVG 序列化器上提 @acs/video-scene（偿还 W1 F9 挂账）。

**Tech Stack:** @acs/video-scene 注册表与序列化、@acs/video-document 加法 schema、工作台 UI、Playwright、render-scene。

**Spec:** `artifacts/handoffs/claude-video-studio-continuation-2026-10-24.md` §W2。

## Global Constraints

- 分支 `claude/video-studio-w2-w5`（基线 `origin/main@be77030`），里程碑提交；不合并不推送 main（可推分支）。
- Schema 只做加法可选字段（`styleFrameApprovals?`、`derivedFrom?`），带完整 validate/evolve 语义与测试；不做大改。
- 确认记录是当前态（可改写）非审计史（同 transitions 口径）；内容版本与 Bible 版本本身仍走既有不可变纪律。
- 关键帧渲染必须经 `defaultRegistry` 同组件路径；确认帧 = 镜头中段帧（frame = durationFrames/2）。
- 无确认记录的项目不阻断导出（确认功能 opt-in）；有记录且失效时阻断并给出原因。
- 三套对照样片的源项目可由样片库/配方生成，证据留 `artifacts/video-studio-w2-2026-10-24/`；人工审片如实标「待人工」。
- 门禁：video-scene/video-document/web 三包测试、typecheck、Biome、qa validate、本线 e2e。

## Review Focus

1. **失效判定的三重绑定**：改内容（新 working 版本）、换风格版本、帧摘要变（组件演进）任一都须失效（Task 3 测试三分支）。
2. **保存/刷新/导入后状态准确**：确认存项目 JSON，导入导出往返不丢（Task 5 e2e 断言重开后徽章仍在）。
3. **派生不伤旧项目**：旧项目引用旧版本，重开重渲不变（Task 2 测试 + Task 5 e2e）。
4. **无 Bible 项目不出现确认 UI**；有 Bible 无确认不阻断（Task 3/4 测试）。
5. **序列化器上提不改变既有 CLI 脚本输出**（Task 1 以 scripts/video/svg-serialize.mjs 现行为为基准对拍）。

---

### Task 1: SVG 序列化器上提 @acs/video-scene

**Files:** Create `packages/video-scene/src/svg-serialize.ts`；Modify `packages/video-scene/src/index.ts`（导出）、`scripts/video/svg-serialize.mjs`（改为 re-export 消费 dist）；Test `packages/video-scene/src/svg-serialize.test.ts`。

**Interfaces:** Produces `serializeSvg(node: SvgNode): string`（属性/文本 XML 转义，语义以 scripts/video/svg-serialize.mjs 现实现为准——含单引号转义与自闭合若其已具备）。

- [ ] Step 1: 失败测试——转义（`&<>"'`）、自闭合/文本子节点、与 scripts 版对同一 SvgNode 树输出逐字节一致。
- [ ] Step 2: RED 确认 → Step 3: 实现（迁移 scripts 逻辑，scripts 改 import dist）→ Step 4: GREEN + video-scene 全套绿 → Step 5: Commit `feat(video-scene): hoist svg serializer`。

### Task 2: video-document 加法 schema（确认记录 + 派生元数据）

**Files:** Modify `packages/video-document/src/types.ts`、`validate.ts`、`evolve.ts`；Test 追加。

**Interfaces:** Produces `type StyleFrameApproval = { shotId: string; contentVersionId: string; styleBibleRef: StyleBibleRef; frames: Array<{ aspect: "landscape"|"portrait"; svgSha256: string }>; confirmedAt: string }`；`VideoProject.styleFrameApprovals?: StyleFrameApproval[]`（每 shotId 至多一条，validate 查形状与去重）；`StyleBibleVersion.derivedFrom?: { versionId: string; note: string }`（validate：note ≤200 字；digest 随 canonicalJson 自然变化）。evolve：styleFrameApprovals 同 transitions 自由改写；derivedFrom 属版本不可变纪律既有范围。

- [ ] Step 1: 失败测试——合法确认记录过校验；重复 shotId 拒绝；坏形状（缺 frames/坏 sha）拒绝；derivedFrom 合法/超长拒绝；evolve 改写 approvals 通过、删 Bible 版本仍被既有纪律拦截。
- [ ] Step 2: RED → Step 3: 实现 → Step 4: GREEN（159+ 基线全绿）→ Step 5: Commit `feat(video-document): style frame approvals and derived-from metadata`。

### Task 3: 帧渲染与失效判定（web 纯函数）

**Files:** Create `apps/web/src/app/video-studio/frame-approval.ts`；Test 同名。

**Interfaces:** Consumes Task 1 `serializeSvg`。Produces `renderApprovalFrames(spec: SceneSpec, bibleStyled?: boolean)`→`{ aspect, svg, sha256 }[]`（中段帧、双画幅、背景按 spec）；`approvalStatus(project, bible)`：项目级汇总 `{ valid: boolean; reasons: string[] }`——逐条核对 shot 存在、workingVersionId 一致、styleBibleRef digest 一致、帧 sha 与当前渲染一致；`invalidateReason` 单条口径复用。

- [ ] Step 1: 失败测试——三分支失效（换 working 版本 / 换 bible digest / 组件参数变）；无 approvals 返回 valid=true（不阻断）；无 bible 项目忽略。
- [ ] Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit `feat(video-studio): approval frame rendering and invalidation rules`。

### Task 4: 确认与派生 UI

**Files:** Create `apps/web/src/app/video-studio/frame-approval-panel.tsx`；Modify `style-bible-panel.tsx`（内嵌或并列）、`page.tsx`（接线 + 导出闸门）、CSS。

**Interfaces:** Consumes Task 3。Produces：镜头下拉（`.approval-shot-select`）、「生成关键帧」→ 两幅 SVG（`.approval-frame-landscape/.approval-frame-portrait`）、「确认」（写 styleFrameApprovals）、「重新确认」、状态徽章 `.approval-status`（已确认/已失效+原因）；StyleBiblePanel「派生新版本」按钮（`.bible-derive`，输入备注，生成 derivedFrom 版本并切换项目引用）；renderFromWorkbench 前置 `approvalStatus` 检查，失效则 setEditor message 且不出片。

- [ ] Step 1: 实现 UI + 接线（无组件测试基建，Task 5 e2e 锁定）。
- [ ] Step 2: web 测试/typecheck/biome 绿 → Step 3: Commit `feat(video-studio): frame approval and derive UI with export gate`。

### Task 5: e2e、对照样片与报告

**Files:** Create `scripts/video/e2e-frame-approval.mjs`、`artifacts/video-studio-w2-2026-10-24/`（三套对照 + REPORT）、`artifacts/handoffs/claude-video-studio-w2-result.md`；Modify `qa/registry.json`（VID-050）。

- [ ] Step 1: e2e——样片创建（带 Bible）→ 选代表镜头 → 生成帧 → 确认（徽章已确认）→ 修改该镜头 → 徽章失效 + 出片被阻断（错误信息）→ 重新确认 → 出片放行（双画幅下载）→ 派生新版本（备注）→ 旧确认因 digest 变化失效 → 再确认 → 保存刷新重开徽章仍准 → 导出项目断言 approvals 随 JSON 往返；旧版本项目（派生前导出的 JSON）重开重渲成功。
- [ ] Step 2: 手动跑通（本 worktree web :3217）exit 0。
- [ ] Step 3: 三套对照（文字动效=text 配方项目 / 数据解释=data 配方项目 / 竖版字幕=STEM 样片）各留源项目 JSON、双画幅 MP4（render-scene）、关键帧、来源与「待人工审片」记录。
- [ ] Step 4: VID-050 登记 + validate；旧样片与配方 e2e 回归（e2e-gallery / e2e-shot-recipes）。
- [ ] Step 5: w2-result.md 四态报告 + Commit。
