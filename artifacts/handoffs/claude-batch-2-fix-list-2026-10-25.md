# Codex 增量复核清单：Batch-2 复核修复（2026-10-25）

**分支** `claude/video-batch-2`（基线 `main@cc47c94`，修复 HEAD `8078a7a`，共 5 提交）。**修复提交**：`8078a7a`（16 文件，+357/−221）。以下逐项给精确位置。

---

## P1-1 家装样片内容串题

**改动文件**：`apps/web/src/app/video-studio/sample-gallery.ts:441-470`（对比镜）与 `:501-520`（里程碑镜）

| 字段 | 修复前（门店运营） | 修复后（家装） |
|---|---|---|
| 对比镜 title | 等单时长对比 | 空间利用对比 |
| metricLabel | 顾客平均等单 | 两房 vs 三房 |
| beforeValue / beforeNote | 12 分钟 / 旧吧台动线 | 两房 / 客厅局促采光差 |
| afterValue / afterNote | 3 分钟 / 双窗口分流 | 三房 / 多一间多功能房 |
| deltaText | 12 → 3 分钟 | 2 房 → 3 房 |
| 旁白 | 等单时长从十二分钟降到三分钟 | 改造前空间局促，改造后多出一间房 |
| 里程碑节点 | Q1 签约 → Q4 开业 | 3月 签约 → 4月 拆改 → 6月 硬装 → 8月 入住 |
| 旁白 | 签约到开业，四个季度稳步推进 | 从签约设计到入住验收，四阶段推进 |

**验证**：留存的 `artifacts/video-studio-b2-renovation-2026-10-25/landscape-shot2.png` 可见「空间利用对比 / 两房 → 三房」；测试断言 7 镜/24s/kinds 含 compare-split+timeline-milestones。

## P1-2 竖版对比镜差值徽章遮挡后说明

**改动文件**：`packages/video-scene/src/components/compare-split.ts:115-121`（rightY）与 `:223`（badgeY）

| 参数 | 修复前 | 修复后 | 效果 |
|---|---|---|---|
| 竖版 rightY | `height * 0.62` | `height * 0.56` | 后面板底 ≈ 84%（原 90%→说明挤到 85% 与徽章 86% 重叠） |
| 竖版 badgeY | `height * 0.86` | `height * 0.885` | 徽章与面板底间距 ≈ 4.5% 画幅 |

**验证**：`portrait-shot2.png` 后说明「多一间多功能房」完整可读、绿色徽章独立于其下方。

## P2-3 取消按钮不重置新草稿

**改动文件**：`apps/web/src/app/video-studio/shot-editor-card.tsx:2767-2782`（取消 onClick 追加）

新增两个 set 调用：
```tsx
setCompareSplitDraft(editSpec?.componentId === "compare-split"
  ? structuredClone(editSpec.params) : null);
setTimelineDraft(editSpec?.componentId === "timeline-milestones"
  ? structuredClone(editSpec.params) : null);
setCompareSplitError(null);
setTimelineError(null);
```

**验证**：改 compare 值→取消→再开→值恢复原样→应用→写入原值（逻辑审查；浏览器回归在 gallery e2e 间接覆盖——该 e2e 在取消后重新打开编辑并修改正确值）。

## P2-4 时间轴留存关键帧太早

**改动文件**：`scripts/video/b2-renovation-render.mjs:49`

| 修复前 | 修复后 |
|---|---|
| `[4, 11.0]` → 镜内仅 0.5s（4 节点逐个入场需 1800ms，尚未完成） | `[4, 13.7]` → 镜内 3.2s（入场全完成，4 节点全部可见） |

**验证**：`portrait-shot4.png` 竖版四节点（签约✓/拆改✓/硬装○/入住○）清晰可见。

## P2-5 家装样片自身浏览器验收

**新文件**：`scripts/video/e2e-b2-gallery-sample.mjs`（~130 行）

覆盖：样片库「使用此样片」→ 7 镜家装项目 → 修改对比前后值 + 时间轴节点标签/状态 → 保存刷新重开 → 持久断言（beforeValue/label/status）→ 真实双画幅 MP4 出片。**e2e exit 0**。

---

## 复跑入口

```text
git checkout claude/video-batch-2 && git pull
git diff cc47c94..8078a7a  # 全量增量

pnpm --filter @acs/video-scene test   # 189/189
pnpm --filter @acs/web test           # 313/313
pnpm -r typecheck && pnpm exec biome check .
node scripts/qa/run-regression.mjs validate   # 114/56

# 渲染（已提交产物重出验证）：
node scripts/video/b2-renovation-render.mjs   # 重出 7 镜双画幅 + 4 关键帧

# 浏览器（需本 worktree web :3223）：
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3223
BASE_URL=http://127.0.0.1:3223 node scripts/video/e2e-b2-gallery-sample.mjs
BASE_URL=http://127.0.0.1:3223 node scripts/video/e2e-b2-editable-layouts.mjs
```

## 未含（沿复核要求单独出结果）

Task 3（Blender 同对象对照）、Task 4（W2/T4 视觉收口）——不与本修复混提交，待后续分支。
