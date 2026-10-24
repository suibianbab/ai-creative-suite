# Claude 二轮复核（增量）：codex/video-narrated-workbench @ 9b8be55

- **对象**：提交 `c01bff1..9b8be55`（单提交 "Address narrated workbench review findings"），即交接单末节「对 Claude 二轮审核的整改」对应的分支新增量。
- **方式**：整改文件全文精读（非仅 diff）+ 零网络测试实跑 + 共享台账/缓存/锁实况只读核验。不修改任何生产代码；未发起任何付费 TTS。
- **前置核对**：该工作树当前检出已切至 `codex/video-stem-integration`（99bebd0）。经 `git diff 9b8be55 -- <送审路径>` 逐一比对，本报告涉及的全部代码文件（tts-narration/tts-ledger/tts-sse/render-local/page.tsx/local-video-projects(.test)/subtitles/e2e-narrated-workbench）与 9b8be55 **完全一致**；工作树仅 sample-gallery/shot-editor-card/composition-templates/video-studio.css 带 STEM 线后续增量（不在送审范围）。测试均在该一致内容上执行。

## 结论：N1–N7 全部真实修复，未发现新的阻断项

| 项 | 判定 | 关键证据（9b8be55 文件:行） |
|---|---|---|
| N1 已计费资产复用 | **修复** | `scripts/video/tts-narration.mjs:98-128` 内容寻址缓存（sha256(model+voice+text)），仅 `saved:true` 计费成功后写入（:229-238）；作业目录清理（`render-local.ts:108-120`）够不到 Git common dir 下的缓存；restore 校验 RIFF/model/voice/sentences 后复制，失败按 miss 处理（宁重付不错用）。实况：`D:/codex/animate/.git/acs-video-tts/cache/` 14 文件（7 组 wav+words），台账维持 28 条，`.tools/tts-cache-smoke/` 在场 |
| N2 渲染期间编辑丢失 | **修复** | `page.tsx:552-556` 整个编辑区 `fieldset disabled + inert + aria-busy`（React 19.2 布尔 inert，typecheck 过），标题/一句话/转场/修订(onRevise :820)/素材/风格面板全在其中；返回列表 `disabled={busy}`（:543）。失败路径保留 `saved ?? project` 与错误提示（:253-263）。证据脚本 `.tools/n2-browser-lock.mjs`（busy 中 fill 被拒、失败后标题原值断言） |
| N3 台账按工作树分账 | **修复** | `scripts/video/tts-ledger.mjs:16-22` 共享根=Git common dir；:24-47 `open(wx)` 单飞锁（跨工作树互斥，测试实证）；:49-82 迁移按 requestId 去重、每次运行增量同步旧账。实况：共享台账 28 条、¥0.0656、requestId 全唯一、无残留 active.lock；旧账文件仍在原位（设计为增量重读，非删除） |
| N4 双导入非原子 | **修复** | `local-video-projects.ts:364-429` `importVideoProjectChain`：链内全部版本在**同一** readwrite 事务 get→逐版快进校验→双 put，任一步 throw 即 `transaction.abort()`；`page.tsx:231-235` 对齐版+渲染版走链。篡改反例测试证明无中间版本残留（`local-video-projects.test.ts:316-344`，实跑 8/8 过） |
| N5 异常调用不入账 | **修复** | `tts-narration.mjs:243-261` 上游异常/非 stop/非 RIFF 一律追加 `saved:false, uncertain:true` 估算行；`ledgerTotalCny`（:56-68）对**所有**条目求和（含 uncertain）→ 预算被预留不被低估。成功路径 `saved:true`（:215-226） |
| N6 Windows 杀进程树 | **修复** | `render-local.ts:83-94` 超时 `taskkill /PID <pid> /T /F`（杀整树），失败回退 `child.kill()`；:108-120 `cleanupFailedJob` maxRetries=5 重试、失败仅 warn 不遮原始错误 |
| N7 清空旧下载链接 | **修复** | 渲染开始的 `setRenderDownloads(null)` 已删除；唯一剩余调用在「从样片库新建项目」（`page.tsx:180`，换项目，正当）。失败保留旧链接，成功替换（:236-241），签名门（:1076-1077）维持 |

N8（字幕并标点可 11 字）按交接为**挂账并文档化**：`subtitles.ts:24-25` 注释明确「允许前一条多带该标点」口径，行为未改——与声明一致。N9（旁白判定双拷贝）**如实未改**：谓词仍内联于 `route.ts:48` 与 `page.tsx:1064-1069`。N10 **修复**：`e2e-narrated-workbench.mjs:57` 等待 1,520,000ms ≥ 服务端 TTS(900s)+渲染(600s)=1500s 预算。

## 实跑验证（零网络）

- `node --test scripts/video/tts-sse.test.mjs`：**21/21 过**（含新增「同仓 worktree 共用台账：旧账按 requestId 去重、后续同步并阻止并发计费」——临时 Git 双工作树夹具实证锁互斥与增量迁移）
- `node --import tsx --test src/app/video-studio/local-video-projects.test.ts`：**8/8 过**（含双版本链事务原子性篡改反例）
- `node --import tsx --test src/app/api/video/render/{render-local,route}.test.ts`：**7/7 过**
- `tsc -p apps/web --noEmit`：**通过**（fieldset/inert 新 props 类型面成立）
- 共享台账只读核验：28 条 / ¥0.0656 / unique requestId / 0 uncertain / 无锁残留 / cache 14 文件——与交接声明逐项吻合

## 非阻断残留（供集成决策，均不构成回退理由）

1. **强杀后遗留锁阻塞后续 TTS（可用性，计费方向保守）**。`render-local.ts:84-93` 的 `taskkill /F` 杀死 tts-narration 时其 `process.once("exit")` 释放钩子不会执行（Ctrl+C 信号死亡同理）→ `D:/codex/animate/.git/acs-video-tts/active.lock` 残留 → 后续所有工作树有声出片报「已有 TTS 计费任务或遗留锁」需手删。复现：narrated 渲染超 900s 触发超时杀树，或 CLI 运行中 Ctrl+C，再发起有声出片。影响：仅可用性；不重复计费（锁保守停住）。建议后续在报错中带锁文件 mtime/PID 辅助判断。
2. **旧版工作树 CLI 绕过锁与共享账**（交接已自曝）。旧版无锁概念、只写本地旧账，其并发花费对共享账不可见，直到下一次迁移重读。集成时按分工停用旧版发起计费即可；建议终迁移后删除各旧账文件，让任何旧版误用表现为「旧账重新出现」可被察觉。
3. **品牌链接可在渲染中导航离开**。`page.tsx:535` `<Link href="/">` 在 fieldset 之外且未接 busy 门——预存行为。复现：有声渲染中点左上角品牌，页面卸载，成功回调不执行。影响：该次已计费渲染的导入（renderRecords/下载链接）落空；MP4 留在服务端作业目录待 30 上限淘汰，WAV 缓存仍在。用户编辑无丢失（渲染前已 `saveVideoProject`，:205）。非本轮引入，不阻断。
4. **uncertain 台账行丢了 HTTP body 里的 request_id**。`tts-narration.mjs:187-190` HTTP 失败时 `parsed` 尚未赋值，:255 记 `requestId: null`，尽管 `describeHttpFailure` 已从 body 提取到 request_id。影响：对账/工单时 uncertain 行无法直接定位请求；预算安全不受影响。建议后续把提取到的 id 传入异常对象。
5. **缓存无上限**。`<common>/acs-video-tts/cache/` 只增不减（当前 14 文件），无淘汰策略；缓存写失败仅告警（:234-238，下次可能重付，交接已披露）。本地开发规模下无碍。
6. **锁创建自锁窗口（极小概率）**。`tts-ledger.mjs:31-35` 若 `openSync(wx)` 成功而 `writeFileSync` 抛出，自己创建的空锁文件会让本次与后续都误报「已有任务」需手删。仅磁盘级故障可触发。
7. **9b8be55 的 CSS 复位过度（已在集成分支修正）**。9b8be55 的 `.editor-pane{margin:0;padding:0;border:0}` 覆盖了共享规则的 `margin:0 auto; padding:28px 24px 48px`，fieldset 化后编辑区失去居中与内边距；当前 `codex/video-stem-integration`(99bebd0) 已收窄为 `min-width:0; border:0`。若该分支后续被重写需注意保留此修正。

## 流程备注

- 送审范围、实测口径与交接单末节一致；其自报「web 283/283、全工作区 typecheck、Biome」未整体复跑（工作树已并入 STEM 线新文件，全量数字不再对应 9b8be55 状态），改为对送审面逐文件等价性比对 + 相关测试全量实跑，结论不受影响。
- 分支尖 `9b8be55` 在 `codex/video-narrated-workbench` 上；该物理工作树现检出 `codex/video-stem-integration`。审核引用的行号均指 9b8be55 内容。
- 真实付费复跑（VID-047/048 组合、集成后双画幅成片、晚帧字幕重看、人耳听审）仍待集成轮，本轮未执行任何付费调用，与「链路通过≠配音商业水平」的四态口径一致。
