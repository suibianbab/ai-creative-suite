# T4 交付报告：前后对比与里程碑时间轴布局（2026-10-25）

分支 `claude/video-next-batch`。任务源：§T4。证据：`artifacts/video-studio-t4-layouts-2026-10-25/`。

## 盘点结论

现有可复用布局：text-animation（标题）、bar/line-chart（数据）、number-counter（数字）、flow-steps/diagram（流程）、sketch-note（重点）、explainer-composition（标题+图示+标注/环形）、map/journey（地图）、stick/loading——**无前后对比分栏布局，无里程碑时间轴布局**（grep 全模板族确认）。

## 实现

- **`compare-split@1`**（`packages/video-scene/src/components/compare-split.ts`）：前后对比——左「前」右「后」面板（标签/数值/说明三行），中间方向箭头，底部差值徽章（`deltaPositive` 决定绿/红）；横版左右分栏、竖版上下分栏；入场时序分三段（前→后→徽章）。
- **`timeline-milestones@1`**（`timeline-milestones.ts`）：里程碑时间轴——2..6 节点在轴线上，三态填充（done=实心绿 / active=空心橙 / pending=空心灰），每节点日期+标签；横版水平轴、竖版垂直轴；节点逐个弹入。
- **两个新配方**（`shot-recipes.ts`）：`recipe-compare-split`（标题+前值+后值三个输入）、`recipe-timeline-milestones`（标题+逗号分隔节点标签，自动分配完成状态）；目录筛选 topics 新增「对比/规划」。
- **注册表 v8→v9**（`default-registry.ts`）：追加两组件，复用既有 SvgNode / fitFontSize / easing 基建。

## 四态

1. **代码**：完成（两组件 + 两配方 + 注册表 bump；参数全有界）。
2. **自动回归**：video-scene 189/189、web 311/311（五配方元数据/编译/预览测试更新）；typecheck、Biome、qa validate 111/56。
3. **真实出片**：`t4-layout-demo.mjs`（VID-059）——「门店改造季报」四镜短片（开场文字→前后对比→里程碑→收尾）配暖木 Bible，真实双画幅 H.264 出片 + 四张关键帧（横竖各镜 2/3）。
4. **视觉**：关键帧可辨识对比面板/时间轴节点结构；文字溢出/主体裁切/留白的**人工审片待人工**。

## 已知限制

- compare-split 差值徽章文字由配方拼接（前值 → 后值），不自动计算数值差（组件本身接受任意 `deltaText`）。
- timeline-milestones 配方自动分配「前 N-2 done + 第 N-1 active + 最后 pending」状态；用户如需手动指定各节点状态，需走参数透传或后续 UI。
