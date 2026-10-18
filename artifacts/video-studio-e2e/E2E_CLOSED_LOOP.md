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

最新运行（reactSvgAttrs 归一到 @acs/video-scene 之后复验，2026-10-17）：

- 项目 ID `8b71ff54-568f-473a-8d6a-c28dfa112afb` 贯穿浏览器↔CLI↔浏览器全程不变；内容版本 `a6d439bc-ce6f-41f0-a18d-4f1244fad703` 未被改写。
- 版本链：工作台保存 v2 → CLI 回写 v3（append-only：renderRecords 0→2，shots 不变）→ 导入快进接受，本地 v2 快照保留。
- 渲染记录在工作台 UI 可见（`render-records` 区块，两条：1280×720 与 720×1280，各 96 帧 @24fps，h264）。
- 控制台门禁：首次运行失败，暴露真缺陷——`SvgTree` 把 SvgNode 的 kebab-case SVG 属性（`font-size`/`text-anchor`/`dominant-baseline`）原样传给 React `createElement`，每帧刷 Invalid DOM property 错误。修复（`react-svg-attrs`，含单元回归）后重跑，控制台零错误；归一重构（属性转换移入 `@acs/video-scene`，两座桥共用）后再次复验，仍零错误。
- 输出不变性：同一句话→同一种子→同一 spec，重构前后两次运行的 landscape/portrait MP4 与截图 SHA-256 逐字节一致（见下表）——React 驼峰属性与 kebab 透传落到 DOM 是同一个 `font-size`，渲染结果不因适配层归一而改变。配套确定性双渲染检查（`pnpm qa:video-determinism`）亦复验通过（72/72 帧解码像素逐帧一致）。
- 命令输出（`run.log`，本地）：

```
[e2e-closed-loop] 去程完成: 项目 8b71ff54-568f-473a-8d6a-c28dfa112afb v2
[e2e-closed-loop] CLI 完成: v3，RenderRecord ×2
[e2e-closed-loop] OK: 项目 8b71ff54-568f-473a-8d6a-c28dfa112afb 贯穿全程，工作台 v2 → 导入 v3，渲染记录可见
```

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`exported.video-project.json`（浏览器导出件，导入前后字段可比对）、`render/render-manifest.json`、`render/props-*.json`、脚本本身。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256 |
| --- | --- |
| render/landscape.mp4 | `3deed94613b78ff0bf49136a109be51a1ca26cc526bd10cf9d764011e70ce607` |
| render/portrait.mp4 | `d0e59d4bbb26a7f0f76df7997f41d83d6ef68f065f961986787595352d1cb7e0` |
| imported-editor.png | `e5a3f018bd0d0df30419a1394d026ce7003a7a66cb05f88491c64a22dd78e038` |

2026-10-18 复跑备注（e2e 客户端就绪修复的验证运行）：全链路一次通过；两片 MP4 与上表 SHA **逐字节一致**（跨运行确定性再次实证，UUID 不进渲染路径）；`imported-editor.png` 因项目列表状态不同（历次 e2e 累积的项目条目）刷新为上表新值；`exported.video-project.json` / `render-manifest.json` 随新运行刷新（新项目 UUID 与时间戳，属预期）。

2026-10-18 二次复跑备注（locked 末条裁定 + 分镜追加语义整改后的回归运行）：全链路一次通过；两片 MP4、`imported-editor.png` 与上表 SHA **全部逐字节一致**（本机复算）；`exported.video-project.json` / `render-manifest.json` 随新运行刷新（新项目 UUID，属预期）。本次运行同时证明 evolve 校验收紧（末条裁定）未破坏单镜头保存路径。

2026-10-18 三次复跑备注（字幕轨终评整改后回归）：全链路一次通过；两片 MP4 与上表 SHA 仍逐字节一致（无旁白/无字幕路径不受 cue 构建改动影响）；exported.video-project.json / render-manifest.json 随新 UUID 刷新（属预期）。

复跑方式（需本地起 dev server 与 Playwright Chromium）：

```
PORT=3210 pnpm --filter @acs/web dev
node scripts/video/e2e-closed-loop.mjs
```
