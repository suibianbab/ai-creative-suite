# P1 导出扩充端到端验收记录（整片 GIF + 单镜头 SVG，零 TTS 计费）

- 日期：2026-10-18
- 执行人：Claude（P1 导出扩充会话）
- 脚本：`scripts/video/e2e-export.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · Remotion 4.0.534（系统 Chrome 155）· ffmpeg/ffprobe（winget 安装）

## 链路

入库基线项目（`../video-studio-shot-editor/baseline.video-project.json`，4 镜头 [2000,3100,2000,2000]ms，renderRecords 空）
→ CLI `render-scene`（完整干跑门禁，无 `--narration`）整片双画幅出片 + RenderRecord×8 回写
→ CLI `export-gif --aspect landscape`：尾块装配（8 条记录取 landscape 4 条）→ ffmpeg palettegen/paletteuse（12fps/480px/128 色）→ ffprobe 门禁（codec=gif/480 宽/时长 ±0.2s）→ **DeliveryRecord 首次落档**（renderIds=4 条真实渲染、frameMap 精确整数 [24,37,24,24]）
→ **GIF 双跑**：同 MP4 重新转码 → SHA-256 逐字节一致
→ CLI `export-shot-svg --shot 2 --fps 12`：text-animation 3100ms → 74 帧 → 37 采样帧 CSS 翻页册（`@keyframes kf-0..kf-36` + `steps(1,end) infinite`）→ DeliveryRecord（renderIds 空数组、frameMap [37]）
→ CLI `export-shot-svg --shot 3 --frame 24`：basic-shapes 静态单帧（无动画样式）→ DeliveryRecord（frameMap [1]）
→ **SVG 双跑**：同项目重导 → SHA-256 逐字节一致
→ 回读校验（`--frame 25` 再追加一条交付，文档仍过 `validateVideoProject`）→ `tts-usage.jsonl` 行数不变。

## 结果（退出码 0）

- 交付 4 条全落档：GIF 1 条（renderIds 4 条引用真实渲染记录）+ SVG 3 条（renderIds 空数组——SVG 直出场景树，不派生自 MP4）；每条追加后 `savedVersion` +1，脏引用会被 `appendDelivery` 内置重校验拦截。
- GIF：9.08s @12fps（109 采样帧 ← 整片 218 帧 ÷2）、480px 宽、125,191 字节；ffprobe 复核 codec=gif/width=480（CLI 内门禁 + e2e 独立复核双保险；终评 I2 整改：本行原误记 18.6s/149KB——那是另一份冒烟项目的数值，本片基线为 9.1s 整片）。
- SVG 动画：37 段 keyframes 与 74 帧 @2:1 采样精确对应；静态帧零动画样式。
- 确定性：GIF 与 SVG 双跑哈希均逐字节一致（源 MP4 本身已被 VID-013 确定性门禁覆盖）。
- 计费：零新增（本刀无 TTS 合成；`tts-usage.jsonl` 行数前后一致，累计仍 34 笔 ¥0.0370/¥50）。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（终版，含 8 条 RenderRecord + 4 条 DeliveryRecord，deliveries 字段首次非空）、`rerun.video-project.json`（双跑侧项目档）、`render/render-manifest.json`、`render/props-{landscape,portrait}.json`、脚本本身、QA 条目 VID-015。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18） |
| --- | --- |
| e2e.video-project.json | `fc53a97296330949ef7921bafcedc4857265531b3cc3481e8ed21ccdc1c4205f`（入库件） |
| landscape.gif | `314b867783207ae0a8f0d4a5b35a0440e2caafadaf9c5138937527e3074740aa`（双跑一致） |
| shot-2-animated-12fps.svg | `12337f7b0362ac919f1eca1b0ace1ff5d6a5b920a08040c1dc9ff3f46ce421cc`（双跑一致） |
| shot-3-frame-24.svg | `1a9491ffd7f5d0cbc04fcbcfc1666982958c371d42e4338ccef9e169d4a0b4b9` |
| render/landscape.mp4 | `bbda0997f8038e6b9b751e0528e9839ede2bb63612b1dc81636502db156e9f0f` |
| render/portrait.mp4 | `b1849dd5ab1d0391dbc574a23bdbf3bdba8e7327679810f90ae949d48bb5127a` |

字体声明（已知漂移）：SVG 引用 `font-family="NotoSansSC, sans-serif"` 不内嵌字体文件——无该字体的查看器按 sans-serif 回退，spec 非目标（无字体嵌入）。

复跑方式（纯 CLI，无需 dev server；每次复跑 DeliveryRecord ID 变，无 TTS 计费）：

```bash
node scripts/video/e2e-export.mjs
```
