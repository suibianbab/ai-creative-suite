# Video Studio 字幕轨 + 旁白溢出收口 设计

日期：2026-10-18。路线图 P1 里程碑余量第一刀（`docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P1 行「字幕轨」），连带收口挂账边界「有声成片质量」（旁白溢出被 Remotion Sequence 静默截断只告警）。

## 目标与非目标

**目标**

1. 有声解说成片自带硬字幕（烧进 MP4，横竖双画幅），字幕文本 = 逐镜头 `narrationText`，时间对齐用 D2 已落档的字级时间戳（`*.words.json`）。
2. 旁白溢出不再默认静默截断：规划期按语速预估预防，合成期实测兜底对齐；截断变成 `--allow-truncate` 显式选择。
3. 字幕渲染确定性：同 cues + 同字体 → 同像素（进帧确定性门禁）。

**非目标（明确不做）**

- 卡拉 OK 逐字高亮（延后 polish；cue 粒度已是字级，升级路径在渲染层）。
- 字幕 ≠ 旁白的独立文案（翻译字幕、精简字幕）——分镜编辑器编辑 `narrationText`，字幕跟随。
- 软字幕/外挂 SRT 文件导出（后续导出刀再评估）。
- 无旁白镜头的字幕（字幕轨派生自旁白轨；无源则无字幕）。
- 语音变速再合成（计费 + 非确定；语速调整留给分镜编辑器的文案编辑）。

## 核心裁决

### R1 字幕是派生轨，不入文档 schema

字幕 = `narrationText` × words.json 字级时间戳的**投影**，不新增任何 VideoProject 字段。理由：validate/evolve 刚经历三轮 Codex 评审收口，不为可推导数据扩 schema；分镜编辑器（下一刀）编辑 `narrationText`，字幕自动跟随，单一事实源。

数据契约：`SubtitleCue { text: string; startMs: number; endMs: number }`（**镜头本地**时间，整数毫秒）。构建纯函数放 `@acs/video-document`（`subtitles.ts`，无新依赖）——web 预览与 CLI 导出共用同一实现；`@acs/remotion-engine` 只收 plain cue 数组做哑渲染，不解析 words.json。

### R2 cue 切分算法（`buildSubtitleCues`）

输入：`narrationText`、可选 `words`（`{ text, begin_time, end_time }[]` 展平自 sentences）、可选 `spanMs`。

- **有时间戳（导出路径）**：按停顿标点（`，。！？；、`）切句；句内按 ≤10 个 CJK 字符合并成 cue；cue `startMs`/`endMs` = 首/末字 `begin_time`/`end_time`（毫秒，音频本地时间 == 镜头本地时间，音轨从镜头起点播）。文本取原始字符（不用 word.text 拼接，防分词切口丢标点）。
- **无时间戳（浏览器预览、未合成）**：`spanMs` 内按字符数均匀分布（每字符等分，cue 间无空隙），`startMs`/`endMs` 取整。**近似对齐**，UI 标注「预览近似，出片按字级时间戳」。
- 空白旁白（trim 后空）→ 无 cue。
- 不变式：cues 时序单调不重叠；`endMs ≤ 音频实际时长`（有时间戳路径天然满足）。

### R3 渲染（TimelineScene 可选 props）

`TimelineShotProps` 增 `subtitles?: { cues: SubtitleCue[] }`。渲染：镜头 Sequence 内按本地时间 `t = (frame / fps) * 1000 - 0*` 查活跃 cue（`startMs ≤ t < endMs`），底部居中白字 + 细黑描边（`-webkit-text-stroke` 或 shadow），字号 = 画幅高度百分比（横竖各自标定，如 landscape 5.5%、portrait 4.5%），底部安全边距 = 高度 8%。缺 `subtitles` props → 渲染路径不执行字幕分支，**输出与现状逐字节一致**（与 D2 narration 同一条兼容纪律，帧确定性复跑验证）。

浏览器整片预览（TimelinePreview）加同构字幕层：同一 `buildSubtitleCues`（均匀分布近似），同一套样式参数按预览容器高度缩放。镜头卡 UI 不动。

### R4 旁白溢出收口（双管）

**规划期预防（planner）**：从现有 words.json 实测校准语速常数（`SPEECH_MS_PER_CHAR`，含首字延迟余量，取保守上界）；`splitShotDurations` 升级为 speech-aware——每镜头 `durationMs = max(等分时长, ceil(语音字符数 × 语速常数))`，总时长随之可能超过用户要的秒数（**用户总时长是目标值，容纳旁白优先**）。确认卡 `describeStoryboardAppend` 算术已按实际 totalMs 预告，透明。

**合成期兜底（tts-narration）**：全镜头合成完后，逐镜头比对 wav 实测时长 vs 该版本 `durationMs`；超出的镜头写「时长对齐」新 ContentVersion（同 narrationText、同 sceneSource spec 除 `durationMs` 外字段不变、provenance 记 `parentVersionId` + `engineId: "tts-align"`），`workingVersionId` 前移，资产文件（wav/words.json）rename 重键到新 versionId（tmp+rename 原子），保存文档版本 +1。日志逐镜头明示「2.0s → 2.7s（对齐旁白 2.64s）」。`--allow-truncate`：跳过对齐，保留旧告警截断行为（渲染仍会截，但那是显式选择）。

**渲染期防线（render-scene）**：装配时发现 overflow 且文档未对齐（无 --allow-truncate 传递）→ 默认 **fail 拒绝渲染**并提示先跑 tts-narration 对齐或加旗标。旧行为（告警+截断）只经 `--allow-truncate` 到达。

文档权威不变：时长对齐走 ContentVersion 演进（只追加），不直改旧版本；`assertAppendOnlyEvolution` 全程把门。

### R5 e2e 与 QA

- `e2e-narrated.mjs` 扩展：出片后（a）manifest 断言 `subtitleCues` 摘要存在（每镜头 cue 数 + 文本 SHA-256）；（b）抽 2 个已知 cue 时间点帧解码，底部字幕带（高度 8%~25% 区域）非背景像素占比超阈值（字幕确实烧进画面）。
- 帧确定性：带字幕整片两次出片，抽样帧解码像素一致（字幕是纯函数投影 + 固定字体）。
- 单测（零网络）：cue 切分（标点/合并上限/单调/空）、均匀近似分布、planner speech-aware 分配、tts 对齐纯函数层（溢出计算/新版本构造/无溢出不动）、render-scene 溢出默认拒绝。
- 既有 38+33+45+25 全绿为门禁；qa 登记 VID-012（字幕轨）/ VID-013（溢出收口）。

### R6 计费与安全

开发期单测零网络；e2e-narrated 复跑照常走 DashScope（~¥0.0037/次，累计台账 ≤¥50 闸不变）。无新密钥、无新外部服务。媒体证据继续 SHA-256 + 本机复核，不入库。

## 文件落点

| 文件 | 动作 |
| --- | --- |
| `packages/video-document/src/subtitles.ts` | 新建：`SubtitleCue` + `buildSubtitleCues`（纯函数） |
| `packages/video-document/src/subtitles.test.ts` | 新建：R2 全部分支 |
| `packages/remotion-engine/src/scene-spec-composition.tsx` | `TimelineShotProps.subtitles` + 字幕渲染分支 |
| `packages/remotion-engine/src/*.test.*` | props 缺省不变式 |
| `apps/web/src/app/video-studio/planner.ts` | speech-aware `splitShotDurations`（语速常数实测校准后钉死） |
| `apps/web/src/app/video-studio/planner.test.ts` | 语音感知分配用例 |
| `apps/web/src/app/video-studio/scene-preview.tsx` | `TimelinePreview` 预览字幕层（均匀近似） |
| `scripts/video/tts-narration.mjs` | 溢出对齐 + 资产重键 + `--allow-truncate` |
| `scripts/video/tts-align.test.mjs`（纯函数抽离层） | 对齐决策单测 |
| `scripts/video/render-scene.mjs` | cues 装配进 props + manifest 摘要 + 溢出默认拒绝 |
| `scripts/video/e2e-narrated.mjs` | R5 断言扩展 |
| QA 台账 / `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` | VID-012/013 登记 + 状态段落 |

## 风险与对策

- **语速常数估偏**（语音实际比预估长）：合成期兜底对齐兜住；常数每次 e2e 后可再校准。
- **字幕样式横竖画幅可读性**：字号/边距按高度百分比，e2e 抽帧人工核验一次；不满意调参数（纯渲染层，不动数据）。
- **预览近似 vs 导出精确的落差**：预览 UI 标注近似；差距只在 cue 边界几十毫秒级，不影响理解。
- **对齐产生新 versionId 导致资产重键竞态**：tts-narration 单进程顺序执行 + tmp+rename 原子写，无并发面。
