# C3 交付报告：W4 交互页触屏、可访问性与性能口径（2026-10-25）

分支 `claude/video-studio-closure`（基于 C2 提交）。任务源：交接单 §C3。证据：`artifacts/video-studio-w4-2026-10-24/`（`c3-report.json`、`touch-drag.png`、`touch-exploded.png`、`headed-gpu.png`）。约束全部保留：自包含（重建后 **545,532 字节 / 8 MiB**）、零网络依赖（file:// 打开）、iframe 可嵌、重建逐字节一致（旧 e2e 断言仍过）。

## 用触屏模拟实测发现并修复的真实问题（`scripts/video/w4-interactive/app.js`）

1. **spins 累计恒为 0**：`state.spins += |clientX - lastX|` 在基准已更新之后取值，恒加 0——真实缺陷，触屏拖转 e2e 断言实测抓住。
2. **无 pointerId 追踪**：第二指落下会劫持/跳动旋转。修复为单指追踪，第二指的移动被忽略（e2e：finger1 按住时 finger2 移动，rotationY 逐毫秒不变）。
3. **无 pointercancel 处理**：滚动手势接管触摸后 dragging 卡死、自动旋转永久停止。修复：touchCancel → 结束拖转，e2e 断言取消后 450ms 内 rotationY 恢复自增。
4. **双击拆解依赖 dblclick 合成事件**：触摸路径不可靠。改为 pointerdown 统一检测（鼠标/触摸/手写笔同一管线），并修两处自产的配对缺陷：三连击连续翻转（一对完成即复位）；复位用 `-Infinity` 而非 `0`（纪元配对：页面加载后 350ms 内的首击会与 t=0 配对——旧 e2e 的快速截图流程实测触发，回归门禁抓住）。
5. `touch-action: none`（W4 已有）保留。

## 可访问性（键盘/焦点/可读名称/状态反馈）

- `#stage`：`role="group"` + `tabindex="0"` + 中文 `aria-label`（含操作说明）；`:focus-visible` 金色描边。
- 键盘：方向键转动（Enter/Space 拆解）；修饰键组合不拦截。
- 状态播报：页内视觉隐藏 `role="status" aria-live="polite"`（"已拆解/已合拢/已转动"）；页面提示文字同步经 `w4:state` CustomEvent（不再只挂 dblclick）。
- e2e 断言：tabindex/aria-label/role/live 区存在；方向键转动（rotationY 实测增加）；Enter 合拢、Space 拆解；播报文本与状态同步。

## 性能口径（可复跑：`node scripts/video/e2e-w4-touch-a11y.mjs`，写入 `c3-report.json`）

| 口径 | 首次加载 | 帧率（2s rAF 采样） | WebGL 渲染器（实测字符串） |
| --- | --- | --- | --- |
| 无头软件渲染 | 127-128 ms | 60.5 fps | ANGLE (Google, Vulkan 1.3.0 (**SwiftShader** Device (Subzero)), SwiftShader driver) |
| 有头桌面 GPU | 245-484 ms | 56.5-57 fps | ANGLE (NVIDIA, **GeForce RTX 4060** Direct3D11 vs_5_0 ps_5_0, D3D11) |
| 真机触屏 | — | — | **未测（无设备，如实保留）** |

资源体积 545,532 B（资产清单 `asset-manifest.json` 同步更新）；离线 file:// 加载；测量本身零联网。注：有头口径加载时间含 GPU 着色器首编译，波动大于无头属正常。

## 四态

1. **代码实现**：完成（app.js 触屏/键盘/播报；构建模板 a11y 属性与样式；两套 e2e）。
2. **自动回归**：新 e2e `scripts/video/e2e-w4-touch-a11y.mjs`（触屏 CDP 拖转/双触/取消/多指 + 键盘 + a11y + 双口径性能，RED→GREEN，修后 3 次复跑 PASS）；旧 e2e `e2e-w4-interactive.mjs` 回归 PASS ×3（含重建逐字节一致断言）；Biome 通过。
3. **真实浏览器**：触摸管线走 CDP `Input.dispatchTouchEvent`（真触摸事件而非鼠标模拟）；有头 GPU 实测开着真实窗口跑（截图 `headed-gpu.png`）。
4. **视觉质量**：截图 3 张留证（拖转/拆解/GPU 口径）；主观审美仍为演示级程序化渲染（与 W4 口径一致，非商品写实）。

## 限制（如实）

1. **真机触屏未测**：无设备。触屏覆盖来自 Chromium 触摸管线模拟（hasTouch 上下文 + CDP 触摸事件），真实设备的指压面积、惯性滚动、系统手势边界未覆盖。
2. 屏幕阅读器实测未做：aria 结构与播报文本已就位并通过 DOM 断言，但未用 NVDA/VoiceOver 实机过一遍（待人工）。
3. 性能数字是单机单次环境样本（复跑命令可再取）；56-60 fps 对该场景已非瓶颈，未做优化专项。
4. 帧率阈值沿用旧 e2e 的 ≥15fps（无头口径）；新 e2e 记录实测值不设阈值断言（避免环境噪声导致假红）。
