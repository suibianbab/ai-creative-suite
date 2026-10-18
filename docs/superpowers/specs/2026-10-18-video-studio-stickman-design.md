# Video Studio P2-④ 火柴人（参数化骨架动作组件）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p2` 续叠 · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P2 行「题材模板」第四项 **火柴人**（火柴人模板）。

## 问题

镜头画面无法表达「一个人在做某事」——解说视频最常用的叙述画面（走入、讲解、打招呼、庆祝）。本刀给组件注册表追加一个火柴人组件并接入工作台起点模板，不破坏既有纪律：

- 注册表只追加（新视觉能力 = 追加组件 + bump registryVersion，不改旧组件）；
- 帧确定性（同 spec 同帧输出一致，VID-013 系证据口径）；
- 老项目字节不变（不含火柴人的项目重渲 = 已档哈希——本刀起以 P2-③ flow e2e 媒体哈希为新金标准）；
- 规划器输出稳定（火柴人进画面的唯一路径 = 工作台模板选择，planner 零改动）。

## 方案（闭式参数化骨架，零新依赖）

**裁定：动作 = 关节角的闭式函数 pose(action, φ)，不做关键帧插值数组。** 理由：关键帧插值需要用户摆姿势（编辑面大、校验面大），闭式函数把「走/挥手/跳」收敛成每动作一行公式，pose 在任意 tMs 直接求值——确定性与可测性最强（单测在采样帧上断言角度数值即可）。代价：v1 只有 5 种动作、动作不可自定义（模板组合表达场景）；关键帧姿势另刀按需评估（届时 params 形状向后兼容追加）。

一个新组件 v1（沿图表/地图/流程先例：1000×1000 设计空间 + 嵌套 svg viewBox、背景 rect 首子元素、tMs=帧/fps×1000、validateParams 中文消息带定位）：

- **stick-figure**（火柴人舞台）：标题 + 地面线 + 1..3 个火柴人，各自动作与起止 x 位置。骨架常量：头圆 r=28、躯干 110（颈→髋）、上臂 52 + 前臂 48（两段）、单段腿 120；groundY 可调（默认 800）。关节角约定：**从竖直向下起算、画布右摆为正**（度数，实现内转弧度）；前臂角相对上臂延长线。整组朝向由 toX−fromX 符号决定，向左时组内 `scale(-1,1)`（镜像，动作定义只写右侧版本）。
- 动作表（`φ = frac((tMs − delay − enterMs)/cycleMs)`，`delay = i×200ms`；动作开始前 enterMs 窗口内整人淡入 0→1，无 scale 弹跳——骨架人物放大观感差，裁定与盒子/节点先例不同。`tMs < delay+enterMs` 时 φ 取 0：未开始的图元保持站姿，只有淡入与呼吸在动）：
  - **站**：腿 ±4°、双上臂 ±6°、前臂 0；呼吸 bob = 2·sin(2π·tMs/1600) px（全身 y，一直生效）。
  - **走**：腿L 26·sin(2πφ)、腿R −26·sin(2πφ)；双上臂反相 ±20·sin(2πφ+π)、前臂 0；bob = 4·|sin(2πφ)|；x 在 travelMs 窗口内 fromX→toX 线性（到点后原地继续踏步循环）。
  - **挥手**：右上臂 150°（举臂）、右前臂相对 −60° + 25°·sin(6πφ)（每周期摆 3 次）；左臂/腿同站。
  - **指**：右上臂 90°（平举）、右前臂 0；其余同站。
  - **跳**：yOff = 120·4φ(1−φ)（抛物线，φ=0/1 落地）；腾空段（φ∈(0.15,0.85)）腿收 ±10°、双上臂 ±120°上举，落地段同站；x 固定 fromX。
- 线宽 10、圆头 linecap，描边色同模板色板；头圆填充同色。

`defaultRegistry` v4→**v5**（追加一组件，旧 spec 渲染路径零改动）。文本度量复用 `text-width.ts`。

### 数据模型（params，全部过 validateParams）

```ts
{ title: string /* ≤40 */,
  groundY: number /* 400..900 */,
  figures: Array<{ action: "走" | "站" | "挥手" | "指" | "跳",
    fromX: number /* 0..1000 */, toX: number /* 0..1000 */ }>, /* 1..3 个 */
  strokeColor: string, groundColor: string, textColor: string,
  enterMs: number /* 200..6000 整数 */, cycleMs: number /* 200..6000 整数 */,
  travelMs: number /* 200..6000 整数 */ }
```

颜色 `#rrggbb`。组件内禁墙钟/未播种随机/网络。sin/frac 输入是 tMs 的纯函数——同帧同值，帧确定性成立。

### 工作台接线（新纯逻辑模块 `stick-templates.ts`，沿 chart/map/flow-templates.ts 模式）

- **5 个起点模板**：`stick-walk-across`（一人横穿：走 80→920）、`stick-present`（讲解指板：指 500）、`stick-wave-hello`（挥手打招呼：挥手 500）、`stick-jump-joy`（庆祝跳跃：跳 500）、`stick-meet`（两人相遇：走 80→420 + 走 920→580 + 挥手 500）。
- `applyStickTemplate(spec, templateId)`：签名与语义同三族先例（换 componentId/version/params，保留 durationMs/background/seed，structuredClone，`validateSceneSpec` 兜底；未知 templateId 返回错误）。
- 数据编辑：`StickEditDraft { title, data }`；行格式——每行一个人物 `动作,fromX[,toX]`（toX 缺省 = fromX；动作是枚举词不含逗号，无消歧歧义；from/to 数值 0..1000）。`draftStickFromSpec` / `buildStickRevisePatch`：CRLF/空行/trim 容错、行号错误消息、非法返回 `{spec:null,error}` 不落 patch（C1 语义）。round-trip：draft 回读按同格式展开（toX = fromX 时省略段）。
- 编辑卡「组件模板」下拉 optgroup 追加「火柴人」组（图表 / 地图 / 流程 / 火柴人），`resolveAnyTemplate` 四族解析；火柴人编辑字段（标题 + 数据 textarea，提示「每行 动作,fromX[,toX]（动作 走/站/挥手/指/跳）」）仅当火柴人组件已落地时渲染；应用逻辑统一走合并语义（模板 spec 为基底 + 数据草稿 + 旁白/背景/时长一次应用一并落库，P2-① I1 语义）。
- **规划器零改动裁定**（沿 P2-①②③）：规划器不生成火柴人镜头。

## 需求（R）

- **R1 组件契约与注册表**：组件满足 `SceneComponent` 契约（validateParams 中文消息带定位 / render 纯函数）；`defaultRegistry` v5 = v4 ∪ stick-figure；旧 spec 渲染结果不变。
- **R2 几何与动作可推**：骨架关节位置由常量与关节角唯一决定；动作角度由 (action, φ) 闭式唯一决定；整组镜像由 toX−fromX 符号唯一决定；同 spec 同帧双调 `deepEqual`。
- **R3 校验边界**：错误表全表由 validateParams 拒绝。
- **R4 工作台闭环**：模板下拉换组件（四组）+ 火柴人数据编辑 + 保存落文档（validateVideoProject 过）；非法编辑行内报错不清文档；模板应用与并发草稿编辑合并落库（沿 P2-① I1 语义）。
- **R5 e2e（VID-020）**：浏览器建项 → 镜头换火柴人模板 + 数据编辑（含并发旁白）→ 保存导出结构断言 → CLI 双画幅出片：火柴人帧 YAVG 非全黑、双跑逐字节一致、**无火柴人基线（flow e2e 项目）重渲 = P2-③ 已档哈希**、计费行数不变、控制台零 error。

## 非目标

- 关键帧姿势自定义 / 骨架参数（身高/比例）可调（闭式动作表，见裁定）。
- 多人交互碰撞、队伍编排（v1 ≤3 人，位置手摆）。
- 面部表情、手部细节、服装。
- 物理模拟（跳跃为固定抛物线）。
- 规划器句式路由生成火柴人镜头（见裁定）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| figures 非 1..3 个 | `stick-figure params.figures 必须是 1..3 个 {action, fromX, toX}` |
| action 非枚举 | `stick-figure params.figures[i].action 必须是 走/站/挥手/指/跳` |
| fromX/toX 非有限数 0..1000 | `stick-figure params.figures[i].fromX / toX 必须是 0..1000 的数` |
| groundY 越 400..900 | `stick-figure params.groundY 必须是 400..900 的数` |
| enterMs/cycleMs/travelMs 越 200..6000 | `… 必须是 200..6000 的整数` |
| 颜色非 #rrggbb | `… 必须是 #rrggbb` |
| title 超 40 字符 | `stick-figure params.title 必须是 ≤40 个字符` |
| 工作台数据行格式错/动作词未知/数值越界 | `buildStickRevisePatch` 返回行内错误（含行号定位），不落 patch |
| 未知 templateId | `applyStickTemplate` 返回 `未知火柴人模板 templateId` |

## 验收（A）

- **A1 注册表追加无害**：flow e2e（VID-019）复跑 exit 0，媒体哈希 = P2-③ 终评修复（`34bda10`）后已档 `24a625c7…`/`274f1d0f…` 逐字节一致（组件追加不改旧渲染）。
- **A2 骨架几何与动作**：单测断言骨架常量几何（站姿关节坐标）、走循环采样帧角度（φ=0/0.25/0.5）、跳抛物线（φ=0/0.5/1）、镜像组 transform、挥手前臂振荡、x 行进窗口、textarea 解析 round-trip（含 toX 省略）。
- **A3 帧确定性**：组件同 spec 同帧双调 deepEqual；e2e 双跑出片逐字节一致。
- **A4 工作台闭环**：e2e 换模板（含并发旁白合并）→ 保存导出全程 `validateVideoProject` 过、控制台零 error。
- **A5 零计费 + 登记**：全程无 TTS；VID-020 登记，qa 计数更新，CURRENT_STATE 顶部条目。
