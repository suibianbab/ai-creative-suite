# Codex 复核结论：Video Studio N1/N2/N3

范围：`main@17e17e7..claude/video-next-n123@3167f2c`。本轮只复核，未改生产代码，也未合并。结论：**N1 证据基本成立；N2/N3 有阻断合并的问题，修复后做增量复核。**

## 发现（按优先级）

### P1 — N3 新 IR 未校验字段形状，坏时间线可令规划接口返回 500

`apps/web/src/app/video-studio/semantic-storyboard.ts:503-605` 只校验通用字段及旧三类意图；`compare-explainer` 的字段类型、必填和长度，`timeline-explainer` 的 `milestones` 数组长度、条目结构、`status` 均没有校验。允许键名不等于校验值。复现：`validateSemanticShot({intent:'timeline-explainer',title:'测试',narrationText:'看看过程',durationMs:3000,milestones:'坏数据'})` 返回 `ok:true`，紧接着 `verifySourcedNumbers` 在 `.entries()` 抛 `TypeError`。两个路由在调用数值闸时都没有异常边界（`/api/video/semantic-plan/route.ts:106-109`、`/api/video/semantic-revise/route.ts:125-127`）。这类模型输出或请求最终会变成未分类的 500，不能得到约定的一次带因重试或 422。对比字段的错误类型也可通过 IR 校验，之后才在编译阶段失败，浪费了修正机会。

修复要求：按组件契约校验全部新字段及嵌套条目；错误返回字段路径，交给既有一次重试流程。增加字符串/对象/null `milestones`、null 条目、错误 `status`、缺失或错型对比字段的反例测试，并覆盖两个路由。

### P1 — 数值来源闸不能兑现“不给编造数据出片”

`semantic-storyboard.ts:649-689` 只检查 `beforeValue/afterValue/deltaText/milestones[].date`，没有检查同样会进入画面或旁白的 `title/metricLabel/beforeLabel/beforeNote/afterLabel/afterNote/narrationText/milestones[].label`。复现：用户指令“比较读书和手机”，对比 IR 的 `beforeNote:'提高85%'`、`narrationText:'效果提高85%'` 均能通过 `verifySourcedNumbers`（返回 `[]`）。此外它把原话中任意两个数相减，不核单位或语义：原话“耗时从1小时变为30分钟”时，`deltaText:'缩短29分钟'` 也返回 `[]`。这些错误数字可进入最终视频，而报告把该闸描述为数值防伪造。

修复要求：扫描所有会展示、朗读的字段；数值推导至少要求相同单位和同一可比较量。若无法可靠判定，就只接受用户原话明确出现的数值，差值改用定性文字或请求人工确认。为字段遗漏、混合单位、同数不同单位写反例。文字事实真实性仍需单独评估，不能以此数字闸宣称通用事实核验。

### P2 — N2 请求 JSON 为 `null` 时抛异常

`apps/web/src/app/api/video/semantic-revise/route.ts:65-74` 解析 JSON 后立即读取 `body.instruction`，未像整片规划路由那样检查顶层对象。复现：同源 POST 正文 `null`，直接调用 `POST` 抛 `TypeError: Cannot read properties of null (reading 'instruction')`。应返回 400“请求格式无效”，且不调用模型。补 `null`、数组、原始字符串测试。

### P2 — 用户授权“改用图解”后，候选及版本不保留替代标记

单镜路由把 `substitutedForAssets:true` 放在顶层响应（`semantic-revise/route.ts:208`），但 `page.tsx:749-786` 的响应类型和候选状态不接这个字段；`shot-editor-card.tsx:2971-3005` 的确认卡不显示替代事实；`page.tsx:823-834` 写入新版本的 provenance 也不保留。用户虽在错误提示中点过“改用图解生成”，后续确认与重开项目已看不出该镜头是素材需求的图解替代。应在候选确认卡明确标记并持久记录，测试保存重开。

## 已核实的正向结果与边界

- N1 双画幅样片实际存在，哈希与 `report.json` 一致；`ffprobe` 显示横版 1280×720、竖版 720×1280，均有 H.264 视频和 AAC 音轨。抽看 `shot-3-subtitle.png`，字幕可见。脚本中的逐镜版本/字幕断言已查阅；本轮没有重新调用收费的千问/TTS，也未独立听审整片，因此“视听质量达标”仍限于结构和抽帧证据。
- N2 的候选确认、只追加内容版本、目标工作版本冲突检查和锁定时拒绝的代码路径存在，既有 E2E 报告显示通过。本轮未重复收费的浏览器全链。
- N3 对比样片的抽帧版式可读；`check-layout.mjs` 复跑为 `LAYOUT OK (130 texts checked)`。该检查证明文本几何未碰撞，不证明数字真实或叙事准确。
- `pnpm --filter @acs/web test`：364/364；`pnpm --filter @acs/web typecheck`：通过；`node scripts/qa/run-regression.mjs validate`：117 自动、56 手工登记有效。直接 `pnpm qa:validate` 因本机 pnpm 9 与项目声明的 pnpm 11 不匹配而拒绝，改用同一脚本入口完成验证。

## 建议验收门槛

先修两项 P1 和两项 P2，补反例测试；保持 N1/N2 已有版本与音轨回归通过。只需对修复增量复核，无需重新生成全部付费样片。新增数字字段或替代记录触及可见结果时，抽一条对比镜头和一条单镜替代候选进行浏览器确认。
