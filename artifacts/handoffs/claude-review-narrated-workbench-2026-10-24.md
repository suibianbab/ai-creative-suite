# Claude 复核：codex/video-narrated-workbench（有声工作台线，分支尖）

- **对象**：`codex/video-narrated-workbench` 相对 `db41d5b` 全部 5 提交（含前轮互审范围外的 `a2abefd`/`154b7a8`/`0d8e128`/`c01bff1`）
- **方式**：Claude 人工精读关键路径 + 独立代码审读双重复核 + 声明逐项亲验（web 282/282、video-document 159/159 系绕过其 worktree 的 pnpm 环境门槛直跑 node --test 复现；e2e 证据文件在场；三条新发现逐条读码核实）
- **前轮互审**（stem-visual worktree `codex-review.md`，@7658abd）5 条挂账**全部维持未动**——其中 4 条在本轮升级为下列 N1/N3/N5/N7

## 通过项（双重复核一致）

付费前闸门序（同源→体积→单飞→项目→旁白→密钥，全部先于任何计费子进程）；密钥无泄露面（仅进程环境继承，错误只含变量名，`describeHttpFailure` 只回 body 不回头）；`alignedProject` 版本语义（TTS +1、渲染再 +1，与 `importVideoProject` 快进规则吻合）；无声路径行为保持（e2e-gallery 回归 failures=0）；VID-047 进 **manual 层**（101/54）避免自动回归意外计费——设计正确；subtitles「。」黑块修正方向正确且带原句反例；跨线修 `video-document`（非其所有权）有如实披露，理由成立。

## 发现（按严重度；前轮挂账标注†）

### N1†（Important·建议集成前修）有声出片无资产复用 + 失败销毁已计费 WAV + 重试全额重计费

`render-local.ts:135-156` + `tts-narration.mjs:101`：每次渲染新 jobId 新 narrationDir，逐镜无条件合成；TTS 成功而渲染失败时 catch `rmSync` 连已计费 WAV 一起删，重试再全额计费。同一项目连点两次即两轮全量入账（实测两次共 14 笔 ¥0.0328 佐证费率）。¥50 烧穿后有声按钮永久失败且 UI 显示 CLI 原文。修法：`<shotId>-<versionId>.wav|words.json` 齐全即跳过（内容版本不可变，寻址安全；视觉线 `reuse-narration.mjs` 已验证等价复用）；或至少失败时保留 narrationDir 供重试复用。

### N2（Important·数据丢失）渲染期间的用户编辑被静默丢弃——交接单自问 2 的答案是「会」

`page.tsx:240-249`：成功回调无条件 `document: imported`（渲染开始时的服务端快照）；busy 只禁按钮，旁白输入、转场输入、`onRevise`（:812，未接 busy 门）全程可编辑。有声渲染可长达数分钟～25 分钟（TTS 900s + 渲染 600s 预算），期间任何镜头修订在完成瞬间消失且无警告。修法：完成回调比对 `current.document` 的版本链，检测到用户已改时提示「保留我的修改/采用渲染结果」而非静默覆盖；或渲染期间锁编辑。

### N3†（Important·授权边界）tts-usage.jsonl 按工作树分账，实际总额可达 ¥50×N

`tts-narration.mjs:33` 台账是工作树本地文件。交接单已自曝，此处升级定性：这是对用户单一 ¥50 授权的边界缺陷，不是记账洁癖。**集成时必须先合并各工作树台账再允许任何计费运行**。

### N4（应修）alignedProject→returned 双导入非原子

`page.tsx:230-233`：两段 await 之间无事务。第二导入抛出而第一已提交时，IndexedDB 停在 N+1、编辑器回退 N（:255 `document: saved`），下次保存撞 `VideoProjectConflictError`，渲染记录丢失。深修在 `importVideoProject` 支持多步快进或服务端返回整链；浅修至少在两导入间 try/catch 差异提示。

### N5†（应修）已计费但客户端判失败的调用不入账

`tts-narration.mjs:139→173`：`finish_reason≠stop`、非 RIFF、120s abort、解析抛出均在 `appendUsage` 前退出——钱花了账上没有，累计值偏小放行超限调用。这些分支应追加 `saved:false` + request_id 条目。

### N6（应修·Windows 特有）rmSync 在 catch 内可抛 EBUSY，替换真实错误并泄漏作业目录

`render-local.ts:156`：`child.kill()` 只杀 node 主进程，render-scene 派生的媒体/旁白 HTTP 服务子进程仍持句柄，`rmSync(force)` 不掩 EBUSY/EPERM——原渲染错误被文件系统错误顶掉，半开作业目录存活到 prune。修法：kill 进程树（taskkill /T 类），rmSync 包 try/catch 仅告警。

### N7†（应修·无声路径回归）`setRenderDownloads(null)` 抹掉上次成功下载链接

`page.tsx:195`：每次出片开始即清空旧链接，而 MP4 在 GET 路由仍可下载；既有 `signature === renderSignature(document)` 判旧机制本可让旧链接存活到新片成功。对无声路径而言这是相对 `db41d5b` 的行为回归（旧失败重渲不丢旧链接）。

### N8（Minor·挂账）字幕合并可破 10 字上限且未 trim

`subtitles.ts:48`：修正方向对，但 `previous.text += unit.text` 不 trim、可链式并入多个全标点单元；**自家测试断言了 11 字 cue**（「天空和陆地间不停移动。」）超 `SUBTITLE_MAX_CUE_CHARS=10` 一字——药丸按 ≤10 字设计的余量目前靠 padding 消化。建议并入后超限时改并入下一条开头或接受并文档化该一字余量。

### N9（Minor）`hasWorkingNarration` 判定在 route.ts:42 与 page.tsx:1054 双拷贝

漂移即「按钮可点、服务端 400」。抽共享助手进 `@acs/video-document`（`buildNarrationJobs` 旁）。

### N10（Minor）e2e 等待 900s < 服务端预算 1500s

`e2e-narrated-workbench.mjs:54`：TTS 慢而成功的跑会被脚本误判失败。等待应对齐 TTS+渲染总预算。

## 流程备注

- 所有权偏差两处均有披露且可接受：`qa/registry.json`（分工单称集成时统一更新，其以 manual 层提前登记避免了自动计费风险）、`packages/video-document/src/subtitles.ts`（跨线修复真实 bug，带测试，待集成后对新样片重新抽帧确认）。
- 其 worktree 的 pnpm 状态与 lockfile 有分歧（无 TTY 时欲清仓重建被中止）——非代码问题，集成前建议其自环境跑一次 `CI=true pnpm install` 或删净重装，避免集成轮踩坑。

## 结论

链路本体（闸门、密钥、原子性、音画对齐、无声保持）经三重复核成立，真实出片证据完整。**N1–N3 建议集成前处理**（两条真金白银 + 一条数据丢失），N4–N7 同批应修，N8–N10 挂账。修后按分工单 §3 只复核受影响增量。四态口径维持其自报：「链路通过」，不构成配音自然度/商业音质评价——与人耳边界声明一致。
