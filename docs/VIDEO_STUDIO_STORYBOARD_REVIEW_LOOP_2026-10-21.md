# Video Studio 分镜审阅环：落地与后续顺序（2026-10-21）

依据 2026-10-21 差距复核与实施计划 `docs/superpowers/plans/2026-10-21-video-studio-storyboard-review-loop.md`（`2ca5a76`）：A1/A2/C 三个任务已在分支 `worktree-video-studio-p4-storyboard` 落地并过评审（**未合并**）。本文只记录本阶段落地范围、后续顺序与门禁、明确不做与证据口径，不复述计划全文；架构基线（ADR 0003、ADR 0012）不变。

## 1. 本阶段落地

- **A1 确认卡旁白**（`935f0fd`）：新增 `storyboardConfirmLines` 行模型，确认卡逐镜头显示「旁白」。行模型直接取自 `planStoryboard` 的同一规划快照，确认后落库的 `narrationText` 与卡上显示同源，不在 UI 层另拼一份。
- **A2 镜头说明**（`77798af`，小修 `163d47b`）：每镜头产出可读说明（意图而非组件名），**复用 `ContentVersion.description`，零 schema 变更、不升版本号**。说明随内容版本落库，通用 / 媒体 / 3D 三个编辑臂都经 `attachDescription` 附着；空说明与超 200 字（含粘贴路径）在卡片内逐字拒绝，不落版本。
- **C 时长影响**（`b70adbd`，小修 `d7186eb`）：改时长时实时给出整片帧数 `before → after` 与相邻转场借帧是否失效，不再等到渲染期才报错。缩到零帧时 `afterFrames` 为 `null` 并指名镜头；越界与相邻守卫在实现与变异测试中互补。

关键决定：

- 说明复用既有 `ContentVersion.description`，唯一新增的是写入校验（1..200 字符）与三个编辑臂的附着顺序；不新增字段、不改 schema 版本、不新增 ADR。
- 影响提示只在可编辑且草稿毫秒数合法（`>= 1`）时计算；仅在 `boundary === shotIndex - 1 || boundary === shotIndex` 存在转场时才调用转场窗口解析——远处转场不因本次改动变化，不误报。
- 所有用户可见文案为中文，沿用既有配色与卡片布局。

## 2. 后续顺序与门禁

2026-10-21 复核结论，**顺序勿重开**：

1. **B — 关键镜头双候选**：**已完成（2026-10-22）**。1–2 个关键镜头给两个候选版本供人工挑选；复用既有内容版本 + `submitted` 事件，零 schema。落地见 `docs/superpowers/specs/2026-10-22-video-studio-dual-candidate-design.md`：镜头卡「对比候选」两列并排显示说明/时长/整片帧数，选用复用 `rollbackWorkingVersion`（audit 留痕、锁定允许），并新增与 C 同源的零帧选择闸门；回归 QA `VID-027`。
2. **E0 — 交付记录补齐**：GIF / SVG 的 `DeliveryRecord` 补 `outputRef` / `digest`，与 P3-A 交互 HTML 交付口径对齐（当下仅 `interactive-html` 记录这两字段）。
3. **D — Style Bible**：按 ADR 0003 第 7 条作为独立版本化记录，项目文档只存引用（ADR-0012：品牌与风格约束归平台）；**须有真实样片证据才开工**，不以设计稿替代。
4. **PDF / 大纲导出**：按需再做，不与上述阶段绑定。
5. **F — 仅调研**：只做调研，不排期、不承诺落地。

## 3. 明确不做

- **第二个编辑器**：不新建平行画布/时间线；专业编辑沿用 ADR-0012 的桥接与引用边界。
- **确认卡的可编辑预告**：确认卡保持只读展示；编辑入口在镜头卡，不在确认卡上预演「确认后还能改」。
- **启发式「内容适配」提示当承诺**：只允许标注为**不可靠**的提示，不得写成能力承诺或验收口径。

## 4. 证据口径

- 帧数与借帧结论全部来自既有 `quantizeTimeline` / `resolveTransitionWindows`，**与渲染同源**，不另立帧数学、不在 UI 层重算时间线。
- 本次验证：`scripts/video` **152**（145+7）、`@acs/video-document` **144**、`@acs/web` **219** 全绿；`biome check .` **381** 文件 clean（exit 0）。
- **零 TTS 计费**：本计划未运行任何 TTS 命令，未传 `--narration`，历史基线台账 34 行不变（`artifacts/tts-usage.jsonl` 为 gitignored 未跟踪文件、未随本工作树检出，本树内无该文件可复核行数）。
