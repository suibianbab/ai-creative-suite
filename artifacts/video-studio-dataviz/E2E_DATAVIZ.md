# P2-① 数据可视化端到端验收记录（图表组件 + 模板编辑，零 TTS 计费）

- 日期：2026-10-18（终评修复后更新）
- 执行人：Claude（P2-① 数据可视化会话）
- 脚本：`scripts/video/e2e-dataviz.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · Remotion 4.0.534（系统 Chrome 155）· ffmpeg/ffprobe（winget 安装）· Playwright chromium

## 链路

浏览器新建（BASE_URL=http://127.0.0.1:3211）→ STEM 分镜「水循环 4 镜头」（[2000,3100,2000,2000]ms → 218 帧 @24fps）→ 保存
→ **镜头 2 换图表 + 旁白并发**：编辑卡先改旁白「降水随四季变化明显。」再 `.chart-template-select` 选「柱状对比（4 柱）」→ 单次应用（模板 + 旁白一并落库，图表编辑字段随之出现、草稿自动回填模板默认数据）→ `.chart-data-input` 改数据「春,12/夏,28/秋,21/冬,8」→ 应用 → 保存
→ **镜头 3 图表间换模板**：选「柱状对比（4 柱）」→ 应用（字段出现）→ 再选「折线趋势（8 点）」（字段保持可见、数据回填新模板默认值）→ 改数据「一,5/二,8/三,12」→ 单次应用 → 保存
→ **镜头 4 换图表**：选「数字滚动 KPI」（模板默认 value=250000，不改数据）→ 应用 → 保存
→ 导出 JSON 结构断言：镜头 2 `componentId="bar-chart"` 且 `bars` 逐项 = 春12/夏28/秋21/冬8 且工作版本旁白 =「降水随四季变化明显。」；镜头 3 `componentId="line-chart"` 且 points = 一5|二8|三12；镜头 4 `componentId="number-counter"` 且 `value=250000`；时长（3100ms）保留不被模板换掉
→ CLI `render-scene` 双画幅出片（无 `--narration`，零计费）
→ **图表帧数值断言（双画幅）**：ffmpeg signalstats YAVG ≥100——帧 80（镜头 2 域 48..121 内，末柱 ~99.9% 成形）；帧 140（镜头 3 域 122..169 内，折线描画后段 easeOutCubic(750/1600)≈0.83，白底深字）
→ **双跑**：导出件复制重渲 → 双画幅 SHA-256 逐字节一致；跨进程复跑（整轮 e2e 重执行）媒体哈希仍一致
→ 浏览器控制台零 error；`tts-usage.jsonl` 行数不变。

## 结果（退出码 0）

- 编辑落库：镜头2=bar-chart(春,12|夏,28|秋,21|冬,8)+旁白「降水随四季变化明显。」，镜头3=line-chart(一,5|二,8|三,12)，镜头4=number-counter(value=250000)；背景/时长保留（换模板合并草稿，不换掉未触碰字段）。
- **并发合并语义（终评 I1 修复后）**：换模板时同草稿的旁白/背景/时长编辑与图表数据编辑（选中模板即预填默认值）单次应用一并落库，不静默丢弃——修复前镜头 2 的旁白编辑会被模板应用丢弃（RED 实证 `narrationText=水循环，要点 1。`）。
- 图表帧非空（双画幅）：YAVG landscape 帧80=**224.054**、帧140=**233.989**；portrait 帧80=**224.053**、帧140=**233.989**（≥100 门限；白底深字构成）。
- 帧确定性（双跑 + 跨轮）：landscape `3c6950b90d61a803b867176c11afe1d9324a41e620296dc037696457bf7a5222`、portrait `36f64db7c1489a9ec82eecf626913953af3c00328223c9ca1f7248c0ceecc848`——同轮双跑与跨轮复跑均逐字节一致。
- 计费：零新增（本刀无 TTS；台账 34 行不变，累计 ¥0.0370/¥50）。
- YAVG 口径沿 VID-016（signalstats 有限范围，白 ≈235）。

## 终评修复（opus 全分支评审，0C/2I/9Minor）

- **I1** 模板应用分支静默丢弃并发表单编辑 → 应用逻辑改为「模板 spec 为基底 + `buildChartRevisePatch` + `buildRevisePatch` 合并」，本 e2e 新增两处合并断言（镜头 2 旁白并发、镜头 3 图表间换模板数据编辑）RED→GREEN。
- **I2** line-chart 测试同义反复断言 `!X || X` → 改为实断言 `assert.ok(texts.includes("第2年"))`；临时破坏标签渲染实证 RED（2 fail）→ 恢复 GREEN（58/58）。
- 9 项 Minor 记台账缓办（见 `.superpowers` 台账终评段；工作区删除后见 git 历史与本注记）。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、脚本本身、QA 条目 VID-017。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18 终评修复后） |
| --- | --- |
| render/landscape.mp4 | `3c6950b90d61a803b867176c11afe1d9324a41e620296dc037696457bf7a5222`（双跑/跨轮一致） |
| render/portrait.mp4 | `36f64db7c1489a9ec82eecf626913953af3c00328223c9ca1f7248c0ceecc848`（双跑/跨轮一致） |
| dataviz-editor.png | `be41c9ca0ddd0509e468b7cc86bcfb04ccc1b68eeb57c3744052c505eff90216`（截图非字节确定，仅供人工查看） |
| e2e.video-project.json | `2ad18aaa0d114716a3816f352e3d8550a532f64f613a9e86aa32cd26f91f546a`（含项目 UUID，每轮不同） |

复跑方式（需 :3210 dev + :3211 代理在跑；每次复跑项目/交付 ID 变，无 TTS 计费）：

```bash
BASE_URL=http://localhost:3211 node scripts/video/e2e-dataviz.mjs
```
