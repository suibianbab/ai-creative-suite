# Video Studio P2-③ 流程图/示意图（线性流程 + 节点连线组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` 续叠 · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第三项 **流程图/示意图**（流程图/示意图组件）。

## 问题

镜头画面无法表达「步骤顺序」与「结构关系」这两类说明视频常用画面（工艺流程、决策分支、循环闭环、对比汇合）。本刀给组件注册表追加两个流程题材组件并接入工作台起点模板，且不破坏既有纪律：

- 注册表只追加（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含流程图的项目重渲 = 已档哈希——本刀起以 P2-② map e2e 媒体哈希为新金标准）；
- 规划器输出稳定（流程图进画面的唯一路径 = 工作台模板选择，planner 零改动）。

## 方案（程序化 SVG，零新依赖）

**裁定：v1 不引自动布局引擎（dagre/ELK）。** 理由：自动布局引依赖且结果随版本漂移，破坏帧确定性的可复核口径；线性流程的几何可由步数唯一推出，分支图的坐标由用户/模板显式给出（沿 map-journey `x,y` 先例）。代价：v1 分支图节点位置要手摆——模板给了合理起点，编辑改数据时坐标直观可调；自动布局另刀按需评估（届时 SvgNode 边界不变）。

两个新组件 v1（沿图表/地图先例：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 首子元素、tMs=帧/fps×1000、easing.js 缓动、validateParams 中文消息带定位）：

- **flow-steps**（线性流程图）：标题 + N 步盒子按方向（横向/纵向）等距排布 + 步间箭头。动画：盒 i 在 `i×120ms` 弹入（scale 1.4→1 + 淡入 300ms，梯次口径同 bar-chart/map-grid）；盒内标签在 `enterMs` 后淡入（两级节奏，同 map-grid「区域先入、标签后随」）；步间箭头在前盒落定后 240ms 窗口内描画（`pathLength=1` + dashoffset，同 line-drawing 口径）。
- **flow-diagram**（节点连线示意图）：标题 + 节点（盒子/菱形判定，显式 x,y）+ 边（按节点标签引用，可选边标）。动画：节点按声明序 `i×120ms` 弹入；边在两端节点都落定后于 `drawMs` 窗口内描画并带箭头，边标随描画完成淡入。边端点按两节点中心连线方向从各自中心收缩固定余量 100（近圆近似，v1 不做精确边界求交——菱形角部可能略有出入，视觉可接受；确定性优先）。

`defaultRegistry` v3→**v4**（追加两组件，旧 spec 渲染路径零改动）。文本度量复用 `text-width.ts`；箭头三角形为组件内私有几何函数（单一消费者，YAGNI 不提共享）。

### 数据模型（params，全部过 validateParams）

```ts
// flow-steps v1
{ title: string /* ≤40 */,
  steps: Array<{ label: string /* 1..10 字符 */ }>, /* 2..8 个 */
  direction: "horizontal" | "vertical",
  boxColor: string, arrowColor: string, textColor: string,
  enterMs: number /* 200..6000 整数 */ }
// flow-diagram v1
{ title: string /* ≤40 */,
  nodes: Array<{ label: string /* 1..6 字符，全图唯一 */, x: number /* 0..1000 */,
    y: number /* 0..1000 */, kind: "box" | "diamond" }>, /* 2..12 个 */
  edges: Array<{ from: string, to: string, label?: string /* ≤6，可选 */ }>, /* 1..16 条 */
  boxColor: string, arrowColor: string, textColor: string,
  enterMs: number /* 200..6000 整数 */, drawMs: number /* 200..6000 整数 */ }
```

数值统一边界：有限数、坐标 0..1000（设计空间内）。颜色 `#rrggbb`。动画时长整数毫秒。组件内禁墙钟/未播种随机/网络。边引用的 from/to 必须是已声明节点标签（错误消息带 `edges[i]` 定位）；节点标签全图唯一（重复拒绝，消息带两个出现位置行号语义的索引）。

### 工作台接线（新纯逻辑模块 `flow-templates.ts`，沿 chart/map-templates.ts 模式）

- **5 个起点模板**：`steps-4`（横向四步：需求→设计→开发→交付）、`steps-v-5`（纵向五步）、`flow-decision`（判定分支：菱形 + 是/否两条边）、`flow-cycle`（三节点循环闭环）、`flow-compare`（两源汇一对比）。
- `applyFlowTemplate(spec, templateId)`：签名与语义同 `applyChartTemplate`/`applyMapTemplate`（换 componentId/version/params，保留 durationMs/background/seed，structuredClone，`validateSceneSpec` 兜底；未知 templateId 返回错误）。
- 流程数据编辑：`FlowEditDraft { title, data }`；行格式——steps 组件每行一个 `标签`（2..8 行）；diagram 组件分两段，节点段每行 `标签,x,y[,菱形]`（缺省 box），`---` 单独一行分隔，边段每行 `标签->标签[,边标]`。`draftFlowFromSpec` / `buildFlowRevisePatch`：CRLF/空行/trim 容错、行号错误消息、非法返回 `{spec:null,error}` 不落 patch（C1 语义）。round-trip：draft 回读按同格式展开（kind=diamond 输出 `菱形` 标记，边标可选输出）。
- 编辑卡「组件模板」下拉 optgroup 追加「流程」组（图表 / 地图 / 流程），`resolveAnyTemplate` 三族解析；流程编辑字段（标题 + 数据 textarea）仅当流程组件已落地时渲染，选中模板即预填默认数据；应用逻辑统一走合并语义（模板 spec 为基底 + 数据草稿 + 旁白/背景/时长一次应用一并落库，P2-① I1 语义）。
- **规划器零改动裁定**（沿 P2-①②）：P0 句式与 P1 分镜规划器均不生成流程图镜头。

## 需求（R）

- **R1 组件契约与注册表**：两组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v4 = v3 ∪ 两流程组件；旧 spec 渲染结果不变。
- **R2 动画与几何可推**：steps 盒位置/尺寸由步数与 direction 唯一决定；diagram 节点尺寸恒定（box 180×72、diamond 半对角 110×64）、边端点由中心连线与固定余量唯一决定、箭头朝向由边方向唯一决定；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝。
- **R4 工作台闭环**：模板下拉换组件（三组）+ 流程数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档；模板应用与并发草稿编辑合并落库（沿 P2-① I1 语义）。
- **R5 e2e（VID-019）**：浏览器建项 → 镜头换流程模板 + 数据编辑（含并发旁白、含 `->` 边与菱形标记）→ 保存导出结构断言 → CLI 双画幅出片：流程镜头帧 YAVG 非全黑、双跑逐字节一致、**无流程图基线（map e2e 项目）重渲 = P2-② 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- 自动布局（dagre/ELK）、正交折线布线（v1 直线边 + 固定余量裁边）。
- 流程图缩放/拖拽交互、多组件叠加。
- 规划器句式路由生成流程图镜头（见裁定）。
- 泳道图（swimlane）、跨页长流程（v1 ≤8 步 / ≤12 节点）。
- 边的曲线/自环（v1 直线边；循环闭环由模板摆位表达）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| steps 非 2..8 个 | `flow-steps params.steps 必须是 2..8 个 {label}` |
| steps label 空/超 10 字符 | `flow-steps params.steps[i].label 必须是 1..10 个字符` |
| direction 非 horizontal/vertical | `flow-steps params.direction 必须是 horizontal 或 vertical` |
| nodes 非 2..12 个 | `flow-diagram params.nodes 必须是 2..12 个 {label, x, y, kind}` |
| 节点 label 空/超 6 字符 | `flow-diagram params.nodes[i].label 必须是 1..6 个字符` |
| 节点 label 重复 | `flow-diagram params.nodes[i].label 与 nodes[j] 重复` |
| x/y 非有限数 0..1000 | `flow-diagram params.nodes[i].x/y 必须是 0..1000 的数` |
| kind 非 box/diamond | `flow-diagram params.nodes[i].kind 必须是 box 或 diamond` |
| edges 非 1..16 条 | `flow-diagram params.edges 必须是 1..16 条 {from, to, label?}` |
| 边 from/to 不在节点表 | `flow-diagram params.edges[i].from/to 必须引用已声明节点` |
| 边 label 超 6 字符 | `flow-diagram params.edges[i].label 必须是 ≤6 个字符` |
| enterMs/drawMs 越 200..6000 | `… 必须是 200..6000 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| 工作台数据行格式错/数值越界/分隔段缺失 | `buildFlowRevisePatch` 返回行内错误（含行号定位），不落 patch |
| 未知 templateId | `applyFlowTemplate` 返回 `未知流程模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：map e2e（VID-018）复跑 exit 0，媒体哈希 = P2-② 已档 `64eb4480…`/`7aeff69d…` 逐字节一致（组件追加不改旧渲染）。
- **A2 组件几何与动画**：单测断言 steps 盒位置/尺寸（横/纵）、diagram 节点几何与边端点收缩、箭头朝向、弹入/描画时窗、textarea 解析 round-trip（含 `->` 边、菱形标记、边标）。
- **A3 帧确定性**：两组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板（含并发旁白合并）→ 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-019 登记，qa 计数更新，CURRENT_STATE 顶部条目。
