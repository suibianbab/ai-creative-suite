# Codex 修复交接：双画幅复核问题清单（2026-10-23）

## 范围

分支 `video-studio/dual-aspect-edit` @ `39a0656`，基于 main `226a488`。来源：对本分支增量的代码复核（110 文件），下述 6 项均已在当前工作树逐行核实，行号以 `39a0656` 为准。复核确认无问题的部分不在本清单内：三路径中间 spec 构造（旧覆写保留/换模板清除/不支持拒绝）、末点让位逻辑本身、`nodeTextColor ?? textColor` 旧 spec 兼容、audit 脚本无计费。仅提交本开发分支，不合并/推送 main。

## 问题清单

### P1（正确性·高）line-chart：任意画幅覆写会让未覆写的首末标签字号骤缩

- 位置：`packages/video-scene/src/components/line-chart.ts:285-289`（`labelWidth` 三元分支）。
- 事实：`override` 为真值时首末标签宽度容差 = `gap × 0.5`；无覆写时 = `labelSlot × 1.7`。而 `layoutFor`（`packages/video-scene/src/aspect-layout.ts:14-21`）直接返回画幅桶对象——空 `{portrait:{}}` 也是真值，且 `validateLayout` 放行空对象；仅给中间点配 `shortLabels` 同样使 `override` 非 undefined。
- 复现：竖版 720×1280、12 点、首末标签 6 字（如「第1季度表现」）、仅给某中间点配 shortLabel：plotWidth≈526 → labelSlot≈48 → 首末 labelWidth≈24 → `fitFontSize(≈25.9, 6 字, 24)` ≈ 4px，不可读。与「未覆写标签行为不变」的交付承诺冲突。现有测试恰好同时缩短了首末标签或使用 labelStep≥2，故未暴露。
- 修复方向（建议）：覆写分支下首末标签容差取 `max(gap × 0.5, labelSlot × 1.7)` 或等价下限；或空覆写对象不进入覆写分支。
- 必须测试：竖版仅中间点 shortLabels + 6 字首末标签，断言首末 `font-size` 不低于可读下限；`{portrait:{}}` 空桶与无 layout 渲染逐字节一致。

### P2（正确性·高）shot-editor-card：短标签面板与提示绑定已保存 spec 的旧点数

- 位置：`apps/web/src/app/video-studio/shot-editor-card.tsx:1262-1294`（逐点短标签行）与 `1305-1310`（hints）——两处都从 `editSpec.params.points`（已保存 spec）构建，而非当前图表数据草稿。
- 复现：已保存 12 点 spec 且 shortLabels `{11:"Q12"}`；同一编辑会话把图表数据改为 6 点 → 面板仍渲染 12 行；应用修订时合并出的最终 spec 过组件校验（`line-chart.ts:126-129`）报 `shortLabels[].index 11 越界（0..5）`，**整个修订（含内容改动）被阻塞**，而 UI 显示的第 12 行正是用户以为合法的输入位。注意 UI 侧 `buildLineAspect`（`aspect-layout-edit.ts:135-155`）本身不做索引越界校验，报错全部来自组件侧。
- 修复方向：行/hints 改用当前图表数据草稿的解析结果（与 apply 同一数据源）；或 apply 前按新点数裁剪旧行、错误信息指向 UI 已同步的行集合。
- 必须测试：组件级用例「点数减少后旧 shortLabels 的行为」。

### P3（正确性·中）describeLineChartLabels：未标注点被归入「已隐藏（间隔）」

- 位置：`apps/web/src/app/video-studio/aspect-layout-edit.ts:232-235`；呈现于 `shot-editor-card.tsx:1323-1328`。
- 事实：`lineChartLabelDisplay`（`line-chart.ts:72-74`）对 label 为 undefined/"" 的点一律 `show=false`（旧口径，渲染侧正确）；`describeLineChartLabels` 把所有 `!show` 无差别 push 进 `hidden`，不区分「无标签」与「labelStep 间隔隐藏」。
- 现象：稀疏标注图表（如 CSV 行 `,5` 产生空标签）展开画幅微调块 → 「已隐藏（间隔）：、、、…」空标签串 + 多余顿号，误导用户以为存在从未配置的间隔隐藏。`aspect-layout-edit.test.ts:197` 附近的用例 points 全标注，未覆盖此场景。
- 修复方向：label 为 undefined/"" 的点跳过 hidden 归类（或单列「未标注」）；仅 labelStep 引起的隐藏进「已隐藏（间隔）」。
- 必须测试：稀疏标注 points、无 labelStep 时 `hidden` 为空。

### P4（设计边界·择机）nodeTextColor 不参与 Style Bible 重着色

- 位置：`packages/video-scene/src/components/flow-diagram.ts:213`（`nodeTextColor ?? textColor`）。
- 事实：交接清单明确「Style Bible 不覆盖此字段」，故 recolor() 重写 boxColor 后，spec 定值 nodeTextColor 保持不变。若用户切到 secondary 为深色的 bible → 深色框 + 深色 nodeTextColor，**重现本轮刚修好的低对比问题**（STEM 镜头 6 的 `#102033` 即现成触发素材）。
- 方向（需产品决策，非必须本轮修）：① COLOR_ROLE 增加条目让 bible 联动；② 未显式设置时按 boxColor 亮度派生默认填充（需 spec 层区分「显式设置」）。最小动作：在交付记录 / style-bible 文档标注此边界。

### P5（简化）text-animation：覆写块重复 resolveTitle 的宽度钳制逻辑

- 位置：`packages/video-scene/src/components/text-animation.ts:366-381`，对照同文件 `resolveTitle`（≈117-126）。
- 事实：em-width / scale-clamp 公式存在两份，后续改动易漂移；且 `override.titleLines` 提供时 `baseSize`（368-372）计算后未使用（377 行直接用 `ctx.height / 8`）。
- 方向：抽公共 clamp 函数或给 `resolveTitle` 加可选 lines 参数；删除冗余 baseSize 计算。行为须不变，靠现有 text-animation 测试守护。

### P6（清理）EMPTY_LAYOUT_DRAFTS 死导出

- 位置：`apps/web/src/app/video-studio/aspect-layout-edit.ts:247`。
- 事实：全库仅定义处一次命中，无任何引用。删除（或改为模块内部使用）。

## 复跑

```text
pnpm --filter @acs/video-scene test                 # P1 用例落 line-chart.layout.test.ts
pnpm --filter @acs/web test                         # P2/P3 用例落 shot-editor 组件测试 / aspect-layout-edit.test.ts
pnpm --filter @acs/video-document test
pnpm -r typecheck
pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
node scripts/video/audit-stem-sample.mjs
```

修完建议按原交接清单重跑 e2e（`node scripts/video/e2e-gallery.mjs`、`node scripts/video/e2e-dual-aspect-edit.mjs`，需 web :3210）。

## 边界

- 仅提交 `video-studio/dual-aspect-edit`；不合并、不推送 main。
- P1–P3 为本轮应修；P4 需决策，可单独跟进；P5–P6 顺手清理。
- P1 修复不得改变无覆写路径的渲染（含 `{portrait:{}}` 空桶场景的最终视觉与无 layout 一致）。
