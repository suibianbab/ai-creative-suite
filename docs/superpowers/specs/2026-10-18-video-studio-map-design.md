# Video Studio P2-② 地图动画（示意网格地图 + 路径行程组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` 续叠 · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第二项 **地图动画**（SVG 地图 + 路径标注组件）。

## 问题

镜头画面无法表达「地理分布」与「行程路线」这两类 STEM/说明视频常用画面。本刀给组件注册表追加两个地图题材组件并接入工作台起点模板，且不破坏既有纪律：

- 注册表只追加（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含地图的项目重渲 = 已档哈希——本刀起以 P2-① dataviz e2e 媒体哈希为新金标准）；
- 规划器输出稳定（地图进画面的唯一路径 = 工作台模板选择，planner 零改动）。

## 方案（程序化 SVG，零新依赖）

**裁定：v1 不引 d3-geo / GeoJSON / 真实地理轮廓。** 理由：真实轮廓需要真实几何数据（中国分省简化版数百 KB），video-scene 零依赖与 Node/浏览器同源渲染都会背上它；而「示意网格地图」（tile-grid cartogram，区域方块按相对方位网格排布）是数据可视化领域正当的地图表达（FT/FiveThirtyEight 常用），零数据依赖、几何完全可推、帧确定性天然成立。真实轮廓与投影留待后续刀按需评估（届时 SvgNode 边界不变）。代价：v1 地图是示意而非写实轮廓——对说明类视频够用，对「地理精确」诉求不满足（另刀再议）。

两个新组件 v1（沿图表三件套先例：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 首子元素、tMs=帧/fps×1000、easing.js 缓动、validateParams 中文消息带定位）：

- **map-grid**（示意网格地图）：标题 + 区域方块网格（按 row/col 排布，自适应格子尺寸居中）+ 可选数值 choropleth 着色（`hexLerp(baseColor, highlightColor, value/maxValue)`，maxValue=max×1.1，全零/无值守卫全 baseColor）+ 区域标签（块内 fitFontSize）。动画：区域按序梯次淡入（delay=i×90ms，同 bar-chart 口径），值色随淡入到位。
- **map-journey**(路径行程)：浅网格底纹（5×5，opacity 0.08）+ 起点/途经/终点序列的 Catmull-Rom 样条（τ=0.5，端点复制法转 cubic bezier，公式确定）整条描画（`pathLength=1` + dashoffset，同 line-drawing/line-chart 口径）+ 移动标记（每段 bezier 采样 24 小段折线累计弧长，marker 等速走弧长 `progress×L`——采样折线插值，与 line-chart 圆标同一数学先例；视觉误差 <1px 不可感知）+ 起终点图钉落下（scale 1.6→1 + 淡入，起点在描画 0..20% 窗口、终点在 60%..80% 窗口）+ 途经点圆标（描画进度越过该点弧长占比后 5% 进度窗口弹出；**末点 frac 钳 `1−窗口`**——P2-① Task 3 Ruling 教训直接带上）+ 各点标签随点出现后淡入。

`defaultRegistry` v2→**v3**（追加两组件，旧 spec 渲染路径零改动）。文本度量复用 `text-width.ts`；hexLerp 为 map-grid 组件内私有（单一消费者，YAGNI 不提共享）。

### 数据模型（params，全部过 validateParams）

```ts
// map-grid v1
{ title: string /* ≤40 */,
  regions: Array<{ label: string /* 1..8 字符 */, row: number /* 整数 0..7 */,
    col: number /* 整数 0..7 */, value?: number /* 0..1e12，可选 */ }>, /* 1..24 个 */
  baseColor: string, highlightColor: string, textColor: string,
  enterMs: number /* 200..6000 整数 */ }
// map-journey v1
{ title: string,
  origin: { label: string /* 1..8 */, x: number /* 0..1000 */, y: number /* 0..1000 */ },
  destination: { label: string /* 1..8 */, x: number, y: number },
  waypoints: Array<{ label?: string /* ≤8，可选 */, x: number, y: number }>, /* 0..6 个 */
  routeColor: string, markerColor: string, pinColor: string, textColor: string,
  drawMs: number /* 200..6000 整数 */ }
```

数值统一边界：有限数、坐标 0..1000（设计空间内）、value 0..1e12。颜色 `#rrggbb`。动画时长整数毫秒。组件内禁墙钟/未播种随机/网络。

### 工作台接线（新纯逻辑模块 `map-templates.ts`，沿 chart-templates.ts 模式）

- **5 个起点模板**：`grid-china-6`（中国六分区示意：华北/华东/华南/西南/西北/东北 网格排布）、`grid-world-6`（世界六大区示意）、`grid-hotspot`（网格 + 单区高亮值标注）、`journey-route`（两城行程 + 弧线）、`journey-multi`（多站行程 4 点）。
- `applyMapTemplate(spec, templateId)`：签名与语义同 `applyChartTemplate`（换 componentId/version/params，保留 durationMs/background/seed，structuredClone，`validateSceneSpec` 兜底；未知 templateId 返回错误）。
- 地图数据编辑：`MapEditDraft { title, data }`；行格式——网格 `标签,行,列[,数值]`、行程 `名称,x,y`（首行起点、末行终点、中间途经；名称可省为裸 `x,y`）。`draftMapFromSpec` / `buildMapRevisePatch`：CRLF/空行/trim 容错、行号错误消息、非法返回 `{spec:null,error}` 不落 patch（C1 语义）。round-trip：draft 回读按同格式展开。
- 编辑卡「组件模板」下拉改 optgroup 分组（图表 / 地图），应用逻辑统一走 P2-① 终评后的合并语义（模板 spec 为基底 + 数据草稿 + 旁白/背景/时长一次应用一并落库）；地图编辑字段（标题 + 数据 textarea）仅当地图组件已落地时渲染，选中模板即预填默认数据。
- **规划器零改动裁定**（沿 P2-①）：P0 句式与 P1 分镜规划器均不生成地图镜头。

## 需求（R）

- **R1 组件契约与注册表**：两组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v3 = v2 ∪ 两地图组件；旧 spec 渲染结果不变。
- **R2 动画与几何可推**：网格块位置/尺寸由 row/col/maxRow/maxCol 唯一决定；choropleth 色由 value/maxValue 唯一决定；样条路径与 marker 弧长位置由点序与 progress 唯一决定；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝。
- **R4 工作台闭环**：模板下拉换组件（分组）+ 地图数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档；模板应用与并发草稿编辑合并落库（沿 P2-① I1 语义）。
- **R5 e2e（VID-018）**：浏览器建项 → 镜头换地图模板 + 数据编辑（含并发旁白）→ 保存导出结构断言 → CLI 双画幅出片：地图镜头帧 YAVG 非全黑、双跑逐字节一致、**无地图基线（dataviz e2e 项目）重渲 = P2-① 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- 真实地理轮廓（GeoJSON/shapefile）、地图投影、经纬度输入（v1 网格坐标 + 设计空间坐标；真实数据另刀评估）。
- 地图缩放/平移/点击交互、多组件叠加（网格+行程同镜头）。
- 规划器句式路由生成地图镜头（见裁定）。
- 区域名称库/行政区划数据内置（模板即数据，用户可改）。
- 图例、色阶条（v2+）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| regions 非 1..24 个 | `map-grid params.regions 必须是 1..24 个 {label, row, col, value?}` |
| label 空/超 8 字符 | `map-grid params.regions[i].label 必须是 1..8 个字符`（journey 同口径） |
| row/col 非整数 0..7 | `map-grid params.regions[i].row/col 必须是 0..7 的整数` |
| value 非有限数/负/>1e12 | `map-grid params.regions[i].value 必须是 0..1e12 的数` |
| origin/destination 缺失或字段非法 | `map-journey params.origin/destination 必须是 {label, x, y}` |
| waypoints 非 0..6 个 | `map-journey params.waypoints 必须是 0..6 个 {label?, x, y}` |
| x/y 非有限数 0..1000 | `map-journey params.…[i].x/y 必须是 0..1000 的数` |
| enterMs/drawMs 越 200..6000 | `… 必须是 200..6000 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| 工作台数据行格式错/数值越界 | `buildMapRevisePatch` 返回行内错误（含行号定位），不落 patch |
| 未知 templateId | `applyMapTemplate` 返回 `未知地图模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：dataviz e2e（VID-017）复跑 exit 0，媒体哈希 = P2-① 已档 `3c6950b9…`/`36f64db7…` 逐字节一致（组件追加不改旧渲染）。
- **A2 组件几何与动画**：单测断言网格块位置/尺寸/着色（hexLerp 端点与中点）、样条描画 dashoffset 随帧推进、marker 弧长位置 frame 0 = 起点 → 末帧 = 终点、图钉/圆标时窗、textarea 解析 round-trip。
- **A3 帧确定性**：两组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板（含并发旁白合并）→ 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-018 登记，qa 计数更新，CURRENT_STATE 顶部条目。
