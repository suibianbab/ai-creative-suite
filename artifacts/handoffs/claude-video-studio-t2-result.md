# T2 交付报告：工作台转场编辑与预览（2026-10-25）

分支 `claude/video-next-batch`。任务源：§T2。证据：`.tools/video-t2-transitions-e2e/`（e2e 产物）+ `qa/registry.json` VID-057。

## 实现

- **借帧窗口摘要**（`page.tsx` 转场编辑器区）：每个 fade 行显示 `借帧 左尾 N + 右头 M＝K 帧（全局第 X–Y 帧叠黑；{durationMs}ms）`——数据来自 `previewTransitionWindows`（预览/出片同一 helper），零第二套帧数学。`transition-borrow-summary` CSS。
- **e2e** `scripts/video/e2e-transitions-editor.mjs`（VID-057）：入库 STEM 转场项目（bible 先导）→ 新增 boundary 2 fade（借帧摘要可见且数字正确）→ 调时长 800ms（摘要联动）→ 开 boundary 1 → 保存刷新重开（三种 fade 持久）→ 删 boundary 1 → 导出断言两条 → 真实双画幅无声出片 → 三窗口各前/中/后帧抽取 → v2 清单 transitions 与 render-manifest 窗口**逐字段对账**（boundary/startFrame/frames/halfOut/halfIn）。

## 四态

1. **代码**：借帧摘要行（~30 行 JSX + 1 行 CSS）；无 schema/渲染改动。
2. **自动回归**：web 311/311（既有转场草稿/预览测试全绿）；qa validate 109/56。
3. **真实浏览器**：e2e exit 0（五轮迭代修复选择器/导入流——filechooser 事件替代双 file-input 歧义、bible 先导、style-bible 参数、去 narration）。
4. **视觉**：转场帧已抽（transition-b{0,1,2}-{pre,mid,post}.png）；人工审片待人工（结构对账已完成）。

## 已知限制

- 预览叠层是同步黑幕近似（与出片同帧数学同斜率）；帧精确合成以出片为准（既有 editor-hint 文案已声明）。
- 无声渲染（转场项目经浏览器编辑后版本 ID 变化，旁白 WAV 与版本寻址不匹配——有声出片须重新合成或走复用链路，不在本项范围）。
