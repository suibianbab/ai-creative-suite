# Video Studio 双画幅预览与镜头级画幅微调（2026-10-23）

对应交接单：`artifacts/video-studio-next-dual-aspect-edit-brief.md`（2026-10-22，基于 main `226a488`）。
实施计划：`docs/superpowers/plans/2026-10-23-video-studio-dual-aspect-edit.md`。分支 `video-studio/dual-aspect-edit`（9+ 提交）。

## 交付范围

**A. 双画幅预览**：单镜（规划卡）与整片预览新增横/竖版切换与「安全区」辅助线开关。预览画布坐标与出片完全一致（`EXPORT_DIMENSIONS` 1280×720 / 720×1280、24 fps、量化 span 帧数——单镜走 `singleShotSpanFrames`，与 remotion metadata 同推导），显示尺寸仅由 CSS 缩放（竖版 72vh 限高）。媒体裁切按出片画幅传 `mediaClipCss`，字幕药丸按画幅分支与 `TimelineScene` 同比例换算。辅助线 10% 口径与组件 `safeFrame` 同源（`safeFrameRect`），仅存在于预览 DOM。

**B. 同一镜头的可选画幅微调**：`SceneSpec` 顶层可选字段 `layout: { portrait?, landscape? }`，归属同一镜头内容版本、经既有 `reviseWorkingVersion`→保存/回滚链路管理，不复制镜头、不建第二时间线。
- 文字镜头：`titleLines` 显式换行（拼接须与标题一致、空白不敏感）、`titleScale` 0.5–1.3、`verticalOffset` ±0.25；缩放后统一钳回安全文字宽。
- 折线镜头：`labelStep` 显示间隔（首末点恒显）与 `shortLabels` 逐项短标签（原样显示、绕过既有 >6 字截断）；数据值与未覆写标签行为不变。
- 校验：容器形状由 `validateSceneSpec` 把关，字段形状由组件新增的可选 `validateLayout` 深度校验；不支持覆写的组件带 `layout` 会**明确拒绝**（不静默忽略）。无 `layout` 的旧 spec 渲染逐字节不变（deepEqual 回归钉住）。
- 工作台：「画幅微调」区块（竖/横页签）随「应用修订」落库；折线图即时列出被隐藏/截断/简写的标签（与渲染共用 `lineChartLabelDisplay` 口径）；改内容后旧覆写失效会被校验拦下提示重设；换模板清空覆写（新视觉基底）。

**C. 配套**：出片干跑门按项目画幅逐画幅执行（竖版专属布局问题不再漏检）；出片常量收口 `@acs/video-document`（`EXPORT_FPS`/`EXPORT_DIMENSIONS`），脚本侧由跨源一致性测试钉住。

## 验证与证据

| 线 | 命令 | 结果 |
| --- | --- | --- |
| video-scene | `pnpm --filter @acs/video-scene test` | 165/165（新增 layout 契约 7、文字覆写 6、折线覆写 6、safeFrameRect 2） |
| video-document | `pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test` | 155/155（新增 aspect 常量 3） |
| web | `pnpm --filter @acs/web test` | 266/266（新增 aspect-layout-edit 9、singleShotSpanFrames 2） |
| scripts | `node --test scripts/video/frame-dryrun.test.mjs scripts/video/render-scene.props.test.mjs` | 15/15（跨源一致性 1、干跑画幅 1） |
| 静态 | `pnpm -r typecheck`；`pnpm exec biome check .` | 全过 / 零告警 |
| QA 注册表 | `node scripts/qa/run-regression.mjs validate` | 91 automated / 53 manual |
| 真实浏览器 | `node scripts/video/e2e-dual-aspect-edit.mjs`（VID-036，dev :3210） | PASS：编辑→保存→刷新重开→导出断言 + SVG 级横竖独立生效断言 |
| 真实出片 | `node artifacts/video-studio-dual-aspect-edit-2026-10-23/audit-exports.mjs`（VID-035） | PASS：双变体双画幅 MP4、64 帧安全区零越界、8+8 条渲染记录 |

证据目录 `artifacts/video-studio-dual-aspect-edit-2026-10-23/`：预览冒烟截图（`smoke-*`）、e2e 前后截图与项目 JSON（`before/after-portrait*`、`export.video-project.json`）、真出片四条 MP4 与审计（`render-*/`、`export-audit.json`、`safe-frame-report.json`）、人工审片关键帧（`keyframes/`）与结论（[REPORT.md](../artifacts/video-studio-dual-aspect-edit-2026-10-23/REPORT.md)，安全区抽检与人工审片分节陈述）。

## 已知限制

- 覆写组件仅 `text-animation` / `line-chart`（brief 裁定先做真实压力案例）；扩展到其他图表组件需按同契约加 `validateLayout`。
- `titleScale` 放大有安全宽钳制，但极端排版（超大字号 + 副标题）仍可能局促，需另做镜头设计。
- 安全区合格 ≠ 美术成片质量；标签取舍、留白、动效节奏仍需逐镜审片（见 REPORT 人工审片节）。
- 浏览器「生成横竖版 MP4」路由仍为本地开发环境受控路径，非生产承诺（沿 P4 口径）。

## 合并

分支 `video-studio/dual-aspect-edit` 基于主检出 `226a488`。按工作树边界惯例，合并由用户在主检出执行：

```
git -C D:/codex/animate merge --ff-only video-studio/dual-aspect-edit
```
