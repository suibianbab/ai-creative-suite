# Video Studio 转场（P1 Feature ④）设计 spec

日期：2026-10-18 · 分支 `worktree-video-studio-p1`（续叠） · 对齐 `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md:111` P1 行「多场景编排（转场、时序、整片预览）」——时序与整片预览已交付，本刀补最后一环。

## 问题

TimelineScene/整片预览目前镜头间为**硬切**：spans 连续无缝（`quantizeTimeline` 产物 + `scene-spec-composition.tsx` 的衔接断言），每帧恰好归属一个镜头。多镜头解说视频需要镜头间的视觉桥接（转场），且不得破坏：

- spans 连续性不变量（TimelineScene 对有缝/重叠当场抛错）；
- 帧确定性（同项目同引擎逐字节一致，VID-013 系证据口径）；
- 无转场 = 现状字节不变（回归纪律：老项目重渲必须与旧证据逐字节一致）。

## 方案（D4 程序化路线，零新编辑器桥）

**转场 = 边界处的黑色淡入淡出（dip-to-black），帧窗向相邻镜头 span 内部借帧，spans 不动。**

- 转场时长 T 帧对半 split：左镜头尾部 ⌈T/2⌉ 帧叠加黑色（透明度 0→1 线性），右镜头头部 ⌊T/2⌋ 帧叠加黑色（1→0）。无重叠、无悬空帧，连续性不变量原样成立。
- 画面层之上叠一层全幅黑色矩形/DOM（预览 `<div>`、Remotion `AbsoluteFill`），透明度来自**纯函数**，无随机、无时钟。
- P1 只做 `fade` 一种（经典、跨题材安全）；滑入/擦除等留组件注册表式的后续扩展位（kind 枚举已留）。

### 数据模型（project 级编排元数据）

```ts
// @acs/video-document
export type TransitionKind = "fade";
export type ShotTransition = {
  boundary: number;      // 0 基：shots[boundary] 的出场 → shots[boundary+1] 的入场；合法 0..shots.length-2
  kind: TransitionKind;  // P1 仅 "fade"
  durationMs: number;    // 100..2000
};
// VideoProject 新增可选顶层字段 transitions?: ShotTransition[]（缺省/空 = 全硬切 = 现状字节不变）
```

**可变元数据裁定**（对照既有纪律）：`transitions` 是编排配置而非审计记录，与 `title` 同级可自由改写（保存即 savedVersion+1），**不进** shots/events/renderRecords/deliveries 的只追加纪律；`brief.applications` 式的前缀保留不适用（用户需要替换/删除某边界的转场）。约束：同一 `boundary` 至多一条（重复拒绝，编辑语义 = 整条替换）。

### 共享帧数学（预览与出片同源）

```ts
// @acs/video-document（沿 mapGlobalFrame/activeSubtitleCue 的派生投影先例）
export type TransitionOverlay = { opacity: number }; // 0..1，0 = 无叠加
export function transitionOverlayAt(
  transitions: ShotTransition[], frame: number, fps: number,
  spans: Array<{ startFrame: number; frames: number }>,
): TransitionOverlay | null;
```

- 逐边界换算 T = round(durationMs × fps / 1000)，对半 split 映射到两侧 span 尾/头；帧落在窗内按线性斜率给 opacity，窗外 null。
- 装配期合法性（span 只在量化后已知）：`T/2 ≥ 相邻任一 span 帧数` → 抛错（指路缩短 durationMs）；非整数/越界已在 schema 层拒绝。

### 渲染与预览接线

- `TimelineScene`（remotion-engine）新可选 prop `transitions`：每帧调 `transitionOverlayAt`，非 null 则在镜头层之上渲染黑色 `AbsoluteFill`（opacity）。**prop 缺省 → 渲染树与现状逐字节一致**。
- `render-scene`：读项目 `transitions`（回读已过 `validateVideoProject`），透传进 Timeline props；写进 render-manifest（逐边界摘要：kind/durationMs/换算帧数）。
- 整片预览（`scene-preview.tsx` TimelinePreview）：同一 helper 驱动黑色 `<div>` 叠层。
- 工作台（page.tsx）：镜头列表下新增「转场」区，逐边界一行（`镜头 i → i+1`：下拉 无/淡入淡出 + 时长数字输入），编辑进草稿态、保存落文档。纯逻辑（草稿构造/校验/patch）进可测模块（沿 shot-edit.ts 模式）。
- GIF/整片 MP4 派生自动继承转场（从 Timeline 合成派生）；**单镜头 SVG 导出不含转场**（单镜头 artifact，转场是镜头间属性——记为非目标）。

## 需求（R）

- **R1 文档与校验**：`ShotTransition` 类型 + `validateVideoProject` 接受可选 `transitions`（形状/kind 枚举/durationMs 100..2000/boundary 范围/无重复 boundary，错误消息带 `transitions[i]` 定位）；缺省字段行为与现状完全一致。
- **R2 帧数学**：`transitionOverlayAt` 纯函数（上面签名）：对半 split、线性斜率、窗外 null；装配期 span 不足抛错。
- **R3 出片**：render-scene 装配 + TimelineScene 叠层渲染；无转场项目重渲与既有证据逐字节一致；manifest 记录转场摘要。
- **R4 预览与工作台**：整片预览可见转场；工作台可逐边界配置/清除转场并保存；单镜头预览不涉及。
- **R5 e2e（VID-016）**：浏览器建项 → 配置 1→2 边界 fade 500ms → 保存导出 → CLI 出片：中点暗帧像素比断言（沿字幕 e2e 的暗带像素比口径）、双画幅、双跑逐字节一致、**无转场基线项目重渲哈希 = Feature ③ 已档哈希**（回归金标准）、计费行数不变。

## 非目标

- 交叉淡化（crossfade，需 span 重叠——破坏连续性不变量，不做）。
- fade 之外的转场种类（滑入/擦除/3D；kind 枚举留扩展位）。
- 单镜头 SVG 导出渲染转场；转场关键帧编辑器（时间轴拖拽）。
- 转场审计事件/只追加纪律（编排配置，随保存覆盖）。
- 音乐/音效淡出配合（无音轨概念变更）。

## 错误表

| 输入 | 行为 |
| --- | --- |
| kind 非 "fade" | `validateVideoProject` 拒绝：`transitions[i].kind 须为 fade` |
| durationMs <100 或 >2000 | 拒绝：`transitions[i].durationMs 须在 100..2000` |
| boundary 超出 0..shots.length-2 | 拒绝：`transitions[i].boundary 越界（合法 0..N-2）` |
| 同 boundary 重复 | 拒绝：`transitions[i].boundary 与 transitions[j] 重复` |
| 装配期 T/2 ≥ 相邻 span 帧数 | `transitionOverlayAt` 抛错：指路缩短 durationMs（render-scene fail / 预览告警标记） |
| 镜头增删后 boundary 悬空 | 下一次校验拒绝（范围随 shots 长度收紧）；工作台草稿重建时丢弃越界项并提示 |

## 验收（A）

- **A1 回归金标准**：无 transitions 的 Feature ③ 基线项目重渲，landscape/portrait MP4 SHA-256 = `artifacts/video-studio-export/` 已档值（转场缺席 = 字节不变）。
- **A2 转场可见**：e2e 断言 1→2 边界中点帧的暗像素比显著高于转场窗外对照帧（数值断言，非肉眼）。
- **A3 双端一致**：整片预览与出片共用同一 helper；双画幅均含转场。
- **A4 确定性**：带转场项目双跑出片逐字节一致。
- **A5 零计费 + 文档合法**：全程无 TTS；每次保存/导出后 `validateVideoProject` 过；VID-016 登记。
