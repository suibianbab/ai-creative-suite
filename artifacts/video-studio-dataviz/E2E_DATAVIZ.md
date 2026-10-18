# P2-① 数据可视化端到端验收记录（图表组件 + 模板编辑，零 TTS 计费）

- 日期：2026-10-18
- 执行人：Claude（P2-① 数据可视化会话）
- 脚本：`scripts/video/e2e-dataviz.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · Remotion 4.0.534（系统 Chrome 155）· ffmpeg/ffprobe（winget 安装）· Playwright chromium

## 链路

浏览器新建（BASE_URL=http://127.0.0.1:3211）→ STEM 分镜「水循环 4 镜头」（[2000,3100,2000,2000]ms → 218 帧 @24fps）→ 保存
→ **镜头 2 换图表**：编辑卡 `.chart-template-select` 选「柱状对比（4 柱）」→ 应用落模板（图表编辑字段随之出现，草稿自动回填模板默认数据）→ `.chart-data-input` 改数据「春,12/夏,28/秋,21/冬,8」→ 应用 → 保存
→ **镜头 3 换图表**：选「数字滚动 KPI」（模板默认 value=250000，不改数据）→ 应用 → 保存
→ 导出 JSON 结构断言：镜头 2 `componentId="bar-chart"` 且 `bars` 逐项 = 春12/夏28/秋21/冬8；镜头 3 `componentId="number-counter"` 且 `value=250000`；旁白（narrationText string）与时长（3100ms）保留不被模板换掉
→ CLI `render-scene` 双画幅出片（无 `--narration`，零计费）
→ **图表帧数值断言（双画幅）**：ffmpeg signalstats YAVG ≥100——帧 80（镜头 2 域 48..121 内，镜头内 1333ms > enterMs 1200+梯次 270ms，柱已长成）；帧 140（镜头 3 域 122..169 内，镜头内 750ms，count-up 中段白底深字）
→ **双跑**：导出件复制重渲 → 双画幅 SHA-256 逐字节一致；跨进程复跑（整轮 e2e 重执行）哈希仍一致
→ 浏览器控制台零 error；`tts-usage.jsonl` 行数不变。

## 结果（退出码 0）

- 编辑落库：镜头2=bar-chart(春,12|夏,28|秋,21|冬,8)，镜头3=number-counter(value=250000)；旁白/背景/时长保留（换模板是纯 spec 修订）。
- 图表帧非空（双画幅）：YAVG landscape 帧80=**224.054**、帧140=**231.103**；portrait 帧80=**224.053**、帧140=**231.105**（≥100 门限；白底深字构成）。
- 帧确定性（双跑 + 跨轮）：landscape `4ac94b11df5089820fc0fa003b5fdda5fad7436cb2bbeb2cc632bb4ba088d67d`、portrait `8f2b26ad8dbf9bf5c1c6cf5c643623bc42a3a027b7a65e6300401370f8afed93`——同轮双跑与跨轮复跑均逐字节一致。
- 计费：零新增（本刀无 TTS；台账 34 行不变，累计 ¥0.0370/¥50）。
- YAVG 口径沿 VID-016（signalstats 有限范围，白 ≈235）。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、脚本本身、QA 条目 VID-017。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18） |
| --- | --- |
| render/landscape.mp4 | `4ac94b11df5089820fc0fa003b5fdda5fad7436cb2bbeb2cc632bb4ba088d67d`（双跑/跨轮一致） |
| render/portrait.mp4 | `8f2b26ad8dbf9bf5c1c6cf5c643623bc42a3a027b7a65e6300401370f8afed93`（双跑/跨轮一致） |
| dataviz-editor.png | `3d165a4ab62c81d7bf4f3eeb2a06a8c2c439a0fef85ecba5f260e6f6d2711017`（首轮） |
| e2e.video-project.json | 首轮 `503cd526e0a2b0269a0967ad0da1137241dbac1b738937f3c060b957a9c82371`（含项目 UUID，每轮不同） |

复跑方式（需 :3210 dev + :3211 代理在跑；每次复跑项目/交付 ID 变，无 TTS 计费）：

```bash
BASE_URL=http://localhost:3211 node scripts/video/e2e-dataviz.mjs
```
