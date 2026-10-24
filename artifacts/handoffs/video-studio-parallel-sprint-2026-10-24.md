# Video Studio 下一轮并行开发交接（2026-10-24）

## 共同目标与当前基线

以 `main@db41d5b` 为代码基线，完成一条**可从浏览器创建、编辑、保存并导出有声横竖版**的水循环 STEM 解说样片，同时明显改善该样片的图解层次与镜头节奏。已有的 7 镜头有声片、5 个样片入口、Style Bible、镜头版本、Remotion 渲染和项目数据契约继续复用。验收既看操作闭环，也看实际成片；不把自动测试通过写成商业级画质。

本轮优先解决一个已可出片题材的可用性与质量。Logo、自由拖拽时间线、Blender 写实广告、云端多租户渲染等另列后续工作，不挤进本轮。

## Claude：画面与模板线

**目标**：以现有水循环样片为输入，制作一条更有层次、适合 26 秒左右有声解说的可编辑 STEM 视频。保持科学描述准确；改变画面时说明每镜目的、可编辑字段和视觉限制。

**主要文件所有权**：`packages/video-scene/src/components/**`、`apps/web/src/app/video-studio/sample-gallery.ts` 及对应样片测试、自己的 `artifacts/video-studio-stem-visual-*/` 报告。可使用现有 `StyleBible`，不要新增第二套项目模型、任意脚本场景或直接修改 `page.tsx`、`apps/web/src/app/api/video/render/**`、`scripts/video/tts-*`。如需新增镜头组件，先说明为什么现有 `explainer-composition@1`、流程、线描、文字组件不足，再实现受控注册组件。

**交付门槛**：浏览器从样片创建 → 修改一处图示及文案 → 保存 → 刷新重开 → 回滚；横竖版各出完整 MP4。逐镜抽取早、中、晚帧，另对完整成片人工检查镜头节奏、图解可读性、字幕遮挡与音画衔接。保留修改前后关键帧、项目 JSON、产物、测试命令和不满意之处。重点改进既有审片记录指出的竖版留白、相邻镜头版式重复、图解说明过弱；没有解决的要明确留档。

## Codex：浏览器有声出片线

**目标**：把已验证的 TTS 字级时间戳、字幕烧录和双画幅渲染，从目前主要依赖 CLI 的流程接入现有工作台。用户能在本地开发工作台对有 `narrationText` 的项目选择生成有声版，并下载横竖 MP4；失败不留下成功渲染记录，密钥只在服务端环境变量，费用仍受现有台账上限约束。保留无声出片按钮和行为。

**主要文件所有权**：`apps/web/src/app/api/video/render/**`、`apps/web/src/app/video-studio/page.tsx` 中的出片操作及相关测试、必要的受控服务端调用封装，以及自己的 `artifacts/video-studio-narrated-workbench-*/` 报告。不要修改 `sample-gallery.ts`、`packages/video-scene/src/components/**`、Style Bible 或镜头数据 schema。若发现现有 TTS CLI 契约需要调整，先在交接报告写具体输入、输出和失败实例，再与 Claude 对齐。

**交付门槛**：有声与无声两条浏览器路径可区分；有声路径核对 WAV、字级时间戳、AAC 音轨、字幕、两画幅 MP4、项目渲染记录和下载哈希。密钥缺失、TTS 失败、旁白时长超界、渲染失败均给可理解的提示；这些失败不出现成功下载链接或成功渲染记录。真实计费验证使用既有预算纪律，并记录费用和次数。无密钥时只可标记自动测试通过，不可声称真实有声链路通过。

## 并行与互审规则

1. 两线从同一基线建立独立分支/工作树；主检出已有未提交文件，任何人都不清理、暂存或覆盖它们。各自只改所有权内文件。`qa/registry.json` 与 `CURRENT_STATE.md` 留给集成时一次更新，暂定 Codex 有声链路 QA ID `VID-047`、Claude 视觉链路 `VID-048`。
2. 两线可以同时开发；完成可复核增量后各自提交、留绝对路径交接单。Codex 审 Claude 的视觉、模板可编辑性、双画幅回归；Claude 审 Codex 的费用闸、密钥、失败原子性、音画对齐和浏览器操作。审核必须给文件/行、复现步骤和实际影响。
3. 阻断问题修复后只复核受影响增量；非阻断建议挂账。通过后集成到同一分支，运行相关单测、typecheck、Biome、QA 注册校验，以及**集成后的**浏览器有声 STEM 样片双画幅出片和人工审片。最后合入并推送 main。不能用各分支单独通过替代集成验收。
4. 四态报告分别写：代码实现、自动回归、真实浏览器及真实出片、视觉质量。后两项不通过时不宣称本轮完成。

## `/clear` 后的恢复入口

Codex CLI 的 `/clear` 会开始一个新聊天；`/compact` 则把当前聊天压缩成摘要、保留关键上下文。两者都不删除 Git 分支、工作树、文件和提交，但新聊天不能假设记得口头裁决，附着在旧聊天的 Goal 也应重新核对。每条线在提交前更新自己的交接单：基线和 HEAD、已完成、未完成、测试与产物、阻断项、下一条具体命令。清理上下文后，给新聊天本文件及两条线的最新交接单路径即可继续。不要在代码未提交、运行中命令未结束或关键裁决只存在聊天里时执行 `/clear`。

## 执行状态（2026-10-24）

- Codex 有声工作台线已在 `codex/video-narrated-workbench@7658abd` 提交；交叉审核单：`C:\Users\惠普\.codex\worktrees\video-portable-package\animate\artifacts\handoffs\codex-video-narrated-workbench-2026-10-24.md`。真实浏览器有声 7 镜头双画幅通过，旧无声样片回归通过；待 Claude 交叉审核与两线集成。
- Claude 视觉线通过本机 Claude Code 后台会话 `f24cbfb3` 启动，当前工作树 `D:\codex\animate\.claude\worktrees\stem-visual`。查看进度可用 `claude agents --json` 与 `claude logs f24cbfb3`；完成前不合并其代码。
- 最终收口责任在 Codex：处理交叉审核阻断项、集成两线、登记 QA、跑集成后的有声 STEM 浏览器与双画幅真实出片、人工审片，再合并推送 main。主检出其他未提交文件保留原状。
