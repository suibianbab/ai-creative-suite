# Video Studio P2-① 数据可视化（图表组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第一项 **数据可视化**（图表 + 数字滚动）。

## 问题

镜头画面目前只有 文本/线描/图形 三种组件，无法表达 STEM 解说最常用的「数量与对比」。本刀给组件注册表追加三类数据可视化组件并接入工作台起点模板，且不破坏：

- 注册表只追加纪律（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含图表的项目重渲 = 已档哈希）；
- 规划器输出稳定（P1 分镜 e2e 锚定现有句式输出，不得漂移）。

## 方案（程序化 SVG，零新依赖）

**手写图表，不引 D3。** v1 只需线性比例尺与折线累计长度等初等数学；video-scene 保持零依赖、浏览器/Node 双端同源。后续题材（如地图投影）再按需评估引入 d3 子模块，SvgNode 边界不变。

三个新组件 v1（沿 line-drawing 先例：1000×1000 设计空间 + 嵌套 svg viewBox，横竖版同 spec 等比居中）：

- **bar-chart**：标题 + N 柱对比。柱自基线生长（`easeOutCubic`，逐柱 delay = i×90ms），最大柱用 accentColor 高亮；柱顶值标签在柱完成后 300ms 淡入；基线下 x 轴标签；3 条浅网格线（25/50/75%），y 上限 = max×1.1 留值标签头空间。
- **line-chart**：标题 + 折线描画（`pathLength=1` + dashoffset，同 line-drawing 口径）+ 数据点圆标（描画进度越过该点累计长度占比后 240ms 弹出）；x 轴标签超 6 字符截断加 …。
- **number-counter**：大数字滚动（`value × easeOutCubic(t/countMs)`，`toFixed(decimals)` 直拼——不用 toLocaleString，locale 不确定）+ 数字下 accent 下划线生长 + 底部标题；字号按可用宽 840 自适应封顶 200。

`defaultRegistry` v1→**v2**（追加三组件，旧 spec 渲染路径零改动）。文本度量 `emUnits`/`fitFontSize` 从 text-animation 提取到共享模块 `text-width.ts`（纯重构，text-animation 改引用，行为零变化）。

### 数据模型（params，全部过 validateParams）

```ts
// bar-chart v1
{ title: string /* ≤40 */, bars: Array<{ label: string /* 1..12 字符 */, value: number }>, /* 1..8 条 */
  barColor: string, accentColor: string, textColor: string, enterMs: number /* 200..6000 */ }
// line-chart v1
{ title: string, points: Array<{ label?: string /* ≤12 */, value: number }>, /* 2..12 个 */
  lineColor: string, markerColor: string, textColor: string, drawMs: number /* 200..6000 */ }
// number-counter v1
{ title: string, value: number, prefix: string /* ≤6 */, suffix: string /* ≤6 */,
  decimals: number /* 0..2 整数 */, countMs: number /* 200..6000 */,
  numberColor: string, accentColor: string }
```

数值统一边界：有限数、0 ≤ v ≤ 1e12（v1 不支持负值）。颜色 `#rrggbb`。动画时长整数毫秒；组件内 `tMs = frame/fps×1000`，无墙钟/未播种随机/网络（ADR 0003 §2.3）。

### 工作台接线（新纯逻辑模块 `chart-templates.ts`，沿 shot-edit.ts 模式）

- **5 个起点模板**：`bar-compare-4`（柱状对比 4 柱）、`bar-rank-6`（柱状排行 6 柱）、`line-trend-8`（折线趋势 8 点）、`counter-kpi`（数字滚动 KPI）、`counter-percent`（百分比数字）。
- `applyChartTemplate(spec, templateId)`：换组件（componentId/version/params 全换），**保留 durationMs/background/seed/旁白**，过 `validateSceneSpec` 兜底；未知 templateId 返回错误。
- 图表数据编辑：bar/line 用「数据」textarea（每行 `标签,数值`，line 标签可省）；counter 用 数值/前缀/后缀 小输入 + 共享标题输入。`draftChartFromSpec` / `buildChartRevisePatch`（解析 → 合并 params 基底 → validateSceneSpec）——非法行/值**行内报错、不落 patch**（沿转场 C1 语义：非法编辑不清文档）。
- 编辑卡新增「换成图表模板」下拉（草稿态，应用时生效）；既有 标题/副标题、换一枚模板 编辑按当前组件照旧。
- **规划器零改动裁定**：P0 句式与 P1 分镜规划器均不生成图表镜头（图表进画面的唯一路径 = 工作台模板选择），保既有 e2e 输出锚定；句式路由扩展待模板库丰富后另刀。

## 需求（R）

- **R1 组件契约与注册表**：三组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v2 = v1 ∪ 三图表；旧 spec 渲染结果不变。
- **R2 动画与几何可推**：柱高 = value/max×区高（经缓动）、折线节点数与 dashoffset 进度、counter 文本逐帧可推；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝。
- **R4 工作台闭环**：模板下拉换组件 + 图表数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档。
- **R5 文本度量提取**：`text-width.ts` 共享模块；text-animation 改引用后其既有测试零改动全绿。
- **R6 e2e（VID-017）**：浏览器建项 → 镜头换图表模板 → 保存导出 → CLI 双画幅出片：图表镜头帧 YAVG 非全黑、双跑逐字节一致、**无图表基线（转场 e2e A1 项目）重渲 = 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- D3 等图表库依赖（v1 手写；地图刀再议）。
- 负值、双轴、堆叠、图例、y 轴刻度数字、折线逐点数值标签（v2+）。
- 规划器句式路由生成图表镜头（见裁定）。
- 外部数据源导入（CSV/Excel）、图表交互（hover/点击）。
- 图表配色自定义 UI（v1 用模板参数，高级编辑走 JSON 级 patch 的后续刀）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| bars 非 1..8 条 | `bar-chart params.bars 必须是 1..8 条 {label, value}` |
| label 空/超 12 字符 | `bar-chart params.bars[i].label 必须是 1..12 个字符` |
| value 非有限数/负/>1e12 | `bar-chart params.bars[i].value 必须是 0..1e12 的数` |
| points 非 2..12 个 | `line-chart params.points 必须是 2..12 个 {label?, value}` |
| counter value 越界 | `number-counter params.value 必须是 0..1e12 的数` |
| decimals 非 0..2 整数 | `number-counter params.decimals 必须是 0..2 的整数` |
| title >40 / prefix、suffix >6 | `… 必须是 ≤40 / ≤6 个字符` |
| enterMs/drawMs/countMs 越 200..6000 | `… 必须是 200..6000 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| 工作台数据行格式错/数值越界 | `buildChartRevisePatch` 返回行内错误（含行号定位），不落 patch |
| 未知 templateId | `applyChartTemplate` 返回 `未知图表模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：无图表的转场基线项目重渲 landscape/portrait SHA-256 = `artifacts/video-studio-export/` 已档值（组件追加不改旧渲染）。
- **A2 组件几何与动画**：单测断言柱高比例、最大柱 accent、折线 dashoffset 随帧推进、counter 文本 frame 0 = `prefix + (0).toFixed(decimals) + suffix` → 末帧 = value 定格；textarea 解析 round-trip。
- **A3 帧确定性**：三组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板 → 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-017 登记，qa 计数更新，CURRENT_STATE 顶部条目。
