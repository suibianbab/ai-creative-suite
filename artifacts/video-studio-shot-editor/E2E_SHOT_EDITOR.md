# P1 分镜编辑器端到端闭环验收记录（真实工作台链路，零 TTS 计费）

- 日期：2026-10-18
- 执行人：Claude（P1 分镜编辑器会话）
- 脚本：`scripts/video/e2e-shot-editor.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210，经剥头 TCP 代理 3211 访问，规避 Next16/Node22 HMR ws 握手 bug）· playwright-core headless Chromium · Remotion 4.0.534（系统 Chrome 155）

## 链路

浏览器（`/video-studio`）新建项目 → 「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划（speech-aware [2000,3100,2000,2000]ms）→ 分镜确认卡 → 确认应用（追加 4 镜头）→ 保存（v2）→ **导出基线 JSON**（原始 4 个版本 ID 落档）
→ **镜头 2 旁白修订**「水循环，要点 1。」→「水循环，三个要点。」（草稿态表单 → `buildRevisePatch` 校验 → `reviseWorkingVersion` 追加 v2 + submitted(human)）→ **预览字幕随之变化**（镜头 2 相位采样三帧：修订前含「要点 1」、修订后「要点 1」消失且「三个要点」出现——字幕是 narrationText 投影，单一事实源）
→ **镜头 1 画面修订**：背景 `#102030` + 时长 2s→3.5s（spec.background/spec.durationMs 与版本 durationMs 同步 3500）→ **时间线重量化** 218→254 帧（镜头 1 span 48→84 帧）
→ **镜头 3（basic-shapes 示意）换模板**（seed+1，params 从模板表重抽）
→ **锁定语义**：锁镜头 1 → 重做被拒（`.shot-redo-error` 含「解锁」）→ 解锁 → **镜头 4 重做成**（指令「做一个10秒的图形动画，标题是循环」→ `planFromSentence` + `addCandidateVersion`：submitted(ai)、basic-shapes 10s、**旁白从 working 版本继承**「谢谢观看。」、parentVersionId 链）
→ **锁定下人工修订**（ADR 0003 §1.3）：再锁镜头 1 → 旁白改「锁定下的人工修订。」→ 应用成功（v3 + submitted(human) + audit「人工修订（锁定镜头）」）
→ **镜头 2 回滚到 v1**（版本 select → 回滚按钮，working 指针回 v1，追加 audit 事件）
→ 保存 → **导出终版 JSON**（结构断言：版本数/事件序/历史版本字节不变/applications 不变）→ CLI `render-scene`（无 `--narration`，零计费）整片双画幅出片 + RenderRecord×8 回写（savedVersion +1）→ 截图 + 控制台零 error + `tts-usage.jsonl` 行数不变。

## 结果（退出码 0）

- 项目 ID `ce79c2e2-db8a-4115-af0d-d40525dc0773` 贯穿全程；基线 4 个版本 ID 全部保留在终版 contentVersions 里（逐镜头断言）。
- 版本演化：镜头 1 三版本（v2 画面修订 3500ms/#102030 → v3 锁定下旁白修订，时长继承 3500）；镜头 2 两版本（v1 原文「水循环，要点 1。」字节不变，v2「水循环，三个要点。」，工作指针回滚到 v1）；镜头 3 两版本（seed+1）；镜头 4 两版本（重做 submitted(ai)，旁白继承）。
- 事件序：submitted(human)/submitted(ai)/lock-changed/audit 全部按 ADR 0003 §1.3 落档；锁定镜头人工修订带 audit、锁定镜头机器重做被拒且 UI 指路解锁。
- 渲染冒烟：18.6s 整片（[3500,3100,2000,10000]ms）双画幅出片，RenderRecord 0→8，savedVersion v3→v4。
- 控制台门禁：全程零 error。
- 计费：零新增（本刀无 TTS 合成；`tts-usage.jsonl` 行数前后一致，累计仍 34 笔 ¥0.0370/¥50）。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`baseline.video-project.json`（编辑前基线，可与终版 diff 出全部编辑效果）、`e2e.video-project.json`（终版，版本/事件结构可比对）、`e2e-render/render-manifest.json`、`e2e-render/props-{landscape,portrait}.json`、脚本本身、QA 条目 VID-014。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18 首跑终值） |
| --- | --- |
| e2e.video-project.json | `4f51eb764d0a972df23eb14e14d214bcbf16e3e51419eae532ed0d72be026cc7` |
| baseline.video-project.json | 入库件（git 可 diff，无需哈希对照） |
| e2e-render/landscape.mp4 | `e7ceab1a96e0e4ab82f422c07fa43ea1d465764e92eb94b96d4d152709487d6e` |
| e2e-render/portrait.mp4 | `ad09a372a3a92ff883c1a4c98b27d9647d1c234a05556a1b585cb7945e490bff` |
| shot-editor-card.png | `2fec6322c22a139e56cb9b3a9ba799482e26ee103753a4f6c0a0bb520fcfac9e` |

复跑方式（需本地 dev server、TCP 代理、Playwright Chromium；每次复跑项目 ID 变，无 TTS 计费）：

```bash
PORT=3210 pnpm --filter @acs/web dev                # 终端 1
node scripts/dev/proxy-3211.mjs                      # 终端 2（剥头代理）
BASE_URL=http://127.0.0.1:3211 node scripts/video/e2e-shot-editor.mjs
```
