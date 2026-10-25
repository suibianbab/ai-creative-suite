# T5 完整体验链收口：四态结论与操作说明（2026-10-25）

分支 `claude/video-next-batch`。任务源：§T5。证据：`.tools/video-t5-experience-e2e/`。

## 用户操作说明（一条链）

1. **创建**：「新建项目」→ 编辑器打开。
2. **编辑镜头**：在「按用途选镜头」目录选配方卡（文字/对比/时间轴），填输入点「添加到项目」；3D 镜头在镜头编辑卡的组件模板下拉选「3D 场景」并应用。
3. **加转场**：在「转场」区选边界，下拉选「淡入淡出」+ 时长；借帧窗口摘要即时显示。
4. **预览横竖**：预览区「横版/竖版」按钮切换。
5. **保存重开**：「保存」→ 刷新 → 项目列表「打开」→ 镜头与转场全在。
6. **导出 MP4**：「生成无声横竖版 MP4」→ 下载链接 ×2。
7. **导出交互页**：在「交互页镜头」选择 3D 镜头，点击「导出交互页（3D 镜头）」；页面离线可打开。CLI `node scripts/video/t3-export-interactive.mjs --project <json> --out <dir>` 仍供批处理使用。
8. **核对交付记录**：导出 JSON 中 `renderRecords`（渲染记录）与 `deliveries`（交付记录）自动追加。

## 四态

1. **代码实现**：T1–T4 全部完成（详见各自报告）；T5 为端到端串联验证。
2. **自动回归**：video-scene 189/189、video-document 163/163、web 311/311、three 26/26、edit-list 14/14、typecheck、Biome、qa validate **112 自动/56 手工**（VID-056~060 五条新链）。
3. **真实浏览器与导出**：`e2e-t5-experience.mjs`（VID-060）——创建→四个配方/模板镜头→加转场→双画幅预览→保存重开→真实 MP4 出片→项目 JSON 导出→CLI 交互页导出，全链 exit 0。
4. **视觉质量**：T4 新布局关键帧结构清晰（对比面板/时间轴节点可辨识）；**人工审片待人工**。

## 增量复核单（给 Codex）

| 项 | 提交 | 关键文件 | 复跑 |
| --- | --- | --- | --- |
| T1 竖版 3D 取景 | orbit3d@2 | `three/components/orbit3d.mjs`、`three/harness.js`、`three-templates.ts` | `node scripts/video/t1-portrait-3d-verify.mjs` |
| T2 转场编辑 | 借帧摘要 | `page.tsx` 转场区 | `BASE_URL=:PORT node scripts/video/e2e-transitions-editor.mjs` |
| T3 交互页导出 | CLI | `t3-export-interactive.mjs`、`w4-interactive/app.js` | `node scripts/video/e2e-t3-interactive-export.mjs` |
| T4 新布局 | 双组件 | `compare-split.ts`、`timeline-milestones.ts`、`shot-recipes.ts` | `node scripts/video/t4-layout-demo.mjs` |
| T5 体验链 | e2e | `e2e-t5-experience.mjs` | `BASE_URL=:PORT node scripts/video/e2e-t5-experience.mjs` |

## 仍未验证

- 人工审片（T4 布局、W2 三套对照、W4 真机触屏/读屏器——沿既有挂账）
- C2/W5 编辑器真实往返（待许可编辑器）
- C4 Blender GPU 设备归因
