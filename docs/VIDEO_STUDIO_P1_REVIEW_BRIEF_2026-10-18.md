# Video Studio P1 复核简报——范围定义、方案与交付（2026-10-18）

> 给外部复核者（Codex）。本文先把「P1」钉死（流通中至少有三个不同含义），再给方案与交付事实、验证状态、已知边界与复核路径。复核对象是代码与可复跑的验证，不是本文的转述；本文负责让范围不跑偏。

## 0. 「P1」消歧——本文与分支的用法

| 流通中的说法 | 实际是什么 | 状态 |
| --- | --- | --- |
| 路线图 P1 | `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P1 行「HTML Video 完整链路」：多场景编排、TTS 旁白 Provider、字幕轨、分镜编辑器（逐镜头调画面/旁白/字幕）、GIF/单场景 SVG 导出 | **里程碑，未全部完成** |
| P0 评审条目 P1-A~E / P2-A~C / P3 | 2026-10-17 P0 代码评审的**条目编号**，与 P1 里程碑无关 | 已在基线 63c3ed2 整改完毕（Codex 10-18 复核确认） |
| 本次交付 | P1 里程碑的**第一刀**（多镜头编排）+ 决策点 D2 的**第一刀**（TTS 旁白） | 本分支 63c3ed2 之后的新增代码 |

**P1 里程碑完成度**（对照路线图 P1 行）：多场景编排 ✅（第一刀）、TTS 旁白 ✅（D2 第一刀）、字幕轨 ❌ 未做、分镜编辑器逐镜头调整 ❌ 未做、GIF/单场景 SVG 导出 ❌ 未做、转场 ❌ 未做。复核请以「第一刀」的实际范围为限，不要以里程碑全量为验收标准。

## 1. 基线与提交切割

分支 `worktree-video-studio-p1`（基线 `63c3ed2` = P0 评审整改收口，已由 Codex 复核确认），三段：

| 段 | 提交 | 内容 |
| --- | --- | --- |
| **P1 第一刀**（复核主对象） | `676a445..ed598bb`，8 提交 | 多镜头编排全链路 + 终评 Important×2 修复 |
| D2 第一刀（如复核范围含） | `954cf04..a51dc7f` + `99b97a5`，8 提交 | TTS 旁白全链路 + 终评 Important×3 / minor×7 修复 |
| P0 复核反馈整改 | `0e95bef`、`6c98eca` | Codex 10-18 上午两条反馈（e2e 水合就绪、locked 审计不变量） |
| **P1/D2 复核反馈整改** | `05b532f`、`cf07a37` | Codex 10-18 下午两条反馈（锁定审计末条裁定、分镜追加语义），见 §7 |
| 同上第三轮 | `1bfe025` | Codex 对 `991e830` 的复核反馈：brief.applications 导入格式校验 + 只追加校验（见 §6） |

## 2. P1 第一刀：方案

**Goal**（计划原文，`docs/superpowers/plans/2026-10-18-video-studio-p1-multishot.md`）：一句话 STEM 需求 → 多镜头分镜（规则规划器）→ 工作台时间线/整片预览 → 单文件整片双画幅 MP4 出片（累计边界量化拼接），并补上 P2-A 遗留的逐帧干跑超时。

**Architecture**：复用 P0 的声明式 SceneSpec 组件与量化器。多镜头 = 每镜头一个 spec + 全局帧→(镜头, 本地帧) 映射。渲染端新增 Timeline 合成（Remotion），工作台新增 TimelinePreview（rAF），两边共用 `@acs/video-document` 的 `quantizeTimeline` / 新增 `mapGlobalFrame`。出片 CLI 从单镜头泛化为整片渲染，RenderRecord 按（画幅 × 镜头内容版本）追加。**单镜头是 N=1 特例，不是两条代码路径**（P0 冒烟项目经 Timeline 重渲染逐像素一致，已实证）。

**Spec/依据**：`docs/adr/0003-video-studio-shot-schema.md`（§2 执行边界、§3.5 量化、§3.1 只追加）；alignment review P1 行。

### 任务 → 提交 → 测试

| # | 任务 | 提交 | 关键文件 |
| --- | --- | --- | --- |
| 1 | `mapGlobalFrame` 纯映射（全局帧→镜头本地帧，边界/超尾钳制） | `676a445` | `packages/video-document/src/quantize.ts` |
| 2 | STEM 一句话分镜规划器（`做一个N秒…分M个镜头` 句式 → 3..8 镜头，量化预检拒绝零帧组合） | `b1707c0` | `apps/web/src/app/video-studio/apply-plan.ts` |
| 3 | `applyStoryboard` 只追加应用（旧 shots 逐字段不动，走 `assertAppendOnlyEvolution`） | `ad1f145` | `apply-plan.ts`、`packages/video-document/src/operations.ts` |
| 4 | remotion-engine `TimelineScene` 合成（spans 连续无缝校验、帧归属查找） | `5113f49` | `packages/remotion-engine/src/`（Timeline 组件） |
| 5 | 工作台镜头时间线（时间条 + 镜头卡）与整片预览（`TimelinePreview` 共用 `renderSpecLayer`/`SpecCanvas`） | `36ca396` | `apps/web/src/app/video-studio/page.tsx` 及配套组件 |
| 6 | CLI 整片单文件双画幅出片 + 逐帧干跑门禁（worker 隔离、单帧预算、超时可击杀）——P2-A 运行时侧补齐，登记 VID-008 | `cc88539` | `scripts/video/render-scene.mjs`、`frame-dryrun.mjs` |
| 7 | 多镜头 E2E 闭环 + 证据 + 文档，登记 VID-009 | `7e8c029` | `scripts/video/e2e-multishot.mjs`、`artifacts/video-studio-multishot/E2E_MULTISHOT.md` |
| — | 终评 Important×2 修复：整片预览 24fps 对齐（旧 30fps/ceil 重算慢 20%）；`shotWorkingSpec` 导入非法 spec 降级不炸页 | `ed598bb` | `page.tsx`、`SpecCanvas`/`TimelinePreview` |

### 设计裁决（复核时值得对照代码验证的点）

- **量化**：24fps 半进位累计边界；总时长取整余数由末镜头吸收，断言 Σ durationMs = 需求总时长；零帧镜头在**规划期**预检拒绝（人话报错），不到渲染期。
- **只追加**：分镜应用只追加镜头与内容版本；locked 终态由本帧追加段**最后一条** `lock-changed` 事件裁定（`6c98eca` 引入审计不变量，`05b532f` 补末条裁定——追加段任意位置出现过同值事件不再足够，末条与终态矛盾即拒绝）。
- **渲染前门禁**：全镜头 spec 经 `validateSceneSpec` 校验（未注册组件/时长不一致在出片前失败）+ 逐帧干跑（worker 隔离，单帧预算默认 500ms，`--skip-dryrun` 可跳）。
- **预览/出片同源**：同一 `quantizeTimeline` 帧图；预览侧 24fps + 量化 span 帧数（终评修复后与出片一致）。

### Review Focus（计划原列五类——本刀测试没覆盖、最容易咬人的输入，请逐类检查）

1. 秒数小/镜头多的组合在某 fps 量化出零帧 → 规划器先量化预检再给结果（如「1秒分8镜头」拒绝并说原因）。
2. 总时长分配取整后各镜头 durationMs 之和 ≠ 需求总时长 → 末镜头吸收余数，断言 Σ=总时长。
3. 全局帧落在边界帧（startFrame 恰等于某镜头起点）与超尾帧（frame ≥ totalFrames）→ `mapGlobalFrame` 钳制/归属正确。
4. 对已有镜头的项目应用分镜 → 只追加不重写；旧 shots 逐字段原样。
5. 多镜头 props 混入非法 spec（未注册组件/时长不一致）→ Timeline 合成与 CLI 都在渲染前校验失败，不产半截 MP4。

## 3. D2 第一刀：方案（如复核范围包含）

链路：分镜规划器逐镜头落档 `narrationText`（如实朗读，不虚构讲解词）→ `applyStoryboard` 落 ContentVersion → 工作台镜头卡显示 → CLI `tts-narration.mjs`（DashScope CosyVoice SSE 流式 + 字级时间戳；密钥只走 env；预算闸累计 ≤¥50，逐笔记本地 `artifacts/tts-usage.jsonl`；tmp+rename 原子写）→ `render-scene --narration` 整片装配音轨 → 双画幅 aac 出片（独立 ffprobe fail-loud）→ e2e（VID-011）。

关键裁决（探针实证，固化在代码注释）：Remotion CLI 渲染 `<Audio>` 只认 http(s)——绝对路径拒收、data URI 静默无声、`--public-dir` 404、同进程 http 服务被 spawnSync 冻住 → 唯一可行 = 独立进程 `narration-server.mjs`（白名单+CORS+PNA，畸形请求回 400 不崩）+ props 注 http URL + `--disable-web-security`；`probe()` 的 `-select_streams v:0` 结构性看不到音频流，音轨必须单独探。计划：`docs/superpowers/plans/2026-10-18-video-studio-d2-tts-narration.md`。

## 4. 验证状态（HEAD = `6c98eca` 实测）

| 门禁 | 结果（HEAD = `1bfe025`） |
| --- | --- |
| video-document 单测（含 locked 审计 +5、末条裁定 +3、applications 契约 +6） | 47/47 |
| video-scene 单测（含 determinism-gate 巡检） | 33/33 |
| web 单测（apply-plan/planner，含追加语义 +5） | 45/45 |
| scripts 单测（TTS 解析/装配/干跑等，零网络） | 25/25 |
| typecheck / biome | 全过 / 238 files clean |
| qa:validate | 76 automated / 46 manual 登记完整 |
| qa:video-determinism | 72/72 帧解码像素一致 |
| e2e 三链路 | closed-loop ✅ / multishot ✅ / narrated ✅（10-18 三轮复核整改后全部复跑通过；multishot MP4 跨运行逐字节一致累计第 6 次实证（第三轮 +2）、narrated 第 3 次，narrated 四条 wav 内容哈希跨运行全同） |

证据文档：`artifacts/video-studio-multishot/E2E_MULTISHOT.md`、`artifacts/video-studio-narrated/E2E_NARRATED.md`、`artifacts/video-studio-e2e/E2E_CLOSED_LOOP.md`。媒体不入库（gitignore 约定），视听结论为本机复核 + SHA-256 锚定；跨运行 MP4 字节一致已多次实证（UUID 不进渲染路径）。**复核者与本仓库同机**：上表各证据目录下的媒体本体（MP4/PNG/WAV）与计费台账 `artifacts/tts-usage.jsonl` 都可直接从文件系统打开查验，SHA-256 可用 `certutil -hashfile <文件> SHA256` 现场复算，不依赖 GitHub 传输。

### 复跑环境（Windows 工作站）

- pnpm 11.19.0（`packageManager` 钉死；经 fnm 的 shell——如 Git Bash——里直接 `pnpm` 可用；**PowerShell 直呼 pnpm 是 9.0.0，报 ERR_PNPM_BAD_PM_VERSION**）
- 单测：`pnpm --filter @acs/video-document build && pnpm --filter @acs/video-document test`（video-scene 的 `test` 自带 build）；web 侧必须在 `apps/web` 目录跑 `node --import tsx --test src/app/video-studio/*.test.ts`（tsx 是 web 依赖，仓库根下跑会 ERR_MODULE_NOT_FOUND）；脚本侧 `node --test scripts/video/`；`pnpm typecheck`、`pnpm lint`（biome）
- `pnpm --filter @acs/video-document build && pnpm --filter @acs/video-scene build`（CLI 引 dist）
- dev server：`PORT=3210 pnpm --filter @acs/web dev`
- e2e：`node scripts/video/e2e-closed-loop.mjs`（等 `html[data-studio-ready]` 水合标记后再交互——10-18 修复）
- 出片依赖：系统 Chrome（`C:/Program Files/Google/Chrome/Application/chrome.exe`）、ffprobe/ffmpeg 在 PATH

## 5. 已知边界与延后项（如实声明，未修）

**P1 终评延后 minor（13 条，台账恢复，均未修，等用户裁决；原 14 条中的「规划后改句子再应用写过期 sentence」已随 `cf07a37` 追加语义整改顺带修复——句子现快照进 StoryboardResult）**：

1. `render-scene --budget-ms` 对 NaN/0/负数可给更友好的用法错误（当前 fail-fast 可接受）
2. Remotion 渲染中途失败会在 outDir 留截断 MP4——可改临时名 + ffprobe 过核后改名
3. `TimelineScene` 连续性检查从 index 1 起——`shots[0].startFrame!==0` 漏报为模糊的帧归属错；可补 `frames<=0` 拒绝与「前镜头末帧」（exclusive end）措辞
4. e2e `fail()` 路径泄漏 headless Chromium（缺 `await browser.close()`）；`render-scene` spawnSync 默认 1MB maxBuffer 可能 ENOBUFS
5. manifest 换 `frameMap` 后移除了顶层 versionId/specDigest/componentId——仓内无消费者，外部工具若读过需注明
6. `next-env.d.ts` 提交过 dev 模式路径变动
7. `page.tsx` `openVideoProject` 无 try/catch——IndexedDB 失败时按钮失效
8. pnpm-lock 有无关 sharp/detect-libc 可选标记重排（历史一次性）
9. `render-scene` 缺 `--overwrite`——重复出片到同目录报错
10. 宽拉丁字符可击穿 0.6em 宽度钳制启发式（后续刀换测量式排版）
11. 已打开项目上再次「确认应用」静默替换编辑器（当时裁决接受，评审建议加确认提示）
12. 干跑只测 1280×720——portrait 特异异常过不了门禁；且超时击杀后续镜头帧不再干跑（VID-008 措辞应为「抛错继续、超时终止」）
13. review-focus #5 的 CLI 半边（未注册组件项目 exit≠0）目前靠单元 + 代码检查，无 CLI 集成测试

（另有个别条目原文在台账销毁后不可考，已略。）

**其他边界**：

- 单镜头预览仍 30fps（与整片 24fps 不一致）——`ed598bb` 时裁决「另行收口」，未做。
- D2 旁白溢出（wav 超 span）按 Remotion Sequence 截断出片，截断点听感未人工核验（e2e 有实录：2640ms/2000ms 告警 + 正常出片）。
- 计费台账 `artifacts/tts-usage.jsonl` 是本地文件（gitignore 挡），预算闸跨会话以它为准；至 10-18 累计 18 笔 ¥0.0222 / ¥50。
- P1 里程碑未做部分见 §0 完成度表。

## 6. 2026-10-18 复核反馈整改记录（三轮）

复核结论原话：「P1/D2 第一刀技术验收通过，锁定审计与追加时长语义待修；有声成片质量待收口。字幕、逐镜头编辑、转场及 GIF/SVG 导出属于后续完整 P1 工作，不计入本次缺陷。」两条待修项已整改：

| # | 反馈 | 整改 | 提交 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 锁定审计仍有洞：旧校验只查追加段**存在过**与终态同值的 lock-changed（`some()`），「追加锁 true、再解 false、终态 true」被接受，末条审计事件与终态矛盾 | **末条裁定**：locked 变化 ⇒ 追加段必须有 lock-changed；追加段存在 lock-changed ⇒ 末条值必须等于最终 locked（无翻转但末条矛盾同样拒绝） | `05b532f` | +3 测试（构造矛盾轨迹拒绝 / 合法同帧两次 setLocked 通过 / 无翻转矛盾拒绝），video-document 38/38 |
| 2 | 追加分镜时需求时长与整片时长不一致：brief.sentence 无条件覆写为新输入（8s 项目再应用 8s 分镜 → 成片 16s、需求仍 8s）；且句子取调用方当下输入，规划后改句会写过期句 | **追加语义**：`planStoryboard` 快照句子进 `StoryboardResult`（apply 不再收当下输入）；`brief.applications` 逐次记录应用快照（`BriefApplication`：appended* 记本次要的，film*After 记应用后整片的，可与 shots 对账）；确认卡 `describeStoryboardAppend` 算术预告行；notice 分首镜头/追加两种措辞 | `cf07a37` | +5 测试（快照句、首条对账、追加对账 8s+30s→38s、两次应用、确认卡算术），web 45/45 |
| 3 | `991e830` 复核（2026-10-18 第三轮）：① locked 审计与分镜追加用户可见行为均通过；② 但 `brief.applications` 尚未形成可靠数据契约——[validate] 不查该字段（实测设为普通对象可过导入校验，再应用分镜报 `is not iterable`）；③ [evolve] 允许下一版本删除已保存的 applications，与「逐次记录应用快照」承诺不符 | **数据契约补全**：validate 增 applications 格式校验（可省略；存在时必须数组，逐条查 sentence/appended*/film*After/appliedAt 形状及 film*After ≥ appended* 交叉约束——导入时挡住，不等运行时炸）；evolve 增只追加校验（previous 有记录时走 `requirePrefix`，删除/改写已保存条目拒绝） | `1bfe025` | +6 反例测试（非数组 / 字段错型 / appliedAt 非 ISO / 删条目 / 整体抹掉 / 旧条目改写，均先 RED 后 GREEN），video-document 47/47；e2e-multishot 复跑 ×2 全绿（apply→save→CLI 再保存→导入 全程过新校验，产物 `brief.applications` 落档实证） |

「有声成片质量待收口」（2.64s 旁白被 2s 镜头截断只告警）：接受该边界定性——在「有声解说成片」作为可交付功能前需调整镜头时长/语速/文案，已记录于 §5 其他边界，不计入第一刀缺陷。

第一、二轮整改后全量回归：四套单测 38/33/45/25、typecheck/Biome、qa:validate 76A/46M、三条 e2e 复跑全绿；multishot/narrated 的 MP4 与原证 SHA **逐字节一致**（第 4/3 次跨运行实证——两修复均不进渲染路径），narrated 四条 wav 内容哈希跨运行全同，计费累计 22 笔 ¥0.0259 / ¥50。

第三轮整改后全量回归：四套单测 **47/33/45/25**、typecheck/Biome 全过；e2e-multishot 复跑 ×2 全绿，MP4 与原证逐字节一致（跨运行一致实证累计至第 6 次——校验代码不进渲染路径）；产物 json 中 `brief.applications` 完整落档且 v2→v3 演进导入均过新校验。

## 7. 复核指引

**重点文件**：`packages/video-document/src/{quantize,evolve,operations,validate}.ts`；`packages/video-scene/src/`（注册表与门禁）；`packages/remotion-engine/src/`（TimelineScene 与 Audio 装配）；`apps/web/src/app/video-studio/{page.tsx,apply-plan.ts,video-studio.css}` 及预览组件；`scripts/video/{render-scene,frame-dryrun,tts-narration,tts-sse,narration-server,e2e-*}.mjs`。

**建议路径**：按 §2 Review Focus 五类逐类验证（每类都有对应单测可读，可独立改输入验证行为）→ 抽查 §5 延后清单里你认为会咬人的 → 独立复跑 §4 的任一门禁（命令已给）→ e2e 如复跑请用 `html[data-studio-ready]` 后的版本（当前 HEAD 已含）。

**已知环境事实**：worktree 路径 `D:/codex/animate/.claude/worktrees/video-studio-p0`（分支 `worktree-video-studio-p1`，与目录名不一致是历史原因）；`.tools/`、`.superpowers/`、`artifacts/**`（除 .md/.json）为忽略目录。
