# STEM 多元素镜头验收报告（2026-10-23）

## 实证范围

浏览器从样片库新建水循环项目，在镜头 2/5 修改标题、图示偏移、入场时间和标注，保存、刷新重开并回滚镜头 2。`browser-report.json` 记录同项目 ID 与零控制台错误；`before/edited/reopened/rollback-check.video-project.json` 保留结构化产物。`before` 是本轮新样片的未编辑起点；`keyframes/before-*` 是上一版已交付样片的画面，用于视觉前后对照。

7 镜头叙述文字逐项与原样片相同；`reuse-stem-narration.mjs` 逐镜核对文字和时长才复制 7 条 WAV 及字级时间戳。镜头 2 在浏览器设为 4.01 秒，以匹配原配音。最终 `render/landscape.mp4` 与 `render/portrait.mp4` 为完整有声出片。

## 出片核验

本轮门禁：`video-scene` 173/173、`video-document` 156/156、`web` 272/272；全工作区 typecheck、Biome 420 文件、QA 注册表 94 自动/53 人工均通过。`VID-036`（含 12→6 点草稿反例）、`VID-038` 浏览器新链路、原 `VID-030` STEM 样片链路均通过。

`render-audit.json`：两画幅 H.264、24 fps，尺寸分别 1280×720 / 720×1280，AAC 音轨均存在；总长均 26.005 秒，7 条旁白、7 镜头字幕、14 条渲染记录。两画幅每帧干跑门禁均通过。`keyframes/after-*` 是最终 MP4 在镜头 2/5 抽帧，`keyframes/review-*` 为全片逐镜中段帧，`keyframes/contact-sheet.png` 汇总两画幅 14 帧。

旧项目兼容：将上一版已交付的水循环项目复制到 `.tools/stem-old-compat`，用本轮代码和原 Style Bible/旁白重新出片。横竖 MP4 与上一版文件 **SHA-256 分别完全相同**（见 `compatibility-audit.json`）；这是同机、同编码环境的逐字节验证，不泛化为跨环境保证。

## 人工审片（中段关键帧）

| 镜头 | 横版 | 竖版 | 结论 |
| --- | --- | --- | --- |
| 1 开场 | 标题与副标题清楚 | 标题居中，字幕独立 | 通过 |
| 2 四步总览 | 标题、水平流程、标注、字幕分层 | 纵向流程与标题/标注分开 | 通过；旧版竖版水平流程留白过大，本轮改善 |
| 3 蒸发 | 无裁切 | 无裁切 | 旧镜头文字偏小，需后续优化 |
| 4 凝结 | 无裁切 | 无裁切 | 旧镜头文字偏小，需后续优化 |
| 5 降水 | 云雨线描、双标注与字幕不重叠 | 图示与文字分层，无遮挡 | 通过；旧版仅线描无讲解标题/标注 |
| 6 汇流 | 流程可辨 | 流程居中 | 旧镜头节点与标题偏小 |
| 7 结尾 | 清楚 | 清楚 | 通过 |

审片仅覆盖各镜头中段及新增两镜头的动画末段，不能代表所有帧的美术品质。自动验证负责渲染、结构和音轨，视觉判断由上述抽帧人工完成。当前适合教学示意样片，整体未宣称商业级 Motion Graphics 成片。

## 复跑

```text
$env:STEM_EVIDENCE_DIR='artifacts/video-studio-multielement-2026-10-23'; node scripts/video/e2e-multielement-stem.mjs   # PowerShell, web :3210
node scripts/video/reuse-stem-narration.mjs
node scripts/video/render-scene.mjs --project artifacts/video-studio-multielement-2026-10-23/edited.video-project.json --style-bible artifacts/video-studio-multielement-2026-10-23/stem.style-bible.json --narration artifacts/video-studio-multielement-2026-10-23/narration --out artifacts/video-studio-multielement-2026-10-23/render
node scripts/video/audit-multielement-stem.mjs
```

默认浏览器 QA 输出在 `.tools/video-multielement-stem-e2e`，不会触碰本报告留存的有声出片。显式设置 `STEM_EVIDENCE_DIR` 重建本目录时，E2E 会重写项目 ID，随后需重跑旁白映射和出片。`render-scene` 将渲染记录追加回项目 JSON。
