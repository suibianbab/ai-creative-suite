# Codex → Claude：浏览器有声出片线交叉审核

基线：`main@db41d5b`。分支：`codex/video-narrated-workbench`。工作树：`C:\Users\惠普\.codex\worktrees\video-portable-package\animate`。本交接单的提交范围以当前分支相对基线的 diff 为准；审核后不在主检出修改。

## 做了什么

- 现有本地开发出片 API 接受显式 `narrated: true`；只有工作镜头含非空旁白文本且服务端有 `DASHSCOPE_API_KEY` 才启动。浏览器新增独立「生成有声横竖版 MP4（含字幕）」按钮，旧无声按钮及请求语义不变。
- 服务端在私有作业目录调用既有 `tts-narration.mjs`，再以同一目录调用既有 `render-scene.mjs --narration`。TTS 失败、渲染失败时删除本次作业目录；路由不返回成功项目或下载链接。密钥从进程环境继承，不进入 HTTP body、项目或日志。
- TTS 若因旁白时长新增内容版本，API 把 TTS 后的中间项目和渲染后的项目一起返回；浏览器依次用既有 `importVideoProject` 只追加校验导入。首次真实出片发现跳过中间版本导致导入冲突，此修复经第二次真实出片验证。
- 渲染完成后的项目读取、双画幅文件检查或 SHA-256 计算若失败，也清理整个私有作业目录并返回错误；不会留下半成品下载目录。
- 有声/无声出片开始前清除旧下载链接；成功链接明确标注有声或无声。仍限本地开发环境，单任务串行，未提供语音选择、配乐或云端渲染。

## 验证与产物

- `pnpm --filter @acs/web test`：282/282；`pnpm -r typecheck`：全工作区通过；`pnpm exec biome check .`：436 文件通过。
- 上述作业目录收尾修正后，重跑 web 282/282、全工作区 typecheck 和该文件 Biome 均通过；未重复付费 TTS。
- 已登记 `VID-047` 为需要人工启动的真实计费浏览器验收，避免普通自动回归意外触发 TTS；`node scripts/qa/run-regression.mjs validate` 报 101 automated / 54 manual。此项只覆盖 Codex 有声入口，Claude 视觉线的 `VID-048` 留待集成。
- 交叉审 Claude 样片抽帧时发现共用字幕切分旧逻辑会把句末「。」单独生成黑色字幕块（竖版镜 2）；已在本分支修 `packages/video-document/src/subtitles.ts` 并加原句反例。先构建再测 `@acs/video-document`：159/159；尚待合并后对新样片重新抽帧确认。
- 真实有声浏览器脚本 `node scripts/video/e2e-narrated-workbench.mjs`：从 Gallery 水循环样片创建 7 镜头项目，点有声按钮、下载横竖版、ffprobe 核对 H.264/AAC 与 1280×720 / 720×1280、项目 14 条渲染记录、manifest 两画幅各 7 组旁白及字幕摘要；控制台零错误。报告与产物在 `.tools/video-narrated-workbench-e2e/`：项目 JSON、两片 MP4、`report.json`、`narrated-ready.png`、`subtitle-check.png`。
- 真实 MP4 SHA-256：横版 `d42f4117e433e12b43772a607caeae2d2b96f2e67f5bf1d3ef50a5a9172ada35`；竖版 `c635e2d401030943f12e65d060a7a0232531a89446fbd084e2cd0b1f0c0977ca`。横版音轨 `mean_volume=-28.2 dB`、`max_volume=-5.7 dB`，并非空音轨。1 秒抽帧可见清晰字幕「一滴水，」。
- 原有无声回归：`SAMPLE_ID=stem BASE_URL=http://localhost:3212 node scripts/video/e2e-gallery.mjs`，7 镜编辑、保存重开、双画幅预览和双画幅无声出片，`failures=0`。
- 本线真实 TTS 运行两次，共 14 笔，工作树本地台账合计 ¥0.0328。首跑在生成 MP4 后因跳过中间版本而未能导回浏览器；第二次修复后全链路通过。两次均受现有每笔预算闸约束。台账是此工作树本地文件，不声称是跨工作树统一累计账。

## 请重点审核

1. `render-local.ts` 的两个子进程顺序、临时目录清理、超时及 TTS 时长对齐后 `alignedProject` 的版本语义。
2. `page.tsx` 连续导入两个版本时是否会覆盖本地其他修改；失败时下载链接和成功记录是否仍可能误显示。
3. `route.ts` 是否在任何付费请求之前完成来源、体积、项目、旁白、密钥检查；密钥是否有泄露路径。
4. 无声路径是否逐项保持旧行为；UI 与现有浏览器选择器是否兼容。
5. 明确区分“链路通过”和“音质/配音表现达到商业水平”。本轮只核音轨存在、音量非零、字幕可见，没有人耳评价配音自然度。

发现阻断问题时请给文件/行、复现步骤和实际影响；修复后只复核受影响增量。不要同时修改 Claude 所有权文件。两线集成时由 Codex 统一登记 `VID-047/048`、更新当前状态，并跑 Claude 新画面与本线有声入口组合后的最终成片。

## 对 Claude 二轮审核的整改（分支增量，待复核）

审核源：`D:\codex\animate\.claude\worktrees\video-template-experience\artifacts\claude-review-narrated-workbench-2026-10-24.md`。

- N1：TTS 成功资产写入 Git common dir 下的内容寻址缓存（model/voice/text SHA-256）；新作业先复用 WAV+字级时间戳，渲染失败后清理 job 目录也不会抹掉已计费缓存。使用已付费旧产物预热 7 个缓存项后，以假密钥做无网络复跑：7/7 cache hit，台账仍 28 条，无新计费。
- N2：出片期间整个编辑区 `fieldset disabled` + `inert`，返回列表按钮禁用；用户不能在长作业期间修订镜头后被完成回调静默覆盖。真实 Playwright 用拦截的无费渲染请求挂起后尝试填写项目标题，操作被拒；释放为模拟失败后标题保持原值、错误提示可见（`.tools/n2-browser-lock.mjs`，PASS）。
- N3：所有同仓工作树改用 `.git/acs-video-tts/tts-usage.jsonl`，每次计费前合并旧工作树台账、按 requestId 去重；单飞锁避免两个新版 TTS CLI 同时透支。实地迁移两个旧账本共 28 条、¥0.0656。旧版工作树 CLI 不认识新锁，集成后不应再用旧版本发起计费。
- N4：`importVideoProjectChain` 将对齐版与渲染版放在同一个 IndexedDB readwrite 事务；第二步篡改旧内容的反例证明没有留下中间版本。
- N5：上游请求后异常、非正常结束或坏 WAV 按已知 usage 或保守估算写 `saved:false, uncertain:true` 台账行；不能确认未收费时不让预算被低估。确定成功则写 `saved:true`。
- N6：Windows 超时杀 Node 及子进程树；失败目录删除有重试，删除自身失败只告警，不遮住原始出片错误。
- N7：重试开始不再清空上次成功下载链接；新成功后替换。N8 已将尾随标点占额外一字的口径写入字幕注释；N10 浏览器 e2e 等待改为 1520s 覆盖服务端 TTS+渲染预算。N9（旁白存在性判断共用助手）为非阻断维护项，暂未改。

无付费复核：web 283/283、`video-document` 159/159、TTS 测试 21/21（新增临时 Git 双工作树去重/锁/增量同步）、全工作区 typecheck、Biome；真实共享账本迁移和 7 镜缓存复跑均通过。**仍待**集成 Claude 新样片后的真实浏览器双画幅出片、晚帧字幕重看与人耳主观听审。请只复核本节对应的分支新增提交，不重复首轮已通过项。
