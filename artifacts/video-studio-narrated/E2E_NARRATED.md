# D2 有声多镜头端到端闭环验收记录（真实工作台链路 + 真实计费 TTS + 字幕烧录）

- 日期：2026-10-18（字幕轨 + 溢出收口终评整改后复跑终值）
- 执行人：Claude（D2 旁白第一刀会话；字幕轨会话收口复跑；终评整改复跑）
- 脚本：`scripts/video/e2e-narrated.mjs`（分支内可复核；密钥只从 env `DASHSCOPE_API_KEY` 读，绝不落盘/入库/入日志）
- 环境：Windows 11 · Node 22.22.2 · `@acs/web` dev server（端口 3210，经剥头 TCP 代理 3211 访问，规避 Next16/Node22 HMR ws 握手 bug）· playwright-core headless Chromium · Remotion 4.0.534（系统 Chrome 155）· DashScope CosyVoice `cosyvoice-v3-flash` / `longanyang` · ffprobe 音轨核对

## 链路

浏览器（`/video-studio`）新建项目 → 填写「做一个8秒的STEM解说视频，主题是水循环，分4个镜头」→ 规划（**语速感知时长**：等分 2000ms vs 语速估计 400+300×字数 取大者 → 本句 [2000,3100,2000,2000] Σ9100ms，规划透明告知秒数是目标非承诺）→ 分镜确认卡 → 确认应用（追加 4 镜头）→ **镜头卡显示逐镜头旁白文本**（开场/示意「水循环。」、要点「水循环，要点 1。」、结语「谢谢观看。」）→ 保存（v2）→ **导出项目 JSON**（ContentVersion.narrationText 逐镜头落档）
→ CLI `node scripts/video/tts-narration.mjs --project <导出件> --out <dir>/narration`（**真实计费**：DashScope SSE 流式合成，逐镜头 `<shotId>-<versionId>.wav` + 同名字级时间戳 `.words.json`，RIFF 校验后原子落盘，usage 台账追加；**时长对齐**：wav 实测时长（流式 data 头占位哨兵已按实际字节封顶）> 版本时长时追加 tts-duration-align 新 ContentVersion 并重键资产）
→ CLI `node scripts/video/render-scene.mjs --project <导出件> --out <dir>/e2e-render --narration <dir>/narration`（逐帧干跑门禁 218 帧全过 → 独立进程旁白文件服务 + Timeline 合成装配 `<Audio>` → **字级 cue 烧录进整片**（`readSubtitleCues` 与 web 预览同一实现源；words.json 坏/缺失回退均匀近似并告警；cue 越界钳到 span）→ 整片双画幅出片（aac 音轨 fail-loud 核对；旁白溢出默认拒绝渲染，`--allow-truncate` 才放行截断）→ manifest.narration 逐镜头音频指纹 + **manifest.subtitleCues 逐镜头 cue 摘要**（cue 数 + 文本 SHA-256）→ RenderRecord ×8 回写，savedVersion +1）
→ 浏览器返回列表 → **导入项目 JSON** → 镜头卡旁白文本回显 + 渲染记录 8 条可见。

## 结果（退出码 0）

- 项目 ID `ae7f22fd-9797-415b-86b3-aa61d573b4c3` 贯穿浏览器↔CLI↔浏览器全程不变；4 个内容版本 ID 未被改写。
- 版本链：工作台保存 v2 → CLI 回写 v3（renderRecords 0→8，append-only）→ 导入回显成立。本轮**时长对齐 0 个镜头**（语速预估已覆盖实测 wav，对齐层是条件兜底不是必经路径）。
- 时长：规划 9100ms（speech-aware）→ 出片 9100ms（218 帧 @24fps，ffprobe 核对横竖两片均 h264、9.083s 视频 / 9.088s 容器）。
- TTS：4 wav + 4 字级时间戳档案，计费字符 37（7+14+7+9）；每条 `.words.json` 含 requestId/model/voice/usage/sentences（字级 begin/end_time ms）。
- 音轨：横竖两片独立 ffprobe 核对均为 aac；`render-manifest.json` 双画幅 `narration` 数组各 4 条（shotIndex/versionId/audioBytes/durationMs/wordsFile）。
- **字幕双核验**：
  - manifest 摘要——双画幅 `subtitleCues` 各 4 条（逐镜头 cue 数 ≥3、cue 文本 SHA-256）；
  - 像素核验——cue 时刻（取首镜头最长 cue「水循环。」中点 0.98s，从 words.json 推导而非写死）裁底部 10% 暗带比 **6.84%**（>1% 判据），pre-cue 0.1s 同带 **0.00%**（<0.5% 判据）——药丸在场/不在场都核到；证据帧 `subtitle-band-cue.png`（底部 38% 裁片）另经视觉模型复核：圆角半透明深底白字「水循环。」清晰可读、白底对比度足够。
- 控制台门禁：全程零 error。
- 旁白溢出：旧版曾实录要点镜头 2640ms wav 超 2000ms span 截断告警；本轮 speech-aware 规划（要点 3100ms）+ 时长对齐兜底后 **0 溢出 0 告警**——溢出路径保留 `--allow-truncate` 显式放行语义，且渲染默认遇溢出警告即拒绝。
- 预览近似标注（终评整改）：回程导入后整片预览控件区出现「**预览近似，出片按字级时间戳**」（`.preview-subtitle-note`，e2e 断言文案）——预览字幕按 span 均匀分布，出片按 words.json 字级时间戳，差异对用户可见而非隐式。

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
| 2026-10-18T04:39 | 字幕轨 Task7 首跑 ×4 镜头（wavDurationMs 流式哨兵 bug 触发对齐版本超 schema 被拒，该笔为排障成本） | 7/14/7/9 | ¥0.0037 |
| 2026-10-18T04:41 | 字幕轨 Task7 收口跑 ×4 镜头（一次通过） | 7/14/7/9 | ¥0.0037 |
| 2026-10-18T05:17 | 终评整改复跑 ×4 镜头（字幕原文映射 + 预览标注断言，本表终值） | 7/14/7/9 | ¥0.0037 |
| **累计** | 34 笔 | 370 | **¥0.0370**（预算 ¥50，余 ¥49.96） |

原始逐笔台账在本地 `artifacts/tts-usage.jsonl`（.gitignore 挡 .jsonl，不入库）；上表为全量誊录（此前版本累计字符数误写 264，按台账逐笔求和实为 333，已更正）。

## 配套确定性证据（Task4 Step4，本机复核）

同一项目带/不带 `--narration` 两次整片出片，横竖两画幅各抽 12 帧解码像素对比 **逐像素一致**（`decodeFrameHash` 全等）——旁白装配只加音轨，不触碰任何视频帧（确定性 Global Constraint）。另：镜头 1 与镜头 3 旁白文本相同（「水循环。」），两次合成 wav 字节级相同（SHA 相同）——同输入同输出，TTS 侧无随机性漂移。

## 产物与可复核性（如实声明）

分支内入库、可独立复核的：本 md、`e2e.video-project.json`（CLI 回写后的项目件，narrationText/shots/renderRecords/savedVersion 字段可比对）、`e2e-render/render-manifest.json`（含逐镜头 frameMap、内容指纹、narration 音频指纹与 subtitleCues 摘要）、`e2e-render/props-*.json`、脚本本身（e2e-narrated / tts-narration / narration-server / render-scene / tts-sse）、QA 条目 VID-010/VID-011/VID-012/VID-013。

以下产物因 gitignore 约定（媒体/音频不入库）仅存本地，**不构成可独立复核的视听证据**；其 SHA-256 供本机比对（用户裁决：维持 SHA-256 证据制；取字幕轨收口运行值）：

| 文件 | SHA-256（2026-10-18 终评整改复跑） |
| --- | --- |
| e2e.video-project.json | `5b91488166393ac9ca8ba6be5c65a056ce6ca0033a89d3c144fad40b5c5c49a4` |
| narration/0809e9c2-…-580e3ea4-….wav（开场/示意「水循环。」之一） | `3c25bff823349f79a40463cc3fbaf59e7255c45a0cfe59081180d6c9c27afa0d` |
| narration/350b2edb-…-50f92e3b-….wav（开场/示意「水循环。」之二，与上一条同文本同哈希） | `3c25bff823349f79a40463cc3fbaf59e7255c45a0cfe59081180d6c9c27afa0d` |
| narration/cb2eff7b-…-3c67c892-….wav（要点「水循环，要点 1。」） | `3f02f89d1da627ae46ecff5a1d67c0756cb29ae474230b9929f26038bba09ac5` |
| narration/5ef52b92-…-ee35cfd0-….wav（结语「谢谢观看。」） | `77fcebc27fb93c3fc998e5bcbdf8d45c305224b7d4a28d01a9073cad7bec211f` |
| e2e-render/landscape.mp4 | `c267146daa446212b393cbb0a87289f8835eee357fb87b67230a270520af1bb3` |
| e2e-render/portrait.mp4 | `09934f53f200e81061b3bed7a2660c2af3c2ab1190074c9cf4743a7b97c0d963` |
| e2e-render/render-manifest.json | `4e22611cad30309247691c47b38eacb65e494ed0db591f07583ebc85e1536742` |
| subtitle-band-cue.png（cue 时刻底部裁片，像素核验证据帧） | `b208d3a3562ad22a27c44892069b95d58c299852c30c83bf37126133ad8fe13f` |
| narrated-editor.png | `f99dc2e7c786be5b18e2c0c8379b6b664f3b3b189ef7530a8c4071c0bd3f81d7` |

**2026-10-18 字幕轨收口复跑备注**：MP4 哈希相对上一版**合法变化**——项目时长数据 8000→9100ms（speech-aware 规划）+ 字幕药丸烧录进帧，两者都改变视频字节；引擎不变性另由字幕轨 T2 第 7 次 e2e-multishot 复跑（无字幕 props 时 MP4 逐字节不变）独立证明。四条旁白 wav 的**内容哈希跨运行完全相同**（`3c25bff8`×2/`3f02f89d`/`77fcebc2`，仅文件名 version UUID 随运行变化，第 4 次实证）——TTS 与音轨装配链路跨运行确定。项目 JSON / manifest / 截图因内嵌新 UUID 而刷新（属预期，已取新值入表）。

**2026-10-18 终评整改复跑备注（cue 文本取原始字符）**：字幕原文映射落地后 MP4 哈希再次**合法变化**（`a9b98790`/`c89d9777` → 上表新值）——要点镜头 cue 文本由 TTS 规范化字串「要点、一。」修正为用户原文「要点 1。」，烧录像素随之变化；manifest 的 cue 文本 SHA-256 同步变基。**跨运行确定性补强（第 5 次实证）**：本次导出 JSON 复制到临时目录后独立重跑 render-scene（`--narration` 指向同一资产目录），横竖两画幅 MP4 与 e2e 内渲染**逐字节一致**（`c267146d`/`09934f53`）——UUID 不进渲染路径、重放同输入得同输出。wav 内容哈希第 5 次跨运行相同；`subtitle-band-cue.png` 因采样点在首镜头（无规范化差异）而与上一版相同。`narrated-editor.png` 与同日 e2e-multishot 的 `multishot-editor.png` **逐字节相同**——同句输入 → 同规划 → 工作台初始帧状态确定性一致（两者均为导入后立刻截图，预览动画尚未推进），非证据错乱。

复跑方式（需本地 dev server、TCP 代理、Playwright Chromium、`DASHSCOPE_API_KEY`；每次复跑项目 ID 变、计费 ~¥0.0037/次）：

```bash
PORT=3210 pnpm --filter @acs/web dev                                  # 终端 1
node scripts/dev/proxy-3211.mjs  # 终端 2（剥头代理，规避 HMR ws bug）
BASE_URL=http://127.0.0.1:3211 DASHSCOPE_API_KEY=sk-… node scripts/video/e2e-narrated.mjs
```
