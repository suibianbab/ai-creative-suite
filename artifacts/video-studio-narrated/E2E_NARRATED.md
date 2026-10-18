# D2 有声多镜头端到端闭环验收记录（真实工作台链路 + 真实计费 TTS）

- 日期：2026-10-18
- 执行人：Claude（D2 旁白第一刀会话）
- 脚本：`scripts/video/e2e-narrated.mjs`（分支内可复核；密钥只从 env `DASHSCOPE_API_KEY` 读，绝不落盘/入库/入日志）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210）· playwright-core headless Chromium · Remotion 4.0.534（系统 Chrome 155）· DashScope CosyVoice `cosyvoice-v3-flash` / `longanyang` · ffprobe 音轨核对

## 链路

浏览器（`/video-studio`）新建项目 → 填写「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划 → 分镜确认卡 → 确认应用（追加 4 镜头）→ **镜头卡显示逐镜头旁白文本**（开场/示意「水循环。」、要点「水循环，要点 1。」、结语「谢谢观看。」）→ 保存（v2）→ **导出项目 JSON**（ContentVersion.narrationText 逐镜头落档）
→ CLI `node scripts/video/tts-narration.mjs --project <导出件> --out <dir>/narration`（**真实计费**：DashScope SSE 流式合成，逐镜头 `<shotId>-<versionId>.wav` + 同名字级时间戳 `.words.json`，RIFF 校验后原子落盘，usage 台账追加）
→ CLI `node scripts/video/render-scene.mjs --project <导出件> --out <dir>/e2e-render --narration <dir>/narration`（逐帧干跑门禁 192 帧全过 → 独立进程旁白文件服务 + Timeline 合成装配 `<Audio>` → 整片双画幅出片（aac 音轨 fail-loud 核对）→ manifest.narration 逐镜头音频指纹 → RenderRecord ×8 回写，savedVersion +1）
→ 浏览器返回列表 → **导入项目 JSON** → 镜头卡旁白文本回显 + 渲染记录 8 条可见。

## 结果（退出码 0；共两次完整通过运行——首过 + 收口回归复跑，结果一致）

- 项目 ID `64da2804-e0ba-4bce-b5c4-deec94c671cc`（收口回归运行）贯穿浏览器↔CLI↔浏览器全程不变；4 个内容版本 ID 未被改写。
- 版本链：工作台保存 v2 → CLI 回写 v3（renderRecords 0→8，append-only）→ 导入回显成立。
- TTS：4 wav + 4 字级时间戳档案，计费字符 37（7+14+7+9）；每条 `.words.json` 含 requestId/model/voice/usage/sentences（字级 begin/end_time ms）。
- 音轨：横竖两片独立 ffprobe 核对均为 aac，容器时长 8.00s 与视频一致（±0.1s 内）；`render-manifest.json` 双画幅 `narration` 数组各 4 条（shotIndex/versionId/audioBytes/durationMs/wordsFile）。
- 控制台门禁：全程零 error。
- 旁白溢出告警实录（此前漏记，补录）：收口运行中要点镜头（span 2000ms）旁白 wav 实测 2640ms，CLI 打印 `[render-scene] 旁白警告: 镜头 2 旁白 2640ms 超镜头 span 2000ms，播放将截断到 span 末`，Remotion Sequence 按引擎保证截到 span 末出片（aac/时长核对均过）——溢出是告警不阻断，符合装配纪律。

## 计费台账（逐笔，DashScope ¥1/万字符；用户授权累计 ≤¥50）

| 时间 (UTC) | 用途 | 字符 | 金额 |
| --- | --- | --- | --- |
| 2026-10-18T00:00（补记时间戳） | spike 非流式验证 | 34 | ¥0.0034 |
| 2026-10-18T00:00（补记时间戳） | spike SSE 流式验证 | 34 | ¥0.0034 |
| 2026-10-17T17:15 | Task2 冒烟 ×4 镜头 | 9/16/9/9 | ¥0.0043 |
| 2026-10-17T18:00 | e2e 首跑 ×4 镜头（闭环通过，SHA 打印段路径 bug 后修） | 7/14/7/9 | ¥0.0037 |
| 2026-10-17T18:01 | e2e 收口跑 ×4 镜头（一次通过） | 7/14/7/9 | ¥0.0037 |
| 2026-10-17T18:0x | e2e 收口回归复跑 ×4 镜头（Step3 全量回归） | 7/14/7/9 | ¥0.0037 |
| 2026-10-18T02:44 | e2e 复核整改后复跑 ×4 镜头（locked 末条裁定 + 分镜追加语义落地后回归） | 7/14/7/9 | ¥0.0037 |
| **累计** | 22 笔 | 264 | **¥0.0259**（预算 ¥50，余 ¥49.97） |

原始逐笔台账在本地 `artifacts/tts-usage.jsonl`（.gitignore 挡 .jsonl，不入库）；上表为全量誊录。

## 配套确定性证据（Task4 Step4，本机复核）

同一项目带/不带 `--narration` 两次整片出片，横竖两画幅各抽 12 帧解码像素对比 **逐像素一致**（`decodeFrameHash` 全等）——旁白装配只加音轨，不触碰任何视频帧（确定性 Global Constraint）。另：镜头 1 与镜头 3 旁白文本相同（「水循环。」），两次合成 wav 字节级相同（SHA 相同）——同输入同输出，TTS 侧无随机性漂移。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（CLI 回写后的项目件，narrationText/shots/renderRecords/savedVersion 字段可比对）、`e2e-render/render-manifest.json`（含逐镜头 frameMap、内容指纹与 narration 音频指纹）、`e2e-render/props-*.json`、脚本本身（e2e-narrated / tts-narration / narration-server / render-scene）、QA 条目 VID-010/VID-011。

以下产物因 gitignore 约定（媒体/音频不入库）仅存本地，**不构成可独立复核的视听证据**；其 SHA-256 供本机比对（用户裁决：维持 SHA-256 证据制；取收口回归运行值）：

| 文件 | SHA-256（2026-10-18 复核整改后复跑） |
| --- | --- |
| e2e.video-project.json | `9b3fca2eea34704809f0950de5a72a5231a02efac2fc3479809d42d9353ff1d8` |
| narration/57286db4-…-440a44e3-….wav（结语「谢谢观看。」） | `77fcebc27fb93c3fc998e5bcbdf8d45c305224b7d4a28d01a9073cad7bec211f` |
| narration/5e90227f-…-09e5c797-….wav（要点「水循环，要点 1。」） | `3f02f89d1da627ae46ecff5a1d67c0756cb29ae474230b9929f26038bba09ac5` |
| narration/b234cfa9-…-26389144-….wav（开场/示意「水循环。」之一） | `3c25bff823349f79a40463cc3fbaf59e7255c45a0cfe59081180d6c9c27afa0d` |
| narration/e2189c52-…-0c79383d-….wav（开场/示意「水循环。」之二，与上一条同文本同哈希） | `3c25bff823349f79a40463cc3fbaf59e7255c45a0cfe59081180d6c9c27afa0d` |
| e2e-render/landscape.mp4 | `f777006c22c7a39baa591fb076cf6bb01769ce4916d334f3956288da19a20511` |
| e2e-render/portrait.mp4 | `2bedf48ab331241e03dea6b9b43ac0333c22031ce1bb79840ff6504fd98385dd` |
| e2e-render/render-manifest.json | `80ff425650242746b699affda1f50a1cb836722e213dbeb1c586aff9a46a7c2a` |
| narrated-editor.png | `945ae59a7d95f5a336d1f92cf4f61e3db83668c07e671d96559a6d83ad6b58af` |

**2026-10-18 复跑备注（复核整改后的回归运行）**：全链路一次通过；landscape/portrait MP4 与上表两值**逐字节一致**（第 3 次跨运行实证）；四条旁白 wav 的**内容哈希与历史记录完全相同**（`77fcebc2`/`3f02f89d`/`3c25bff8`×2，仅文件名中的 version UUID 随新运行变化）——TTS 与装配链路跨运行确定。项目 JSON / manifest / 截图因内嵌新 UUID 与 brief 新增的 applications 快照而刷新（属预期，已取新值入表）。

**跨运行字节一致性（本机复核）**：两次完整运行（项目 ID `adc0ad92-…` / `64da2804-…`，UUID 不同）的 landscape/portrait MP4 SHA-256 **逐字节相同**（即上表两值）——UUID 不进入渲染路径，旁白装配后的整片仍然跨运行确定；四条旁白文本各自的重复合成 wav 哈希亦跨运行相同（同文本同输出）。项目 JSON / manifest / 截图因内嵌新 UUID 与随机端口而不同，属预期。

复跑方式（需本地 dev server、Playwright Chromium、`DASHSCOPE_API_KEY`；每次复跑项目 ID 变、计费 ~¥0.0037/次）：

```bash
DASHSCOPE_API_KEY=sk-… node scripts/video/e2e-narrated.mjs   # 或 BASE_URL=… 指定工作台
```
