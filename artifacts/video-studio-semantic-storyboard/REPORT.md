# 语义分镜（AI 分镜生成与现有组件出片）交付报告

分支 `claude/video-semantic`（基线 main@655cbdf），2026-10-26。
交接单：`artifacts/handoffs/claude-video-studio-semantic-storyboard-2026-10-26.md`。

## 一、交付内容

用户自然语言 → 服务端千问（DashScope OpenAI 兼容）→ 受限 SemanticStoryboardDraft IR
→ 纯函数校验/归一化/确定性编译（只选已注册组件）→ 现有确认卡/applyStoryboard/
内容版本/双画幅/出片链，全链零新编辑器桥。

| 环节 | 实现 | 测试 |
| --- | --- | --- |
| IR 契约+能力目录 | `apps/web/src/app/video-studio/semantic-storyboard.ts`（限制全部锚定组件真实契约） | semantic-storyboard.test.ts 10 用例 |
| 确定性编译器 | 同上；durationMs=模型下限意图，编译器延长到 max(IR, 演完下限, 400+300×旁白字数)（同旧规划器 speechAwareDurationMs 下限语义） | 同上 |
| Provider | `semantic-provider.ts`：端点白名单/密钥脱敏/60s 超时/16KB 限长/传输类失败重试恰好一次；提示词 v4 含能力目录+预算公式+时长纪律+素材边界/准确性纪律 | semantic-provider.test.ts 7 用例 |
| API 路由 | `/api/video/semantic-plan`：真实素材需求规划前判定（needs-assets 422+授权放行）；IR 校验失败或 Σ 偏离句中「N秒」目标 0.8N..1.2N → 一次带因修正重试；仍偏则透明标注 durationDeviation；任何失败不回退占位分镜 | route.test.ts 12 用例（假 fetch） |
| UI | page.tsx 独立「AI 生成分镜」入口（busy/失败面/确认卡 provenance 行/时长偏离提示行） | e2e-semantic-plan.mjs（VID-065） |
| 链路接入 | applyStoryboard 可选 provenance 参数（语义路径落 `planner-semantic/<model>/prompt<v>/compiler<v>`，默认 planner-rules/1 不变）；确认卡/追加/保存/导出/出片全走现有代码 | apply-plan.test.ts 14 用例 |
| QA registry | VID-065（browser-video 档） | `pnpm qa:validate` 117 自动用例通过 |

提示词版本 v4（cycleSteps 纯字符串、严格字段纪律、素材边界指引、cycle 仅限真循环）；编译器 v1。token usage 经路由合计（usage 汇总 + usageCalls 分项，重试不低报）。

## 二、四态

1. **代码实现**：完成（上表全部）。
2. **自动回归**：`pnpm --filter @acs/web test` 350/350 通过；Web typecheck 通过；QA registry 校验通过。
3. **浏览器链路**：VID-065 无密钥失败面 E2E 通过（AI 入口 503 明示、不回退；旧句式规划回归正常；放弃无残留；控制台干净——503 资源日志按 response 事件对账放行）。真实千问浏览器全链（生成→确认卡截图→追加→保存→导出）双主题通过（audit-semantic-storyboard-live.mjs）。

### Codex 二轮修复（2026-10-27，CODEX_REVIEW_ROUND2.md）

- P1 资产需求边界：`requiresRealAssets` 在规划前确定性判定用户句（高精度模式，题材词不误伤）；未授权 → 422 `kind=needs-assets`（一次模型调用都不发生），UI 提供「改用图解生成」明示授权入口，授权轮响应带 `substitutedForAssets` 标记。锁定测试：用户句要真实照片+假模型返回合法图解 IR → 仍 422 且 0 次调用；授权 → 200。
- P2 E2E：e2e-semantic-plan 加路由拦截轮——第一次 AI 调用伪造合法分镜（确认卡出现）→ 第二次延迟 500 → 等待期间旧卡即消失、失败明示（覆盖「成功候选→二次请求失败/等待中」路径）。
- P2 报告同步：本节及全文数字统一为 a31111a 后事实（v4/349 用例/route 12 用例/usage 合计/新样片时长）。

### Codex 三轮复核与修复（2026-10-27）

- 请求体即使是合法 JSON `null` 也返回 400，不再触发未处理异常；新增回归测试。
- 「用真实的产品照片」「我上传的图片」「客户提供的商品原图」纳入素材边界识别；否定句如「不要用真实照片，只做图解」不误拦。这是常见说法的确定性规则，不声称覆盖任意自然语言。
- 用户明示选择图解替代后，确认卡显示「不包含原要求的真实照片或素材」；来源记录的 `engineVersion` 附带 `diagram-substitute`，保留这一选择的可追溯标记。
- 无密钥浏览器 E2E 已实跑：真实素材请求→能力边界提示→用户点击图解替代→进入模型配置检查；拦截成功响应时确认卡显示替代提示，旧候选撤销链仍通过。
- 本轮复跑 Web 350/350、Web typecheck、QA registry 117 自动/56 手工、目标文件 Biome。先前四段双画幅样片为规划器变更前的真实输出；本轮只修改素材边界与 UI 提示，未重新调用付费模型或重渲样片。音频仍未验证。

### Codex 复核修复轮（2026-10-26，CODEX_REVIEW.md 四项必修全闭合）

- P1-1 新 AI 请求开始即撤销旧候选（page.tsx setEditor 守卫清除 storyboard），失败后无旧卡可错标；e2e-semantic-plan 加「规则卡→点 AI→卡消失」回归。
- P1-2 IR 严格键集合校验（根/镜头两级），资产/代码类字段拒绝并给素材边界指引（「改用图解或人工导入」），不再无声转通用图解；单测+API 假响应测试覆盖。
- P2-3 caption 从 IR 移除（cycleSteps 纯字符串），关键信息必须写进 label/旁白，编译不再静默丢内容。
- P2-4 重试 usage 合计+分项（usage 汇总、usageCalls 明细），双调用测试锁定；实测光合作用轮 2641 tokens=两调合计。
- 提示词 v4 增加「cycle 仅限真正首尾相接的循环，单向过程用 flow」准确性纪律：本轮光合作用样片全部 flow-steps（无「四步循环」误导），水循环 cycle+三镜分阶段详解（汽化吸热/凝结核/重力下落）。

### 独立全分支评审（2026-10-26，修复后数字）

无 Critical。5 项 Important 已全部修复：I-1 AI 回调过期闭包（函数式 setEditor + 文档 id/请求序号守卫）；I-2 semanticPlan 生命周期（旧规划点击即重置、三处项目切换重置、AI 期间互斥禁用——规则产物不再可能错标 AI provenance）；I-3 证据三件套同轮落盘（*.response.json=浏览器轮，*.probe.json=直连取样轮，脚本内断言三件一致）；I-4 UI 失败面拼接逐镜 errors[]；I-5 确认卡 renderHint 列出每镜屏幕文字（标题/要点/循环阶段/流程步骤）。M-1 提示词版本补 bump 至 v3。M-2..M-7 记账缓办（见分支 ledger）。
4. **视觉质量**：确定性几何校验 LAYOUT OK——两片×双画幅×每镜入场帧+稳定帧共 168 个文本包围盒零出界零重叠（check-layout.mjs，思路移植 stem-visual）；末帧 YAVG 44-46（无黑屏结尾）；蒸发→凝结→降水屏幕顺序与旁白一致（位置 [433,450,467]）。

## 三、真实样片证据（本目录）

- `water-cycle.project.json` + `water-cycle-render/{landscape,portrait}.mp4`：横 1280×720/竖 720×1280、24fps、506 帧、21.08s（20-30s 目标内，无偏离）。
- `photosynthesis.project.json` + `photosynthesis-render/{landscape,portrait}.mp4`：547 帧、22.79s（20-30s 目标内；重试轮 usage 合计 2641）。
- `frames/`：48 张逐镜抽帧（每镜入场中段+稳定段，双画幅）。
- `*.confirm-card.png`：浏览器确认卡截图（无「要点 1/示意 1」占位文案，assert 在 audit 脚本）。
- `*.response.json`：**浏览器轮**路由完整响应（与确认卡截图、project.json 同轮生成，脚本断言三件一致）；`*.probe.json`：直连取样轮（时延/usage 对比）。
- `generation-log.json`：每主题路由时延与 token usage。
- `check-layout.mjs` / `offset-sweep.mjs` / `flow-steps-sweep.mjs`：可复跑的确定性校验与校准工具。

## 四、偏离与已知限制（如实记录）

1. **时长对齐是概率性的**：多轮生成落在 13.2s..25.3s；带因重试后仍可能偏短，机制上以 durationDeviation 透明标注（路由响应+确认卡提示行），不硬失败。本轮修复轮双主题均达标（21.08s / 22.79s）。
2. **cycle 阶段短注（caption）不上屏**：caption 挂在阶段节点下方，横版侵入注解带（y 650..800）与旁白注解必撞（几何实测 4+ 阶段）。阶段信息以 label 上屏（交接单验收口径）；caption 已从 IR 删除（严格键集合不接受），细节必须写进 label/旁白，编译零静默丢弃。
3. **flow 走独立 flow-steps@1**：explainer-composition 的 flow 竖版布局组件内重排（diagramOffsetY/titleY 均不生效），标题×首步全参数空间恒叠位（offset-sweep 实测）；flow-steps 横/纵×2..4 步×双画幅最坏内容零碰撞。代价：flow 镜头旁白不上屏（无注解位），走 TTS/确认卡。
4. **音频链未验证**：本轮未跑 TTS 合成，有声成片链标为「未验证」（旁白文本/时长预算已按 TTS 口径约束：400+300×字数 ≤ durationMs）。
5. 视觉模型通道（读图→CDN→analyze）本机仍不可用（400），画面审片以确定性几何校验为准 + PNG 抽帧留档人工复核。
6. 无密钥/坏 JSON/超限/超时/4xx 均有分类错误与测试；模型输出非法时长等由确定性延长/拒绝兜住。

## 五、真实调用台账

| 主题 | 结果 | 路由时延 | tokens |
| --- | --- | --- | --- |
| 水循环（多轮） | 4..6 镜，13.2→21.1s（修复轮交付 21.08s） | 14-21s | 1295-1390/轮 |
| 光合作用（多轮） | 5..6 镜，17.4→25.3s（修复轮交付 22.79s，usage 合计 2641=两调） | 19-22s | 1326-2641/轮 |

约 14 次真实 qwen-plus 调用（含校准与评审修复轮的失败/取样），总 tokens ≈ 1.9 万（qwen-plus 计价约 ¥0.2-0.3，远低于 ¥50 预算）。

## 六、复跑命令

```bash
pnpm --filter @acs/web test                          # 350/350
node scripts/video/e2e-semantic-plan.mjs             # VID-065（需无密钥 dev server，BASE_URL 可覆写）
node scripts/video/audit-semantic-storyboard-live.mjs # 真实千问（需 DASHSCOPE_API_KEY dev server）
node scripts/video/render-scene.mjs --project artifacts/video-studio-semantic-storyboard/water-cycle.project.json --out /tmp/out
node artifacts/video-studio-semantic-storyboard/check-layout.mjs   # LAYOUT OK
```

## 七、给 Codex 的复核重点

1. `semantic-storyboard.ts` 的延长语义：durationMs=下限意图是否会与「用户明确要短」冲突（当前: 演不完/读不完优先于短）。
2. 路由时长目标的 0.8N..1.2N 窗口与「N秒」解析（5..120s 之外忽略）是否覆盖真实句式。
3. flow-steps 切换后竖版视觉（几何零碰撞已证，观感请抽帧复核）。
4. durationDeviation 透明标注 vs 硬失败的取舍（当前：不硬失败，确认卡明示）。
5. cycle caption 不上屏的内容损失是否可接受（或后续给组件加注解带避让布局）。
