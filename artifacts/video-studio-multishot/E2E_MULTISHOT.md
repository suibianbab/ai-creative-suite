# P1 多镜头端到端闭环验收记录（真实工作台链路）

- 日期：2026-10-18
- 执行人：Claude（P1 多镜头第一刀会话）
- 脚本：`scripts/video/e2e-multishot.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210）· playwright-core headless Chromium · Remotion 4.0.534（系统 Chrome 155）· ffprobe 元数据核对

## 链路

浏览器（`/video-studio`）新建项目 → 填写「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划 → **分镜确认卡**（4 镜头预告：开场点名标题「水循环」、要点/模板示意中镜头、结语）→ 确认应用（**追加** 4 镜头）→ 镜头时间线（4 个 span @24fps）+ 整片预览 → 保存（v2）→ **导出项目 JSON**
→ CLI `node scripts/video/render-scene.mjs --project <导出件> --out artifacts/video-studio-multishot/e2e-render`（**逐帧干跑门禁 192 帧全过后**，Timeline-* 合成单文件整片双画幅出片，RenderRecord ×8 回写，savedVersion +1）
→ 浏览器返回列表 → **导入项目 JSON** → 编辑器显示「已导入 …（v3）」、镜头时间线（4 张镜头卡）与渲染记录（横竖各 4 条，1280×720/720×1280）→ 返回列表显示 v3。

## 结果（退出码 0；两次完整运行均一次通过，第二次为收口回归时复跑）

- 项目 ID `933899a4-f03d-4c30-9eba-888970ae9daa` 贯穿浏览器↔CLI↔浏览器全程不变；4 个内容版本 ID 全部未被改写（脚本逐一断言）。
- 版本链：工作台保存 v2 → CLI 回写 v3（append-only：renderRecords 0→8，shots 不变）→ 导入快进接受。
- 整片量化帧图：4 镜头 × 2000ms @24fps → 48+48+48+48 = 192 帧连续无缝；ffprobe 核对横竖两片均为 h264、192 帧、24fps、时长 8.00s。
- 渲染记录在工作台 UI 可见：8 条（4 镜头 × 2 画幅），frames 与量化 span 一致（48/条）。
- 控制台门禁：全程零 error。
- 命令输出（复跑可见，`run.log` 本地）：

```
[e2e-multishot] 去程完成: 项目 933899a4-f03d-4c30-9eba-888970ae9daa v2，4 镜头 Σ8s
[e2e-multishot] CLI 完成: v3，RenderRecord ×8（4 镜头 × 2 画幅）
[e2e-multishot] OK: 项目 933899a4-f03d-4c30-9eba-888970ae9daa 贯穿全程，v2 → v3，4 镜头整片（横竖）出片，RenderRecord×8 可见
```

## 配套回归

- **单镜头输出不变性**：Timeline 合成是 SceneSpec 渲染的重构超集，用 P0 冒烟项目（N=1）抽样帧 0/36/71 解码像素对比，P0 `SceneSpec-Landscape` 与 P1 `Timeline-Landscape` 输出 **PIXEL-IDENTICAL**（`decodeFrameHash` 逐帧一致）——重构未改变单镜头渲染结果。
- **干跑门禁**：`render-scene` 渲染前对 4 镜头 × 全帧跑 worker 隔离干跑（本片 192 帧全过）；门禁本身的超时击杀/逐帧报错/混合批隔离由 `scripts/video/frame-dryrun.test.mjs`（VID-008）覆盖。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（CLI 回写后的项目件，shots/renderRecords/savedVersion 字段可比对）、`e2e-render/render-manifest.json`（含逐镜头 frameMap 与内容指纹）、`e2e-render/props-{landscape,portrait}.json`（Timeline props）、脚本本身、QA 条目 VID-008/VID-009。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（第二次运行，盘上现状） |
| --- | --- |
| e2e.video-project.json | `8df57085cea7c64f29e887b65480e7f6c858a20a271cdd55394c93732bd0975e` |
| e2e-render/landscape.mp4 | `e4df78e972fe802d6f2818fce1bf44022d9e2a6e8e9cc89ec7718d5ae26aace3` |
| e2e-render/portrait.mp4 | `85bac1b82a8e5988f69faf85de761545ef747d7805099384fda83eaa606ba499` |
| multishot-editor.png | `44ef87a5d8e2f9b72b6c2f55b67ffb6bca6a3cefcd9c0ddc926ba14b15bfcc7f` |

**跨运行确定性（本机复核）**：两次完整独立运行（项目 ID 分别为 `933899a4-…` 与 `01650859-…`，全部 UUID 不同）的 landscape/portrait MP4 SHA-256 **逐字节一致**（即上表两值，两次运行相同）——同一句话→同一种子→同一 spec→同一像素，UUID 不进入渲染路径。项目 JSON 与截图因内嵌新 UUID/预览相位而不同，属预期。

复跑方式（需本地起 dev server 与 Playwright Chromium；每次复跑项目 ID 会变，帧数与记录结构应一致）：

```
PORT=3210 pnpm --filter @acs/web dev
node scripts/video/e2e-multishot.mjs
```
