# P1-A 端到端闭环验收记录（真实工作台链路）

- 日期：2026-10-17
- 执行人：Claude（整改会话）
- 脚本：`scripts/video/e2e-closed-loop.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210）· playwright-core 1.64.1 headless Chromium · Remotion 4.0.534（Chrome 155.0.8059.41）

## 链路

浏览器（`/video-studio`）新建项目 → 填写「做一个4秒的文字动画，标题是闭环验收，副标题是E2E」→ 规划 → 确认卡（内容预告点名标题）→ 确认应用 → 保存（v2）→ **导出项目 JSON**
→ CLI `node scripts/video/render-scene.mjs --project <导出件> --out artifacts/video-studio-e2e/render`（双画幅出片，RenderRecord ×2 回写，savedVersion +1）
→ 浏览器返回列表 → **导入项目 JSON** → 编辑器显示「已导入 …（v3）」与渲染记录（1280×720、720×1280 各一条）→ 返回列表显示 v3。

## 结果（退出码 0）

- 项目 ID `3533c10a-b9f4-47e0-9b51-b6afbc3ca870` 贯穿浏览器↔CLI↔浏览器全程不变；内容版本 `cdbc4242-5440-4379-b34f-86bad123bdc9` 未被改写。
- 版本链：工作台保存 v2 → CLI 回写 v3（append-only：renderRecords 0→2，shots 不变）→ 导入快进接受，本地 v2 快照保留。
- 渲染记录在工作台 UI 可见（`render-records` 区块，两条：1280×720 与 720×1280，各 96 帧 @24fps，h264）。
- 控制台门禁：首次运行失败，暴露真缺陷——`SvgTree` 把 SvgNode 的 kebab-case SVG 属性（`font-size`/`text-anchor`/`dominant-baseline`）原样传给 React `createElement`，每帧刷 Invalid DOM property 错误。修复（`react-svg-attrs.ts`，含单元回归 `react-svg-attrs.test.ts`）后重跑，控制台零错误。
- 命令输出（`run.log`，本地）：

```
[e2e-closed-loop] 去程完成: 项目 3533c10a-b9f4-47e0-9b51-b6afbc3ca870 v2
[e2e-closed-loop] CLI 完成: v3，RenderRecord ×2
[e2e-closed-loop] OK: 项目 3533c10a-b9f4-47e0-9b51-b6afbc3ca870 贯穿全程，工作台 v2 → 导入 v3，渲染记录可见
```

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`exported.video-project.json`（浏览器导出件，导入前后字段可比对）、`render/render-manifest.json`、`render/props-*.json`、脚本本身。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256 |
| --- | --- |
| render/landscape.mp4 | `3deed94613b78ff0bf49136a109be51a1ca26cc526bd10cf9d764011e70ce607` |
| render/portrait.mp4 | `d0e59d4bbb26a7f0f76df7997f41d83d6ef68f065f961986787595352d1cb7e0` |
| imported-editor.png | `4d3fec437a9ca70c72c2e20d5cbef820ebed416024907ce20fe86edeeaabc2ec` |

复跑方式（需本地起 dev server 与 Playwright Chromium）：

```
PORT=3210 pnpm --filter @acs/web dev
node scripts/video/e2e-closed-loop.mjs
```
