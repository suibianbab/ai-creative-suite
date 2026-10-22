# Video Studio 双画幅预览与镜头级微调：真出片审计（2026-10-23）

## 结论

同一份浏览器编辑产出的四镜头项目（长标题文字镜头 + 12 点长标签折线图 + 柱图/数字镜头），以「无覆写（before）」与「竖版覆写（after）」两个变体各真实渲染横竖版 MP4：四条视频分辨率 1280×720 / 720×1280、24 fps、时长与量化总帧数一致，每变体追加 8 条渲染记录（4 镜头 × 2 画幅）。**安全区抽检与人工审片分别报告，如下两节，互不替代。**

## 一、安全区抽检（自动化，[safe-frame-report.json](safe-frame-report.json)）

每镜头 4 个时点 × 2 画幅 × 2 变体 = 64 帧解码像素核验（2 px 栅格容差）：

| 变体 | 抽检帧 | 安全区越界 |
| --- | --- | --- |
| before（无覆写） | 32 | 0 |
| after（竖版覆写） | 32 | 0 |

与 VID-034 的区别：本轮覆写改变的是**可读性**（标签取舍、标题换行），不改变内容 containment——两变体都必须零越界，上表证明覆写没有把内容推出安全区。

## 二、人工审片（关键帧 [keyframes/](keyframes/)，与上节口径分离）

- **竖版折线图，[覆写前](keyframes/before-portrait-line-chart.png)**：12 个轴标签全部渲染，`第10季度表…` 等长标签被既有 >6 字规则截断，相邻标签近乎相接——**能看清但拥挤，信息密度过高**。
- **竖版折线图，[覆写后](keyframes/after-portrait-line-chart.png)**：`labelStep=2`，末点优先显示，过近的第 11 点标签让位；六个可见标签（0/2/4/6/8/11 号）由用户逐项简写为 `Q1/Q3/Q5/Q7/Q9/Q12`。文字清晰且互不重叠；折线、圆标、描画动效与标题不受影响。原始 12 个完整标签仍保存在项目数据中；简写只是该画幅的展示决定。
- **横版折线图，[覆写前](keyframes/before-landscape-line-chart.png) / [覆写后](keyframes/after-landscape-line-chart.png)**：横版无覆写，两帧一致——12 个标签全显，间距充足。竖版覆写没有越界影响横版。
- **竖版长标题**（见 e2e 产物 `before-portrait.png` / `after-portrait.png`）：覆写前自动两行均衡换行可用；覆写后按用户指定的 `双画幅预览与镜头级微调` / `验收标题` 两行呈现，行宽明显收窄、断句符合语义。

人工结论：**这组经过逐项简写的样片**达到本轮可读性目标，横版画面零变化。仅设置 `labelStep` 而不简写长标签时，竖版仍可能出现极小字号；编辑时须检查预览并继续简写或减少可见标签。此结论不能外推到任意标签文案与点数。

## 三、证据链

- 项目来源：浏览器 e2e（VID-036）真实编辑并导出，`export.video-project.json`；变体派生见 `make-stress-project.mjs`（同 id 同镜头，仅 `spec.layout` 有无；`styleBibleRef` 两变体一致剥离——渲染机无浏览器侧 Style Bible 存储，色板已烘进 spec 参数，不影响前后对比口径）。
- 渲染：`node scripts/video/render-scene.mjs --project stress-{before,after}.video-project.json --out render-{before,after}`；干跑门按画幅各跑 216 帧（本轮新增能力），四条干跑全部通过后才进 Remotion。
- 审计：`node audit-exports.mjs --record` → [export-audit.json](export-audit.json)（ffprobe 尺寸/帧率/时长、SHA-256、全片解码、渲染记录计数、关键帧落盘）。
- 竖版覆写内容：镜头 1 `titleLines` 两行；镜头 2 `labelStep=2` + 六个可见点的 `shortLabels`——均为 `layout.portrait`，`layout.landscape` 不存在。

## 复跑

```bash
node artifacts/video-studio-dual-aspect-edit-2026-10-23/make-stress-project.mjs   # 由 export.video-project.json 派生变体
node scripts/video/render-scene.mjs --project artifacts/video-studio-dual-aspect-edit-2026-10-23/stress-before.video-project.json --out artifacts/video-studio-dual-aspect-edit-2026-10-23/render-before
node scripts/video/render-scene.mjs --project artifacts/video-studio-dual-aspect-edit-2026-10-23/stress-after.video-project.json --out artifacts/video-studio-dual-aspect-edit-2026-10-23/render-after
node artifacts/video-studio-dual-aspect-edit-2026-10-23/audit-exports.mjs --record
```

QA：VID-035（本审计，integration）与 VID-036（浏览器 e2e）已登记，`node scripts/qa/run-regression.mjs validate` 通过（91 automated / 53 manual）。

## 已知限制

- 覆写组件目前仅 `text-animation` 与 `line-chart`（brief 裁定先做真实压力案例）；bar-chart、number-counter 等组件带 `layout` 的 spec 会被 `validateSceneSpec` 明确拒绝，静默忽略不存在。
- `titleScale` 放大有安全宽钳制（最宽行不超安全文字宽），但竖版过大字号仍可能压缩副标题间距——超出 ±0.25 / 1.3 的排版需求需另做镜头设计。
- 标签可读性结论出自本组关键帧人工核验，不能外推到任意标签文案与数量；labelStep 语义固定为「间隔取样 + 末点恒显」，暂不支持任意子集选取。
