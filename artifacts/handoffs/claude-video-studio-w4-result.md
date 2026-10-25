# W4 交付报告：一主体一交互 Web 3D 样片（2026-10-24）

分支 `claude/video-studio-w2-w5`（W4 段）。需求源：交接单 §W4。证据：`artifacts/video-studio-w4-2026-10-24/`。

## 交付

- **自包含交互页** `interactive/index.html`（**531 KiB / 8 MiB 上限内**，未放宽原格式约束）：一主体（演示立方体：蓝色主体 + 金色二十面体内核 + 线框外壳，全程序化）、两处交互（拖拽转动；双击拆解/合拢——状态变化）。three@0.186.1（MIT）经 esbuild IIFE 内联，零网络依赖。
- **可编辑源**：`scripts/video/w4-interactive/app.js`（运行时入口）+ `scripts/video/w4-interactive-build.mjs`（构建与资产清单）——重建**逐字节一致**（e2e 断言）。
- **资产清单** `interactive/asset-manifest.json`：路径、SHA-256、字节、来源、许可（three MIT；几何/页面自有程序化）。
- **e2e** `scripts/video/e2e-w4-interactive.mjs`（VID-052）。

## 四态报告

1. **代码实现**：完成（构建脚本 + 运行时入口 + e2e；无产品代码改动——W4 是交付样片验证）。
2. **自动回归**：e2e exit 0；104 自动 / 56 手工注册校验通过。
3. **真实浏览器**：离线 `file://` 打开 ✓；双击拆解 `data-exploded` 翻转 + 截图留证（`exploded.png`）；拖转 `data-rotated` ✓；1 秒 rAF 采样 ≥15fps（无头 SwiftShader 下实测达标）✓；iframe 嵌入宿主可交互 ✓（`iframe-embedded.png`）；重建哈希一致 ✓。
4. **视觉质量**：演示级程序化渲染（标准材质 + 双灯），非商品写实；移动端真机未测（限制如实）。

## 已知限制

1. 帧率阈值 15fps 是无头软件渲染口径；真机 GPU 会显著更高，但**未做真机检查**。
2. 交互为桌面指针事件（pointer 系）；触屏语义未单独验证。
3. 主体是程序化演示物（零授权风险），非真实商品——「产品转动/拆解」的商用质感需真实资产与打光，超出本轮。
