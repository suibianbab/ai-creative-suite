# Video Studio P2-⑥ Loading（加载画面组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` 续叠 · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第六项 **Loading**（加载/Loading 模板）。P2 六题材收口刀——完成后 P2 累计覆盖 11 个矢量子类中的 9 个。

## 问题

解说视频里「等待/进行中」是常见过场语言——三点等待、进度环爬升到百分比。既有组件（图表/地图/流程/火柴人/手绘）没有加载语义的画面。本刀给组件注册表追加两个加载组件并接入工作台起点模板，不破坏既有纪律：

- 注册表只追加（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含加载组件的项目重渲 = 已档哈希——本刀起以 P2-⑤ sketch e2e 媒体哈希为新金标准）；
- 规划器输出稳定（加载画面进视频的唯一路径 = 工作台模板选择，planner 零改动）。

与前五族的语义差异：**加载画面是循环/保持动画**（dots 无限循环、progress 爬升后保持），不是一次播完的入场动画。两者仍是 tMs 的纯函数（`phase = (tMs/cycleMs + i/N) % 1`、`p = clamp01(tMs/progressMs)`）——帧确定性成立，任何帧都非空。

## 方案（闭式加载几何：相位弹跳 + 弧长爬升，零新依赖）

**裁定：加载感 = 两个小组件各自一个闭式机制，不做可配置动画曲线/真实异步数据绑定。** ① dots 相位弹跳：每个点在自己的相位窗内做正弦跳（`yOff(i) = −AMP·max(0, sin(2π·(tMs/cycleMs + i/N)))`，负半周贴地休息——相邻点错相轮跳）；② progress 弧长爬升：环弧 pathLength=1 dashoffset 描画（沿 line-drawing / map-journey / flow-diagram / sketch 先例口径）+ 中心百分比数字与弧同缓动（easeOutCubic）同步爬升、到目标保持。零随机/零墙钟。

两个新组件 v1（沿五族先例：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 首子元素、tMs=帧/fps×1000、validateParams 中文消息带定位、标题 (500,100) `fitFontSize(48, title, 880)` 300ms 淡入）：

- **loading-dots**（相位弹跳等待）：N=3..6 个实心圆点横排居中，`DOT_R=28`、`GAP=36`、`BASE_Y=520`（总宽 `W = N·56 + (N−1)·36`，点 i 圆心 `x = 500 − W/2 + 28 + i·92`）；跳起 `AMP=90`；点色 accentColor，不透明度随相位 `0.35 + 0.65·max(0, sin(2π·phase_i))`（休息 0.35、峰值 1）；状态文案 (500,700) `fitFontSize(36, label, 600)` inkColor 静态。
- **loading-progress**（弧长爬升进度环）：环心 (500,520)、`R=180`、`STROKE=22` 圆头；轨道整圆 inkColor 不透明度 0.12；进度弧 accentColor circle pathLength=1、`dashoffset = (1 − frac).toFixed(4)`、`transform rotate(-90, 500, 520)`（12 点起顺时针）；`e = easeOutCubic(clamp01(tMs/progressMs))`，弧占比 `frac = (targetPercent/100)·e`，中心百分比文本 (500,520) 字号 96 粗体 inkColor `${round(targetPercent·e)}%`，到 progressMs 后保持；状态文案 (500,780) `fitFontSize(36, label, 600)` inkColor 静态。

`defaultRegistry` v6→**v7**（一次 bump 追加两组件，旧 spec 渲染路径零改动；数组按组件 id 字母序插在 line-chart 与 map-grid 之间）。文本度量复用 `text-width.ts`（label 按码点计 1..12，astral 安全）。

### 数据模型（params，全部过 validateParams）

```ts
// loading-dots
{ title: string /* ≤40 */, label: string /* 1..12 码点 */,
  dots: number /* 3..6 整数 */, inkColor: string, accentColor: string,
  cycleMs: number /* 400..2000 整数 */ }

// loading-progress
{ title: string /* ≤40 */, label: string /* 1..12 码点 */,
  targetPercent: number /* 1..100 整数 */, inkColor: string, accentColor: string,
  progressMs: number /* 400..2000 整数 */ }
```

颜色 `#rrggbb`。组件内禁墙钟/未播种随机/网络。sin/easeOutCubic/clamp 输入是 tMs 的纯函数——同帧同值，帧确定性成立。

### 模板时序预算（P2-③ 34bda10 教训沿袭）

dots 循环无收笔概念——不变量改为 **cycleMs ≤ 1200**（任何帧都有点在动）；progress **progressMs ≤ 2000**（爬升在默认 2000ms 镜头内收于目标）。标题/状态文案自帧 0 可见（300ms 淡入），无空帧。此二不变量由 loading-templates 纯逻辑测试逐模板钉死。

### 工作台接线（新纯逻辑模块 `loading-templates.ts`，沿 chart/map/flow/stick/sketch-templates.ts 模式）

- **5 个起点模板**：`loading-dots-3`（三点等待，label 加载中，cycle 720）、`loading-dots-5`（五点序列，label 正在处理，cycle 960）、`loading-ring-full`（进度环·完成，target 100，progress 1600）、`loading-ring-72`（进度环·进行中，target 72，progress 1600）、`loading-ring-30`（进度环·起步，target 30，progress 1200）。色板沿五族 ink `#2f2f2f` / accent `#e05a2b`。
- `applyLoadingTemplate(spec, templateId)`：签名与语义同五族先例（换 componentId/version/params，保留 durationMs/background/seed，structuredClone，`validateSceneSpec` 兜底；未知 templateId 返回错误）。
- 数据编辑（标量参数，沿 chart-templates 的 counter 先例用输入框而非 textarea）：`LoadingEditDraft { title, label, count, target }`；`draftLoadingFromSpec`（dots → count=String(dots)、target 空；progress → target=String(targetPercent)、count 空）；`buildLoadingRevisePatch`——label 1..12 码点、dots 组件 count 整数 3..6、progress 组件 target 整数 1..100，非法返回 `{spec:null,error}` 行内报错不落 patch（C1 语义）；合并保留 colors/cycleMs（或 progressMs）via params 展开。round-trip：draft 回读稳定。
- 编辑卡「组件模板」下拉 optgroup 追加「加载」组（图表 / 地图 / 流程 / 火柴人 / 手绘 / 加载），`resolveAnyTemplate` 六族解析；加载编辑字段（标题 maxLength 40 + 状态文案 maxLength 12 + 点数/目标百分比数字输入，按组件二选一渲染）仅当加载组件已落地时渲染；应用逻辑统一走合并语义（模板 spec 为基底 + 数据草稿 + 旁白/背景/时长一次应用一并落库，P2-① I1 语义）。
- **规划器零改动裁定**（沿 P2-①..⑤）：规划器不生成加载镜头。

## 需求（R）

- **R1 组件契约与注册表**：两组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v7 = v6 ∪ {loading-dots, loading-progress}；旧 spec 渲染结果不变。
- **R2 加载几何可推**：点的圆心/跳高/不透明度由 (i, N, tMs) 唯一决定；环弧占比与百分比数字由 (targetPercent, tMs) 唯一决定；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝；模板时序预算不变量（cycleMs ≤1200 / progressMs ≤2000）由模板测试钉死。
- **R4 工作台闭环**：模板下拉换组件（六组）+ 加载数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档；模板应用与并发草稿编辑合并落库（沿 P2-① I1 语义）。
- **R5 e2e（VID-022）**：浏览器建项 → 镜头换加载模板 + 数据编辑（含并发旁白）→ 保存导出结构断言 → CLI 双画幅出片：加载帧 YAVG 非全黑、双跑逐字节一致、**无加载基线（sketch e2e 项目）重渲 = P2-⑤ 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- 真实异步进度数据绑定（进度是演示性画面，targetPercent 是参数不是回调）。
- 动画曲线参数化（弹跳幅度/缓动函数为固定常量；按需另刀）。
- 骨架屏/位图占位（位图领域）。
- 更多加载形态（条形进度/旋转花瓣/骨架线框）——v1 两形态覆盖「等待」与「进度」两个语义位。
- 规划器句式路由生成加载镜头（见裁定）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| label 非空 1..12 码点 | `loading-dots params.label 必须是 1..12 个字符` / `loading-progress params.label 必须是 1..12 个字符` |
| dots 非 3..6 整数 | `loading-dots params.dots 必须是 3..6 的整数` |
| targetPercent 非 1..100 整数 | `loading-progress params.targetPercent 必须是 1..100 的整数` |
| cycleMs / progressMs 越 400..2000 | `… 必须是 400..2000 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| title 超 40 字符 | `… params.title 必须是 ≤40 个字符` |
| 工作台 label 为空/超长（1..12 码点） | `buildLoadingRevisePatch` 返回 `状态文案必须是 1..12 个字符`，不落 patch |
| 工作台 count 非整数或越 3..6 | `点数必须是 3..6 的整数`，不落 patch |
| 工作台 target 非整数或越 1..100 | `目标百分比必须是 1..100 的整数`，不落 patch |
| 非加载组件调用数据编辑 | `当前镜头组件不是加载组件` |
| 未知 templateId | `applyLoadingTemplate` 返回 `未知加载模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：sketch e2e（VID-021）复跑 exit 0，媒体哈希 = P2-⑤ 已档 `0809f91f…`/`8ce96e22…` 逐字节一致（组件追加不改旧渲染）。
- **A2 加载几何与爬升**：单测断言点圆心横排公式、跳高与不透明度相位采样值、环 dashoffset/弧占比/百分比取整（边界 target=1/100、p=0/中途/1）、label 码点计数、round-trip（dots↔count、progress↔target）。
- **A3 帧确定性**：组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板（含并发旁白合并）→ 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-022 登记，qa 计数更新，CURRENT_STATE 顶部条目。
