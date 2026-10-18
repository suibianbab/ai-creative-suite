# P1 转场端到端验收记录（dip-to-black，零 TTS 计费）

- 日期：2026-10-18
- 执行人：Claude（P1 Feature ④ 会话）
- 脚本：`scripts/video/e2e-transitions.mjs`（分支内可复核）
- 环境：Windows 11 · Node 22.22.2 · Remotion 4.0.534（系统 Chrome 155）· ffmpeg/ffprobe（winget 安装）· Playwright chromium

## 链路

浏览器新建（BASE_URL=http://127.0.0.1:3211）→ STEM 分镜「水循环 4 镜头」（[2000,3100,2000,2000]ms → 218 帧 @24fps）→ 保存
→ **配转场**：边界 镜头1→2 选「淡入淡出」500ms（工作台转场区，`.transition-error` 不出现）→ 保存 v3 → 导出 JSON
→ 结构断言：`transitions` 恰一条 `{boundary:0, kind:"fade", durationMs:500}`
→ CLI `render-scene` 双画幅出片（无 `--narration`，零计费）：props-landscape.json 透传同数组；render-manifest 顶层 `transitions` 摘要 = 窗口 {startFrame:42, frames:12}（T=round(500×24/1000)=12，对半 6+6，左 span 48 帧尾部 [42,48) + 右 span 头部 [48,54)）
→ **暗帧数值断言（A2，双画幅）**：ffmpeg signalstats YAVG——有限范围黑 ≈ 16
→ **双跑（A4）**：导出件复制重渲 → 双画幅 SHA-256 逐字节一致
→ **A1 金标准**：入库无转场基线（`../video-studio-shot-editor/baseline.video-project.json`）重渲 → 哈希 = Feature ③ 已档值（转场缺席 = 字节不变）
→ 浏览器控制台零 error；`tts-usage.jsonl` 行数不变。

## 结果（退出码 0）

- 转场可见（A2）：YAVG 边界中点 帧47（左尾）/帧48（右首）= **16/16**（≤30 门限，全黑）双画幅一致；窗外对照 帧20/帧60 = 233.667/233.709（landscape）、230.785/230.922（portrait）（≥100 门限）。斜坡帧（窗内非中点）介于两者之间（Task 2 冒烟实测帧 127 @opacity 1/6 → 196.076）。
- 帧确定性（A4）：双跑 landscape `8926a1931a5b63d9f00dab62385c47ab2765ae4371304a6c5c44f7ca3ad4be7a`、portrait `51419e38ccdcb9940d2e5d7b62f149eb7d448f6f126b573879b3b1536db64db6`，逐字节一致。
- 回归金标准（A1）：无转场基线重渲 landscape `bbda0997f8038e6b9b751e0528e9839ede2bb63612b1dc81636502db156e9f0f`、portrait `b1849dd5ab1d0391dbc574a23bdbf3bdba8e7327679810f90ae949d48bb5127a`——与 `../video-studio-export/E2E_EXPORT.md` 已档值逐字符一致；props 文件零 `transitions` 键（缺席路径不加键）。
- 双端一致（A3）：预览与出片共用 `resolveTransitionWindows`/`transitionOverlayAt`（@acs/video-document 单一定义）；TimelineScene（出片）与 TimelinePreview（预览）均从量化 spans 装配。
- 计费：零新增（本刀无 TTS；台账 34 行不变，累计 ¥0.0370/¥50）。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（含 transitions 与双画幅 RenderRecord×8）、`rerun.video-project.json`（双跑侧）、`render/render-manifest.json`（含 transitions 摘要）、`render/props-{landscape,portrait}.json`、脚本本身、QA 条目 VID-016。

以下产物因 gitignore 约定（媒体不入库）仅存本地，**不构成可独立复核的视觉证据**；其 SHA-256 供本机比对：

| 文件 | SHA-256（2026-10-18） |
| --- | --- |
| e2e.video-project.json | `9d90ea3c9073a43cab0c941f6933d1cd9a99a2cdbfdaa18676098b0fd2e71b26`（入库件） |
| render/landscape.mp4 | `8926a1931a5b63d9f00dab62385c47ab2765ae4371304a6c5c44f7ca3ad4be7a`（双跑一致） |
| render/portrait.mp4 | `51419e38ccdcb9940d2e5d7b62f149eb7d448f6f126b573879b3b1536db64db6`（双跑一致） |
| transitions-editor.png | `950c0157b44c9cb896419410ae696a8e4025114d107085ce3c0a24e22e0f67d5` |

复跑方式（需 :3210 dev + :3211 代理在跑；每次复跑项目/交付 ID 变，无 TTS 计费）：

```bash
node scripts/video/e2e-transitions.mjs
```
