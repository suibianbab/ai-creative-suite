# N1/N2/N3 交付报告：语义分镜之后的三项任务

分支 `claude/video-next-n123`（基线 main@17e17e7），2026-10-27。
交接单：`artifacts/handoffs/claude-video-studio-next-after-semantic-2026-10-27.md`。

## N1｜有声语义样片 —— 链路健康，零代码修复

四态：代码实现=无需改动（既有 TTS/字幕/渲染链可直接服务语义项目）；自动回归=无新增；真实浏览器=通过；视听质量=音轨/字幕/对齐证据齐。

- `scripts/video/e2e-semantic-narrated.mjs`：语义生成→确认卡→应用→保存→「生成有声横竖版 MP4」→ 双下载。断言：双画幅 aac+h264+尺寸；render-manifest 逐镜 narration（versionId 归属=不串镜、durationMs ≤ 镜长+200ms）；subtitleCues 每镜 cue>0；renderRecords=镜×2；确认卡旁白↔落库逐镜一致；逐镜中点字幕帧留档。
- 证据：`artifacts/video-studio-semantic-narrated/`（双 MP4+report.json+confirm-card/narrated-ready 截图+6 张字幕帧）。样片 6 镜，旁白如「蒸发→凝结→降水→回归」。
- 未验证部分：无（本轮真实 TTS 成功；若密钥失效链路会如实报错，N1 未模拟该失败面——路由测试层有 503 分类覆盖）。

## N2｜单镜自然语言修改（本批主要功能）

四态：代码实现=完成；自动回归=359→372 全绿；真实浏览器=全链通过；视听质量=修改前后画面证据+有声出片取新版本实证。

### 实现
- `semantic-storyboard.ts` 抽出 `validateSemanticShot`/`compileSemanticShot`（与整片同源：严格键集合/旁白预算/确定性延长/renderHint）。
- Provider `plan/revise` 共用传输层；REVISE 提示词（r2）：只产一个镜头 IR、不重规划整片、不虚构、素材边界同口径。
- `/api/video/semantic-revise`：上下文（本镜/相邻镜/整片，防注入截断）+指令 → IR 校验 → 一次带因重试 → 确定性编译候选；needs-assets 前置拦截；usage 合计+分项。路由测试 5 用例（假 fetch）。
- UI：每镜「AI 修改此镜头」入口 + 候选预览（画面类型/屏幕文字/旁白/时长/**整片影响**/引擎版本）；确认走既有 `addCandidateVersion`（锁定拒绝 ShotLockedError、只追加、parentVersionId 留链）；`baseVersionId` 版本冲突闸；失败/放弃零项目改动；旧固定句式重做入口原样保留。

### 验收对照（`artifacts/video-studio-semantic-revise/`）
- 只修改「凝结」镜：前后镜 workingVersionId 与内容版本数不变；目标镜 +1 版本、parentVersionId=旧工作版本、engineId=`planner-semantic-revise`、旁白更新（「水汽遇冷，聚成云」）。
- 回滚恢复（UI 选择器→回滚到此版本→导出核对工作版本还原）。
- 保存重开：重开后新版本说明可见。
- 有声出片取新工作版本：render-manifest 该镜 narration.versionId=新工作版本。
- 失败面：锁定拒绝（e2e 实测）、版本冲突（候选后固定句式重做→确认被拒，e2e 实测）、素材诉求 needs-assets（路由测试）、超长指令 400（路由测试）、IR 非法带因重试（路由测试）。
- 画面证据：before-preview.png / candidate-preview.png / after-card.png。
- 真实调用：e2e 含 ~5 次真实千问调用（含探测轮）。

## N3｜前后对比与阶段时间线入语义 IR

四态：代码实现=完成；自动回归=372 全绿（含 N3 专项 9 用例）；真实浏览器=双创意通过；视听质量=LAYOUT OK+数值闸实战。

### 实现
- IR 新增 `compare-explainer`（compare-split@2 全字段，契约长度对齐）与 `timeline-explainer`（milestones 2..6，date 无日期用顺序词，status 可省默认 done）。编译器固定配色/入场/版本@2；时长下限按组件时序（compare 2500、timeline 2900+300×(n-1)）。
- **数值/日期防伪造闸** `verifySourcedNumbers`：compare 数值与 timeline date 的每个数字必须 =原话出现 ∨ 两原话数字之差（可核算术推导，如 40-15=25）；否则带因重试一次、仍编造 422 拒绝。plan/revise 两路由都接闸；提示词 v5/r2 写明数据纪律。
- renderHint 预告对比数值/阶段（确认卡明确屏幕内容）。

### 样片（`artifacts/video-studio-semantic-n3/`）
- `sleep-compare`：5 镜含 compare-split（数值 1/30/40/15 全来自原话，差值 25 为推导）；确认卡预告+数值闸审计（镜头内容不得出现原话外数字）。
- `seed-timeline`：3 镜含 timeline-milestones（播种→发芽→幼苗→开花，顺序词无日期）。
- 双画幅 MP4+逐镜抽帧（横竖）；check-layout（参数化入 N3 目录）：130 文本零出界零重叠。
- 旧四 intent 回归：364 全绿 + N1/N2 样片仍为 title/sketch/cycle/flow 组件。

### 已知限制
- 模型对含糊「阶段」表述可能选 flow 而非 timeline（N3 审计首轮实测）；明确「用时间线展示」后稳定。属模型选型倾向，未做句法强制。
- compare 的 delta 推导只支持两数之差（不解析单位/百分比换算）；更复杂推导按「没给就文字表述」处理。
- 有声链在 N3 样片未重复跑（N1 已证链路，组件渲染与旁白机制与 N1 相同）。

## 复跑命令

```bash
pnpm --filter @acs/web test                                     # 372/372
node scripts/video/e2e-semantic-narrated.mjs                    # N1（需 DASHSCOPE_API_KEY dev server）
node scripts/video/e2e-semantic-revise.mjs                      # N2（同上）
node scripts/video/audit-semantic-n3-live.mjs                   # N3（同上）
node artifacts/video-studio-semantic-n3/check-layout.mjs        # LAYOUT OK
```

## 复核修复轮（2026-10-27，CODEX_REVIEW_ROUND 结果 + 独立全分支评审）

Codex 四项（2 P1 + 2 P2）与独立评审增量全部闭合：

- **P1-1 字段形状校验**：compare/timeline 全字段（含嵌套条目/status/title 上限）进 `validateSemanticShot`——坏 milestones/缺失对比字段在校验层带路径拒绝并走既有带因重试，不再 500 或拖到编译期。（成因：N3 首轮 python 补丁锚文本不匹配静默未落盘，测试缺反例未拦——已补 8 个反例用例。）
- **P1-2 数值闸收紧**：覆盖**全部**上屏/朗读字段（title/旁白/notes/labels/条目）；**取消两数之差推导**（单位/可比量不可判定）；全角数字归一、汉字数值组合原样子集闸（「二十五」拒绝、原话有「三十」放行）；结构性序数豁免（第N步/X阶段）；revise 数据源=指令+影片上下文（影片自身数字可合法引用）。审计脚本同口径。
- **P2-1** body null/数组/原始值 → 400 不触网（revise 补齐，plan 基线已有）。
- **P2-2** 图解替代全链留痕：候选带 substitutedForAssets → 卡片「图解替代」行 → 确认落档 description 前缀【图解替代】+ provenance `/asset-substituted` 后缀（保存重开可见；浏览器实证）。
- **独立评审增量**：I-3 compare/timeline title ≤30（组件契约，提示词 v6/r3 同步）；I-4 aiReviseByShot 三处项目切换重置 + 整片影响实时按当前文档重算；M-1 措辞六种 intent；M-2 无 content-length 时正文 4KB 硬顶；M-5 授权按钮空指令禁用；M-6 clip 按码点切片；M-7 revise 数值闸路径测试；M-8 报告计数更正。提示词补 milestone status 说明（进度型题材按事实给状态）。
- **浏览器增量确认**（Codex 验收门槛）：新闸下对比镜头（慢跑 vs 久坐，数值 0/5/80/65 全来自原话）+ 单镜图解替代全链（needs-assets→授权→候选标记→落档 provenance/描述），`artifacts/video-studio-semantic-n3/review-fixes/`。
- 递延 Minor（下批）：N1 e2e 补 cue 文本=旁白断言；revise e2e 目标镜按旁白精确匹配而非首个含「凝结」卡。

## 给 Codex 的复核重点

1. `verifySourcedNumbers` 的「两数之差」推导口径（会不会过宽/过窄；单位混用如 1小时 vs 30分钟 的差是否该放行——当前纯数值比较，单位不参与）。
2. N2 版本冲突闸只在确认时校验 baseVersionId；生成期间镜头变化不影响候选预览（预览基于候选快照）——口径是否需要生成时也锁。
3. revise 路由的上下文由客户端组包（防注入截断 60/40/30 字符）——服务端信任边界的残余面。
4. compare/timeline 的编译配色/入场常量（深色底）与旧四 intent 风格一致性。
5. timeline status 默认 done：全部「已完成」语义对进度型题材是否需模型显式给状态。
