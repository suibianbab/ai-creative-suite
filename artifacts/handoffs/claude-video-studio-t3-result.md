# T3 交付报告：从真实项目导出交互 3D 页（2026-10-25）

分支 `claude/video-next-batch`。任务源：§T3。证据：`.tools/t3-export-e2e/`。

## 实现

- **`scripts/video/t3-export-interactive.mjs`**：CLI 导出器——项目 JSON + three 镜头（`--shot` 可选或自动找首个）→ 封闭注册表校验（拒绝未注册组件/参数）→ 从工作版本 spec 提取 shape/color/accent/tilt/spinPerFrame → esbuild IIFE 内联 three → 自包含 `index.html`（≤8MiB、SHA-256 入账、asset-manifest 记录来源项目与镜头、许可、重建命令）。
- **`scripts/video/w4-interactive/app.js` 扩展**：`createApp` 新增 `shape`（box/sphere/torus/icosahedron，与 orbit3d createGeometry 同形状集）、`tilt`（初始倾角）、`spinPerFrame`（自转速率，帧率换算）参数——W4 演示页不传时回落原行为（字节近似但非逐字节——新增代码导致 bundle 尺寸变化 548155 vs 545675，功能回归全绿）。
- **`scripts/video/e2e-t3-interactive-export.mjs`**（VID-058）：真实 T1 orbit3d@2 box 项目 → 导出 → 离线 file:// 开 → 双击/回车拆解、拖转、拖后单击不误拆、aria 播报、iframe 嵌入 → 重建逐字节一致。

## 四态

1. **代码**：完成（导出器 ~120 行 + app.js 参数化 ~20 行 + e2e ~130 行）。
2. **自动回归**：T3 e2e exit 0；W4 基线 e2e exit 0（含触屏/键盘/aria/离线/iframe/重建一致）；W4 touch-a11y e2e exit 0；qa validate 110/56。
3. **真实操作**：从 T1 真实项目（orbit3d@2、box、#4f9dff/#e8b04b、tilt 0.35、spin 0.02）导出 548KB 自包含页；离线打开、交互全套验证通过；主体参数与项目一致（manifest 对照 + aria-label 断言）。
4. **视觉**：演示级 3D（标准材质+双灯，非写实商品广告——不宣称）。

## 已知限制

- 导出为 CLI（`node scripts/video/t3-export-interactive.mjs --project <json> --out <dir>`），工作台 UI 按钮待后续（导出链与现有 export-gif/export-shot-svg CLI 同模式）。
- 交互运行时形状集只覆盖 orbit3d 的四种（未来组件新形状需扩展 app.js 的 `shapeGeometries` 映射）。
- 拆解动画（内核弹出）保持 W4 演示语义，不与项目出片动画对齐。
