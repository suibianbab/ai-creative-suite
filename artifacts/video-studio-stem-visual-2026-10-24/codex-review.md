# Claude 对 Codex `codex/video-narrated-workbench@7658abd` 的互审意见

审核人：Claude（画面与模板线）。对象：提交 `7658abd`（分支后续 `a2abefd`、`154b7a8` 未在本次范围内，集成时请以分支尖为准）。审核维度按分工单：费用闸、密钥、失败原子性、音画对齐、浏览器操作。只给意见，不改该分支。

## 结论

**无阻断问题。** 分工单交付门槛的核心断言在代码与他们的运行证据里都能对上：付费前所有闸门就位、密钥只在服务端、失败不留成功链接/成功台账、音画对齐链路完整、无声路径行为保持。以下 5 条为**非阻断建议（挂账）**，附文件/行与复现步骤。

## 通过项（抽查证据）

1. **付费前闸门顺序正确**：`apps/web/src/app/api/video/render/route.ts`（7658abd 版，下同）第 20–68 行依次完成 同源校验 → content-length 8 MiB → `active` 单飞 409 → body 解析 → `narrated` 类型校验 → 项目校验/空镜头 → 有声时旁白文本存在性 → Style Bible 摘要 → `DASHSCOPE_API_KEY` 存在性 503，全部在任何计费子进程之前；`render-local.ts:135` 才spawn `tts-narration.mjs`。`route.test.ts` 新增两测（错型/无旁白 400、无密钥 503 且 `project/downloads` 均 undefined）与实现一致。
2. **密钥无泄露路径**：密钥只经进程环境继承（`render-local.ts` 的 `spawn(process.execPath, args, { cwd: root })`，未显式传 env、不落 body）；`tts-narration.mjs` 头部纪律声明 + 产物只含 WAV/words（requestId/usage，无密钥）。下载路由 `apps/web/src/app/api/video/render/[jobId]/[aspect]/route.ts` 经 `renderOutputPath`（`render-local.ts:35-39`）UUID + `landscape|portrait` 白名单校验，无路径穿越；narration WAV 不在暴露面。仅本地开发开放（两路由都挡非 development）。
3. **失败原子性成立**：`render-local.ts` try/catch 把 TTS 与渲染都包住，任一失败 `rmSync(dir)` 后 rethrow；`route.ts` 79–81 `finally { active = false }`（失败不会占死单飞位）；失败响应只含 `error`。浏览器侧 `page.tsx` 在每次出片开始 `setRenderDownloads(null)`，失败无成功链接可显。TTS 单镜头 tmp+rename 原子写（tts-narration.mjs 既有行为）不会留半资产被误用。
4. **音画对齐链路完整**：`render-local.ts:148-156` 读回 TTS 对齐后的项目（`savedVersion` 变化则作为 `alignedProject` 返回）；渲染读同一份已对齐文件；`page.tsx:231-233` 先导入 aligned 再导入 rendered，配合 `local-video-projects.ts:294` 的 append-only（`savedVersion === stored+1` + `assertAppendOnlyEvolution`）两步连续导入合法——这正是他们首跑失败后修复的点，第二次真实出片通过。其 e2e（`scripts/video/e2e-narrated-workbench.mjs`）核对 14 条渲染记录、两画幅 7 组旁白+字幕 cue、H.264/AAC、音量非零、抽帧字幕可见。
5. **无声路径保持**：`narrated=false` 时参数与基线一致（仅新增失败清理）；`e2e-gallery.mjs` 无声回归 failures=0。

## 非阻断建议（挂账）

1. **有声出片每次全额重合成、无资产复用**（`render-local.ts:135-147` + `scripts/video/tts-narration.mjs:101` `for (const job of jobs)` 无 existsSync 跳过；`tts-sse.mjs:106` `buildNarrationJobs` 把所有有文本镜头全部入队）。
   - 复现：对同一未改动的项目连点两次「生成有声横竖版 MP4」，`artifacts/tts-usage.jsonl` 出现两轮全量计费（他们两次真实运行共 14 笔 ¥0.0328，单次成本很小）。
   - 实际影响：重复点击持续消耗 ¥50 台账直至「预算将超限」，此后有声按钮永远失败且用户看到的是 CLI 原文错误。
   - 建议：`<out>/<shotId>-<versionId>.wav` 与 `.words.json` 齐全时跳过该镜头（内容版本不可变，versionId 寻址安全；Claude 线的 `reuse-narration.mjs` 已验证等价复用可行），或在按钮上给出本次将计费的估算确认。
2. **台账按工作树分账**（他们交接单已自曝）：`tts-narration.mjs:27` `USAGE_LEDGER = ROOT/artifacts/tts-usage.jsonl` 是工作树本地文件，并行工作树各自持有 ¥50 上限，理论总花费可达 ¥50×N。集成时先把各工作树台账合并进主检出再继续任何计费运行。
3. **计费后失败不入账**：`tts-narration.mjs:161` 台账在解析成功、原子写盘后才 append；`finish_reason≠stop`、非 RIFF、网络中断等「已向 DashScope 计费但判失败」的窗口不记任何条目，累计值偏小可能放行超限调用。建议这些分支也 append 一条 `saved:false` + request_id 的记录（属 `scripts/video/tts-*` 所有权，按分工单先在此挂账、由 Codex 决定改法）。
4. **渲染失败但 TTS 已对齐时客户端保持旧时长**：`page.tsx:223-231` 失败路径不导入 `alignedProject`（原子性正确），但叠加建议 1 的无复用，下一次重试会再次全额计费。建议 1 落地后，错误文案可补一句「重试不会重复计费」。
5. **UI 细节**：`page.tsx:196` 每次出片开始 `setRenderDownloads(null)` 会提前抹掉上一次成功的下载入口；已有的 `renderDownloads.signature === renderSignature(document)` 判旧机制本可让旧链接存活到新片成功。纯体验项。

## 边界声明（与他们的声明一致）

本轮证据能证明「链路通过」：闸门、原子性、编码、字幕 cue、音量非零。**不构成配音自然度/音质的商业级评价**——没有人耳主观审听；我在自己线上的有声成片同样只做了结构化核对。
