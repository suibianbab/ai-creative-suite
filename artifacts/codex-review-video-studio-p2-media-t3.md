# Codex 复核交接 —— `worktree-video-studio-p2`（P2.5-T3：预览与镜头卡接线）

- 日期：2026-10-19
- 工作树：`D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`；**主检出 `D:\codex\animate` 由用户管理，勿动**）
- 范围：`cddf21e..7e6daee`（13 提交，26 文件：video-document operations ±35、web 媒体路由 variant、六个纯模块新建/扩展、TimelinePreview/page/镜头卡/media-panel/CSS、spec+plan 两篇）。`cddf21e` 为 T2 收口点（上次复核范围的后续基线）
- 纪律：工作树内只读复核；**不要 push / merge / 改 HEAD**（集成由用户决定）；本刀零 e2e、零计费（`artifacts/tts-usage.jsonl` 台账 34 行不变）；媒体不入库约定不变
- 回写约定：结论写 **`artifacts/codex-review-video-studio-p2-media-t3-result.md`**（勿覆盖本交接单）；格式沿 t1 版（Review Focus 逐项 / Rulings 判定 / Declined 逐条 / Issues C-I-M / Ready to merge + reasoning）

## 一、提交链（13 提交，spec → plan → 九任务 TDD → 格式对齐 → 终评修复）

| 提交 | 内容 |
|---|---|
| `ede26d0` | spec：§0 现状锚点 · §1 镜头卡两臂布局 · §2 规则表 U/P/M/X 四组 · §3 交互时序 · §4 兼容（六族零改动）· §5 测试清单 · §6 非目标（渲染/出片留 T4）· §7 验收 |
| `da1bd5d` | plan：9 任务全 TDD + Global Constraints + Review Focus 5 条 |
| `a501254` | Task 1 reviseWorkingVersion 第三通道 mediaClip（R1/R2：op 算 durationMs、spec/mediaClip 互斥、narration 独立） |
| `28f5b48` | Task 2 GET `?variant=proxy`（P5：缺省 original 不变；仓缺 proxy→original 回退 200+fallback 头） |
| `551f562` | Task 3 media-assets 纯逻辑（U 表：appendMediaAsset 幂等/异 sha 拒、mediaSrcUrl、assetLabel） |
| `d176786` | Task 4 提取 applySceneTemplate 六族共体（§1 裁定；X3 等价证明=六族套件零改动全绿） |
| `bad7b26` | Task 5 media-clip-templates（M 表 M1-M5：草稿回填/行内校验负路径/整帧+语速软预警） |
| `68e1793` | Task 6 media-preview 数学（mediaClipCss 双画幅裁切、mediaSeekTargetSec/shouldSeekVideo 80ms 节流） |
| `002423b` | Task 7 TimelinePreview 联合 item spec\|media\|missing（<video> 裁切渲染 + 素材缺失占位） |
| `c756d2b` | Task 8 素材面板 MediaPanel 上传入账本 + page 整片预览装配/降级文案（P1/U4/X1/X2） |
| `07c00dd` | biome 纯格式对齐 T3 前序 10 文件（零语义改动，终评前仓容） |
| `3722ba0` | Task 9 镜头卡媒体编辑臂 + 组件模板下拉第七族「媒体」（M6/§1） |
| `7e6daee` | **终评 F1 修复**：下拉升共享层 + mediaTemplateSelectValue（M6 默认停本族条目，RED→GREEN 12/12） |

## 二、核心判据（可挑战的不变量）

1. **mediaClip 通道语义**（`packages/video-document/src/operations.ts`）：`reviseWorkingVersion` 的 patch 三选一（narration/spec/mediaClip）——mediaClip 携带 `{mediaAssetId,inMs,outMs,fit,focalX,audio}`（**不带 durationMs**），op 内部置 `durationMs = outMs−inMs` 保 C4 不变量恒真（C4 在 T1 已是 validateContentVersion 的对账规则）；spec 与 mediaClip 互斥（同一 patch 不允许两者）；narration 单独修订时 media-clip 版本原样继承 sceneSource+durationMs。媒体镜头旁白可改（M 表 narrationText 总在 patch 里）。
2. **proxy 变体不破坏缺省**（route.ts）：GET 无参行为逐字节不变（original）；`?variant=proxy` 时 proxy 优先、仓缺 proxy→original 回退 200 + `X-ACS-Media-Fallback: original` 头——**预览永不断流**（T2 W2 分寸的预览侧镜像）。Range 语义沿用 T2（后缀段缓办在册）。
3. **M 表校验纪律**（media-clip-templates.ts）：素材不在账本**大声拒不静默换首条**（Review Focus #2）；入/出点 ASCII 整数 regex（全角/小数/负号/空/科学计数全拒）；出点须 `入+200 ≤ 出 ≤ 素材时长`（错误消息带当前值指路）；focal 0..100 整数（全角拒、前导零合法=50）；非法 `{patch:null,error}` 不清文档（沿 C1 软拒语义）；M4 非整帧（ms×fps 对 1000 取模，29.97 近似）与 M5 旁白语速溢出（speechAwareDurationMs 与 shot-edit 同一速度模型）为**软预警不阻塞**。
4. **cover 裁切数学**（media-preview.ts）：`scale = max(容器宽/源宽, 容器高/源高)`、焦点偏移按 focalX 居中**钳缘**（0 与 1 都不出画）；contain 同比 contain 居中零偏移（focal 无效但恒定不变量仍在——C6 先例）；同宽高比 cover 归一到无偏移（Review Focus #4）。seek 节流 80ms：`shouldSeekVideo(nowSec, lastSeekSec, targetSec)`——处理率近似视频时钟漂移，不追每帧。
5. **六族等价（X3）**：Task 4 提取 `applySceneTemplate` 共体（六族 apply 从各模板文件收敛到一处）在先、第七族接入在后；等价证明 = 六族套件（web 170 条中六族相关全量）零改动全绿 + chart/flow/map/stick/sketch/loading 六文件仅删重复不改语义（`d176786` diff 逐行可验）。**若挑战**：请 diff 六模板文件确认删的是纯重复。
6. **镜头卡两臂 + M6 恒可达（终评 F1 修复）**：组件模板下拉在**共享层**（旁白 textarea 后），媒体/spec 两臂只管各自字段——媒体镜头换回 spec 组件的唯一入口，误选可撤（选「— 保持当前组件 —」）；`mediaTemplateSelectValue(pendingTemplateId, mediaSourcePresent)`：工作版本已是 media-clip 且未选换装 → value 停 `MEDIA_TEMPLATE_ID`（受控 select 显示真实状态）。媒体编辑臂字段：素材 select（assetLabel，空账本「（项目尚无素材）」）/入点/出点/片段时长即时显示/fit/注视点/原声 + 软预警 role=status + 行内错误。spec 臂 `spec.`→`editSpec.` 门控（spec 镜头恒等，媒体镜头用 `mediaSubstrateSpec(durationMs)` 合成基底仅作 TS 收窄，**永不落库**）。
7. **预览装配与降级**（page.tsx）：逐镜头 spec→spec item、media→资产在账本? media item : missing 占位（id 前 8 位）、其他/缺时长→null；任一 null→整片预览降级文案「镜头含不可预览的场景源…」（不炸页）。上传两段式失败：行内「上传失败：reason」+ rethrow 到面板；成功 appendMediaAsset→saveVideoProject 素材即入账本。

## 三、可复跑验证命令（期望输出）

```bash
cd D:/codex/animate/.claude/worktrees/video-studio-p0

# 单测
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"   # 111 pass（+2 mediaClip 通道）
pnpm --filter @acs/web test                                                                              # 172 pass（170 + 2 M6 selectValue）
node --import tsx --test "apps/web/src/app/video-studio/media-clip-templates.test.ts"                    # 12 pass（M 表）
node --import tsx --test "apps/web/src/app/video-studio/media-preview.test.ts"                           # 7 pass
node --import tsx --test "apps/web/src/app/video-studio/media-assets.test.ts"                            # 5 pass
node --import tsx --test "apps/web/src/app/api/media/file/[storeKey]/route.test.ts"                      # 3 pass（含 variant 回退）

# 回归
pnpm --filter @acs/video-scene run build && node --test "packages/video-scene/dist/**/*.test.js"        # 131 pass
pnpm --filter @acs/media-store run build && node --test "packages/media-store/dist/**/*.test.js"        # 31 pass
node --test scripts/video/*.test.mjs                                                                     # 62 pass

# 静态（root build 受 pnpm 版本门拒时按 root 脚本逐包 --filter 等价执行）
pnpm --filter @acs/web run typecheck                                                                     # 零错
npx biome check .                                                                                        # clean（96 文件）

# 台账
wc -l artifacts/tts-usage.jsonl                                                                          # 34（本刀零计费）
```

无 e2e（VID-023 样片留给 T6）；手工冒烟（spec §6.2）留给用户：上传→换媒体镜头→入出点/fit/focal→保存重开回填→预览 cover 随 focalX 移动→删仓文件预览变占位。

## 四、给 Codex 的检查清单（按风险排序）

1. **F1 修复的正确性**（`7e6daee`）：下拉在共享层后，媒体臂 onChange 选六族模板是否正确走 `resolveAnyTemplate(editSpec, templateId)`（合成基底上换装）并预填该族草稿；spec 臂选「媒体」是否播种 `draftMediaFromVersion(working, mediaAssets)`；`mediaTemplateSelectValue` 是否覆盖全部状态组合（media 源+已选/未选、spec 源+已选/未选——测试 4 断言）。**受控 select value 与 option 不匹配时 React 行为**：media 源+pendingTemplateId="" 显示「媒体」条目，onChange 才会真正 setPendingTemplateId——用户看到的状态即工作版本真态，请判断是否有「显示媒体但应用仍走 spec 臂」的错位窗口（我方结论：无——editingMedia 与 selectValue 同源同判定）。
2. **C4 合谋复查**：有无任何 UI 路径产出 durationMs ≠ outMs−inMs 的 media-clip 版本（op 是唯一写入方、buildMediaRevisePatch 不带时长、镜头卡时长输入框在媒体臂隐藏——我方结论：无）。
3. **seek 节流与丢帧**：80ms 窗口内 focal/入出点变化的镜头切换是否可能停在旧素材旧帧（key 含 assetId+inMs，props 变即重挂载——我方结论：切镜头必重挂）；同镜头内 seek 目标跳变（预览循环往复）是否可能错过最后一帧（shouldSeekVideo 数学）。
4. **上传两段式失败的状态一致性**：appendMediaAsset 成功但 saveVideoProject 失败时，内存 editor 已含新资产而文档未存——刷新后账本回退，素材面板显示的资产消失但仓文件已写（孤儿 storeKey）。T2 已定「仓是事实源、账本是引用」，孤儿文件无害（下次上传同文件幂等复用）——请独立判断。
5. **六族等价抽查**：`d176786` 六模板文件 diff 是否纯删重复（applySceneTemplate 提取）；六族相关测试零改动全绿是否足以作等价证明（house style：组件不单测，镜头卡 878 行改动只能靠 typecheck+套件+手工冒烟——请评估残余风险）。
6. **终评缓办三项的定级**：F2 MediaStage `failed` 占位不随 assetId 复位（同 key 不重挂；播放头离镜自愈）、F3 assetLabel stock 后缀硬编码「本地上传」（T5 前死路径）、F4 uploadMedia 跨 await 陈旧闭包（与既有保存按钮同模式，函数式 setEditor 可解）——均为 Minor/Nit 缓办，请复核定级。

## 五、评审裁定摘要（欢迎挑战）

- **F1 选立即修而非缓办**：媒体→spec 换装在计划布局下是死路（下拉在 !editingMedia 分支内），spec M6/§1 明文要求入口恒可见恒可撤——计划 Task 9 与 spec 冲突，spec 是裁定权威；修复含纯函数化 M6 默认规则（mediaTemplateSelectValue）+ RED→GREEN，组件侧 JSX 重排靠 typecheck+全量套件（house style 组件不单测）。
- **spec→editSpec 重门控不算行为改动**：spec 镜头下 editSpec 与 spec 恒等（同一引用），门控仅为 TS 收窄媒体镜头的合成基底；六族字段渲染逻辑零变化。
- **mediaSubstrateSpec 合成基底永不落库**：仅作 editingMedia=false 时六族字段/换装的类型基底；应用时要么走媒体臂 patch、要么 resolveAnyTemplate 从 editSpec 出发——合成 spec 无落库路径。
- Declined 2 条由我方裁定入台账：U3 标签格式从 plan 钉测 `1920×1080 · 5.2s`（spec 行文 `WxH · s.s 秒` 是叙述）、M4 29.97fps 整帧预警保持近似（T4 钉取整语义后再改，避免双重返工）。
- 执行期 Ruling（ledger 已删，结论在 CURRENT_STATE）：editingMedia 须在 pendingTemplateId 声明后（TDZ）；biome 时点差致 10 文件格式对齐独立提交（07c00dd 零语义）；pnpm 版本门绕行（逐包 --filter 等价执行 root build 链）。

## 六、延后 Minor 台账（未修，不阻塞）

- F2 MediaStage `failed` 占位不随 item.assetId 复位（同 key 不重挂载；播放头离镜自愈）。
- F3 assetLabel stock 源后缀硬编码「本地上传」（T5 Wikimedia 接入前的死路径，届时一并清洗）。
- F4 uploadMedia 跨 await 对 editor/document 陈旧闭包（与既有保存按钮同模式；函数式 setEditor(prev=>…) 可解，留 T4 顺手）。
- P1/P2 期旧台账（T1 spec §5 两例断言缺失四条一行断言、T2 F5-F9、dataviz 9 条、themes 各刀若干）仍在册，无新增阻塞项。

## 七、关键文件索引

- spec/plan：`docs/superpowers/{specs,plans}/2026-10-19-video-studio-media-preview-edit*.md`
- 文档通道：`packages/video-document/src/operations.ts`（reviseWorkingVersion mediaClip）+ operations.test.ts
- 媒体路由：`apps/web/src/app/api/media/file/[storeKey]/route.ts`（variant=proxy）+ route.test.ts
- 纯逻辑：`apps/web/src/app/video-studio/{media-assets,apply-template,media-clip-templates,media-preview}.ts`（+ .test.ts 四件）
- 组件：`apps/web/src/app/video-studio/{shot-editor-card,timeline-preview→scene-preview,media-panel,page}.tsx` + video-studio.css
- 状态：`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部条目
- P2.5 总纲：`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md`（§4 T3 行、§7 裁定）
