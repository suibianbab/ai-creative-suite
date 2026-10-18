# Video Studio P2-⑤ 手绘（手绘强调组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` 续叠 · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第五项 **手绘**（手绘风格模板）。

## 问题

解说视频里「手写感强调」是最常用的强调语言——逐字写出一条要点、用手绘下划线/画圈把关键词圈出来。既有组件（图表/地图/流程/火柴人）都是几何规整风，没有手绘风格的强调画面。本刀给组件注册表追加一个手绘组件并接入工作台起点模板，不破坏既有纪律：

- 注册表只追加（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含手绘的项目重渲 = 已档哈希——本刀起以 P2-④ stick e2e 媒体哈希为新金标准）；
- 规划器输出稳定（手绘进画面的唯一路径 = 工作台模板选择，planner 零改动）。

## 方案（闭式手绘几何：正弦抖动 + 双描 + 逐字写入，零新依赖）

**裁定：手绘感 = 三个闭式机制的组合，不引入 rough.js/随机数/手写体字体。** ① 抖动（wobble）：直线/椭圆的采样点沿法向做小幅度正弦偏移——`jitter` 是点位置与条目序号的纯函数，无随机源；② 双描（double stroke）：每条强调笔画描两遍，第二遍相位差 π/2、幅度 0.75×、不透明度 0.8——经典手绘「描两遍」观感；③ 逐字写入（write-on）：文本按进度取前缀子串逐字出现，配合 pathLength=1 dash 描画（沿 line-drawing / map-journey / flow-diagram 已立口径）。三者都是 tMs 的纯函数——帧确定性成立。代价：v1 无真实手写体字形（用组件默认字体，逐字写入已给手写节奏）、抖动样式不可调（幅度/波长固定常量）。

一个新组件 v1（沿四族先例：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 首子元素、tMs=帧/fps×1000、validateParams 中文消息带定位）：

- **sketch-note**（手绘笔记强调）：标题 + 1..5 条文本条目，每条可带手绘强调笔画（下划线/圈/无）。条目纵向排布 `itemY(i) = 260 + i×130`（5 条时末条 780），文本居中 x=500、`fitFontSize(40, text, 700)` 自适应缩排；标题 (500,100) `fitFontSize(48, title, 880)`，300ms 淡入。
- 时序（条目 i，`delay(i) = 160 + i×staggerMs`）：文本逐字写入占 `[delay, delay+writeMs]`（`visible = min(len, ceil(clamp01((tMs−delay)/writeMs)·len))`，进度 >0 即至少 1 字）；强调笔画描画占 `[delay+writeMs, delay+writeMs+drawMs]`（`p = clamp01((tMs−delay−writeMs)/drawMs)`，pathLength=1 dasharray `${p} 1`；第二遍延迟 80ms 同速率）。
- **下划线**：条目文本盒下方 y=itemY+30、x 自 left−24 至 right+24，8 段折线；点 k 法向偏移 `3.2·sin(2π·(2·u + 0.35·i))`（u=k/8，i=条目序号）；第二遍 `2.4·sin(2π·(2·u + 0.35·i) + π/2)`。
- **圈**：绕文本椭圆 N=20 段，中心 = 文本中心、rx=文本宽/2+34、ry=44，起始角 −0.4 rad；点 k 径向偏移 `4·sin(3θ + 0.35·i)`；第二遍 `3·sin(3θ + 0.35·i + π/2)`。
- 强调笔画色 accentColor、宽 6（圈 5）、圆头 linecap；文本/标题色 inkColor。

`defaultRegistry` v5→**v6**（追加一组件，旧 spec 渲染路径零改动）。文本度量复用 `text-width.ts`。

### 数据模型（params，全部过 validateParams）

```ts
{ title: string /* ≤40 */,
  items: Array<{ text: string /* 1..12 */, emphasis: "下划线" | "圈" | "无" }>, /* 1..5 个 */
  inkColor: string, accentColor: string,
  writeMs: number /* 200..6000 整数 */, drawMs: number /* 200..6000 整数 */,
  staggerMs: number /* 120..1200 整数 */ }
```

颜色 `#rrggbb`。组件内禁墙钟/未播种随机/网络。sin/ceil/clamp 输入是 tMs 的纯函数——同帧同值，帧确定性成立。

### 模板时序预算（P2-③ 34bda10 教训固化）

规划器默认镜头 2000ms——**全部模板必须满足 `160 + (N−1)·staggerMs + writeMs + drawMs ≤ 2000`**（末条目强调笔画收笔在镜头内）。5 条模板用 staggerMs 200 / writeMs 400 / drawMs 360（末条收笔 1720ms）；≤3 条模板用 240 / 480 / 420。此不变量由 sketch-templates 纯逻辑测试钉死（逐模板断言）。

### 工作台接线（新纯逻辑模块 `sketch-templates.ts`，沿 chart/map/flow/stick-templates.ts 模式）

- **5 个起点模板**：`sketch-underline-3`（三要点逐条下划线）、`sketch-circle-key`（关键词画圈，圈+下划线各一）、`sketch-list-5`（五条手写清单，无强调）、`sketch-highlight-mix`（混排：下划线/圈/无）、`sketch-one-word`（单关键词大圈）。色板 ink `#2f2f2f` / accent `#e05a2b`。
- `applySketchTemplate(spec, templateId)`：签名与语义同四族先例（换 componentId/version/params，保留 durationMs/background/seed，structuredClone，`validateSceneSpec` 兜底；未知 templateId 返回错误）。
- 数据编辑：`SketchEditDraft { title, data }`；行格式——每行一条 `文本[,强调]`，**从右取字段**（末段恰为 下划线/圈/无 读强调，否则整行是文本——文本可含逗号；强调缺省 = 无）。`draftSketchFromSpec` / `buildSketchRevisePatch`：CRLF/空行/trim 容错、行号错误消息、非法返回 `{spec:null,error}` 不落 patch（C1 语义）。round-trip：draft 回读按同格式展开（强调 = 无时省略段）。
- 编辑卡「组件模板」下拉 optgroup 追加「手绘」组（图表 / 地图 / 流程 / 火柴人 / 手绘），`resolveAnyTemplate` 五族解析；手绘编辑字段（标题 + 数据 textarea，提示「每行 文本[,下划线|圈]（强调缺省无）」）仅当手绘组件已落地时渲染；应用逻辑统一走合并语义（模板 spec 为基底 + 数据草稿 + 旁白/背景/时长一次应用一并落库，P2-① I1 语义）。
- **规划器零改动裁定**（沿 P2-①②③④）：规划器不生成手绘镜头。

## 需求（R）

- **R1 组件契约与注册表**：组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v6 = v5 ∪ sketch-note；旧 spec 渲染结果不变。
- **R2 手绘几何与写入可推**：下划线/圈的采样点由常量与正弦抖动公式唯一决定；逐字写入的可见字数由 (i, tMs) 唯一决定；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝；模板时序预算不变量由模板测试钉死。
- **R4 工作台闭环**：模板下拉换组件（五组）+ 手绘数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档；模板应用与并发草稿编辑合并落库（沿 P2-① I1 语义）。
- **R5 e2e（VID-021）**：浏览器建项 → 镜头换手绘模板 + 数据编辑（含并发旁白）→ 保存导出结构断言 → CLI 双画幅出片：手绘帧 YAVG 非全黑、双跑逐字节一致、**无手绘基线（stick e2e 项目）重渲 = P2-④ 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- 自由绘制涂鸦画板 / 白板编辑器（编辑器桥领域，ADR-0012 纪律）。
- rough.js 或任何新依赖（零新依赖裁定）。
- 手写体字体/字形变形（用默认字体；逐字写入提供手写节奏）。
- 抖动样式参数化（幅度/波长/段数为固定常量；按需另刀）。
- 素材图片手绘滤镜（位图领域）。
- 规划器句式路由生成手绘镜头（见裁定）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| items 非 1..5 个 | `sketch-note params.items 必须是 1..5 个 {text, emphasis}` |
| text 非空 1..12 字 | `sketch-note params.items[i].text 必须是 1..12 个字符` |
| emphasis 非枚举 | `sketch-note params.items[i].emphasis 必须是 下划线/圈/无` |
| writeMs/drawMs 越 200..6000 | `… 必须是 200..6000 的整数` |
| staggerMs 越 120..1200 | `sketch-note params.staggerMs 必须是 120..1200 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| title 超 40 字符 | `sketch-note params.title 必须是 ≤40 个字符` |
| 工作台数据行格式错/强调词未知/文本超长 | `buildSketchRevisePatch` 返回行内错误（含行号定位），不落 patch |
| 未知 templateId | `applySketchTemplate` 返回 `未知手绘模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：stick e2e（VID-020）复跑 exit 0，媒体哈希 = P2-④ 已档 `1b12050d…`/`6e59b169…` 逐字节一致（组件追加不改旧渲染）。
- **A2 手绘几何与写入**：单测断言逐字写入字数（进度 0/中途/1、单字条目）、下划线折线点序（含抖动公式采样值）、圈椭圆 rx 随文本宽、梯次 delay、双描第二遍相位差、textarea 解析 round-trip（含强调缺省与含逗号文本）。
- **A3 帧确定性**：组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板（含并发旁白合并）→ 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-021 登记，qa 计数更新，CURRENT_STATE 顶部条目。
