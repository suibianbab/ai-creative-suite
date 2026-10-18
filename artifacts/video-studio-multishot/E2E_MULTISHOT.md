# P1 多镜头端到端闭环验收记录（真实工作台链路）

- 日期：2026-10-18
- 执行人：Claude（P1 多镜头第一刀会话）
- 脚本：`scripts/video/e2e-multishot.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210）· playwright-core headless Chromium · Remotion 4.0.534（系统 Chrome 155）· ffprobe 元数据核对

## 链路

浏览器（`/video-studio`）新建项目 → 填写「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划（**语速感知时长**：等分 vs 语速估计 400+300×字数 取大者 → [2000,3100,2000,2000] Σ9100ms，秒数是目标非承诺）→ **分镜确认卡**（4 镜头预告：开场点名标题「水循环」、要点/模板示意中镜头、结语）→ 确认应用（**追加** 4 镜头）→ 镜头时间线（4 个 span @24fps）+ 整片预览 → 保存（v2）→ **导出项目 JSON**
→ CLI `node scripts/video/render-scene.mjs --project <导出件> --out artifacts/video-studio-multishot/e2e-render`（**逐帧干跑门禁 192 帧全过后**，Timeline-* 合成单文件整片双画幅出片，RenderRecord ×8 回写，savedVersion +1）
→ 浏览器返回列表 → **导入项目 JSON** → 编辑器显示「已导入 …（v3）」、镜头时间线（4 张镜头卡）与渲染记录（横竖各 4 条，1280×720/720×1280）→ 返回列表显示 v3。

## 结果（退出码 0；speech-aware 规划落地后（字幕轨 T3/T7）复跑一次通过）

- 项目 ID `f6d78487-1ca4-4226-88c1-97635e1bb656` 贯穿浏览器↔CLI↔浏览器全程不变；4 个内容版本 ID 全部未被改写（脚本逐一断言）。
- 版本链：工作台保存 v2 → CLI 回写 v3（append-only：renderRecords 0→8，shots 不变）→ 导入快进接受。
- 整片量化帧图：4 镜头 [2000,3100,2000,2000]ms @24fps（speech-aware）→ 48+74+48+48 = 218 帧连续无缝；ffprobe 核对横竖两片均为 h264、218 帧、24fps、时长 9.08s；脚本断言 Σspan = 9100ms。
- 渲染记录在工作台 UI 可见：8 条（4 镜头 × 2 画幅），frames 与量化 span 一致（48/条）。
- 控制台门禁：全程零 error。
- 命令输出（复跑可见，`run.log` 本地）：

```
[e2e-multishot] 去程完成: 项目 f6d78487-1ca4-4226-88c1-97635e1bb656 v2，4 镜头 Σ9.1s（speech-aware）
[e2e-multishot] CLI 完成: v3，RenderRecord ×8（4 镜头 × 2 画幅）
[e2e-multishot] OK: 项目 f6d78487-1ca4-4226-88c1-97635e1bb656 贯穿全程，v2 → v3，4 镜头整片（横竖）出片，RenderRecord×8 可见
```

## 配套回归

- **单镜头输出不变性**：Timeline 合成是 SceneSpec 渲染的重构超集，用 P0 冒烟项目（N=1）抽样帧 0/36/71 解码像素对比，P0 `SceneSpec-Landscape` 与 P1 `Timeline-Landscape` 输出 **PIXEL-IDENTICAL**（`decodeFrameHash` 逐帧一致）——重构未改变单镜头渲染结果。
- **干跑门禁**：`render-scene` 渲染前对 4 镜头 × 全帧跑 worker 隔离干跑（本片 192 帧全过）；门禁本身的超时击杀/逐帧报错/混合批隔离由 `scripts/video/frame-dryrun.test.mjs`（VID-008）覆盖。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（CLI 回写后的项目件，shots/renderRecords/savedVersion 字段可比对）、`e2e-render/render-manifest.json`（含逐镜头 frameMap 与内容指纹）、`e2e-render/props-{landscape,portrait}.json`（Timeline props）、脚本本身、QA 条目 VID-008/VID-009。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18 字幕轨收口复跑，speech-aware 后终值） |
| --- | --- |
| e2e.video-project.json | `e1a34b8af84e1f462c8d979cba465ffec94b1e751b39b5fd9ea7f41735ebb3ab` |
| e2e-render/landscape.mp4 | `bbda0997f8038e6b9b751e0528e9839ede2bb63612b1dc81636502db156e9f0f` |
| e2e-render/portrait.mp4 | `b1849dd5ab1d0391dbc574a23bdbf3bdba8e7327679810f90ae949d48bb5127a` |
| multishot-editor.png | `a15f424a765c0241315ad5907f14dd2ed26feb149fd5f5cc28f537477ba313ee` |

**2026-10-18 复跑备注（复核整改后的回归运行）**：locked 末条裁定 + 分镜追加语义（brief.applications 快照）落地后全链路一次通过；两片 MP4 与彼时表值 `e4df78e9…`/`85bac1b8…` **逐字节一致**（第 4 次跨运行实证——复核修复不进渲染路径）；项目 JSON 因 brief 新增 applications 快照与新 UUID 刷新、截图因预览相位刷新（均属预期，已取新值入表）。

**2026-10-18 第三轮复跑备注（brief.applications 数据契约，commit `1bfe025`）**：validate 导入格式校验 + evolve 只追加校验落地后同日再跑两次（项目 ID `7bdb4bd0-…`、`35f59255-…`），全链路一次通过——分镜应用（写 applications）→ 浏览器保存 v2 → CLI 再保存 v3（过新只追加检查）→ 导入（过新格式校验）全程无阻；产物 json 中 `brief.applications` 条目完整落档（appended*/film*After/appliedAt 齐全）。两片 MP4 仍逐字节一致（跨运行一致实证累计至第 6 次——校验代码不进渲染路径）；JSON/截图哈希随新 UUID/预览相位刷新，表中取最后一次运行值。

**2026-10-18 第四轮复跑备注（字幕轨收口，speech-aware 规划落地）**：分镜规划器改为语速感知时长（等分 vs 400+300×字数 取大者）后同句复跑，项目时长 8000→9100ms（要点镜头 2000→3100ms）——两片 MP4 哈希**合法变化**（`e4df78e9…`/`85bac1b8…` → 上表新值），变的是时长数据（帧数 192→218）而非引擎行为；引擎不变性由字幕轨 T2 的第 7 次复跑独立证明（无字幕 props 时 MP4 与旧值逐字节不变，见下段）。脚本硬断言随规划语义更新为 Σ9100ms；项目 JSON/截图因新 UUID 与预览相位刷新（属预期，已取新值入表）。

**跨运行确定性（本机复核）**：speech-aware 落地前，七次完整独立运行（项目 ID 各不相同）的 landscape/portrait MP4 SHA-256 **逐字节一致**（`e4df78e9…`/`85bac1b8…`，七次相同，其中第 7 次为字幕轨 T2 无字幕 props 的回归复跑）——同一句话→同一种子→同一 spec→同一像素，UUID 不进入渲染路径；预览侧修复（fps 对齐、spec 安全解析）与字幕轨的 cues 构建纯函数均不触碰无字幕渲染路径，哈希不变即为佐证。speech-aware 之后（第 8 次）哈希随时长数据变化，属上述合法演进。项目 JSON 与截图因内嵌新 UUID/预览相位而不同，属预期，表中取收口运行值（复跑会更新盘上文件）。

复跑方式（需本地起 dev server 与 Playwright Chromium；每次复跑项目 ID 会变，帧数与记录结构应一致）：

```
PORT=3210 pnpm --filter @acs/web dev
node scripts/video/e2e-multishot.mjs
```
