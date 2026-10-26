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
| Provider | `semantic-provider.ts`：端点白名单/密钥脱敏/60s 超时/16KB 限长/传输类失败重试恰好一次；提示词 v3 含能力目录+预算公式+时长纪律 | semantic-provider.test.ts 7 用例 |
| API 路由 | `/api/video/semantic-plan`：IR 校验失败或 Σ 偏离句中「N秒」目标 0.8N..1.2N → 一次带因修正重试；仍偏则透明标注 durationDeviation；任何失败不回退占位分镜 | route.test.ts 8 用例（假 fetch） |
| UI | page.tsx 独立「AI 生成分镜」入口（busy/失败面/确认卡 provenance 行/时长偏离提示行） | e2e-semantic-plan.mjs（VID-065） |
| 链路接入 | applyStoryboard 可选 provenance 参数（语义路径落 `planner-semantic/<model>/prompt<v>/compiler<v>`，默认 planner-rules/1 不变）；确认卡/追加/保存/导出/出片全走现有代码 | apply-plan.test.ts 14 用例 |
| QA registry | VID-065（browser-video 档） | `pnpm qa:validate` 117 自动用例通过 |

提示词版本 v3；编译器 v1。token usage 经 provider→route 原样透传（计费台账取证）。

## 二、四态

1. **代码实现**：完成（上表全部）。
2. **自动回归**：`pnpm test` 340/340 通过；`pnpm typecheck` 通过；`pnpm qa:validate` 通过。
3. **浏览器链路**：VID-065 无密钥失败面 E2E 通过（AI 入口 503 明示、不回退；旧句式规划回归正常；放弃无残留；控制台干净——503 资源日志按 response 事件对账放行）。真实千问浏览器全链（生成→确认卡截图→追加→保存→导出）双主题通过（audit-semantic-storyboard-live.mjs）。
4. **视觉质量**：确定性几何校验 LAYOUT OK——两片×双画幅×每镜入场帧+稳定帧共 150 个文本包围盒零出界零重叠（check-layout.mjs，思路移植 stem-visual）；末帧 YAVG 44-46（无黑屏结尾）；蒸发→凝结→降水屏幕顺序与旁白一致（位置 [433,450,467]）。

## 三、真实样片证据（本目录）

- `water-cycle.project.json` + `water-cycle-render/{landscape,portrait}.mp4`：横 1280×720/竖 720×1280、24fps、427 帧、17.79s（ffprobe）。
- `photosynthesis.project.json` + `photosynthesis-render/{landscape,portrait}.mp4`：607 帧、25.29s（20-30s 目标内）。
- `frames/`：44 张逐镜抽帧（每镜入场中段+稳定段，双画幅）。
- `*.confirm-card.png`：浏览器确认卡截图（无「要点 1/示意 1」占位文案，assert 在 audit 脚本）。
- `*.response.json`：路由完整响应（storyboard/provenance/usage/durationDeviation）。
- `generation-log.json`：每主题路由时延与 token usage。
- `check-layout.mjs` / `offset-sweep.mjs` / `flow-steps-sweep.mjs`：可复跑的确定性校验与校准工具。

## 四、偏离与已知限制（如实记录）

1. **时长对齐是概率性的**：句中目标 25s 时，多轮生成落在 17.4s..25.3s；带因重试后仍可能偏短。机制上以 durationDeviation 透明标注（路由响应+确认卡提示行），不硬失败。样片记录：水循环浏览器轮 17.79s（偏离标注在案）、直连轮 20.5s；光合作用 25.29s（达标）。
2. **cycle 阶段短注（caption）不上屏**：caption 挂在阶段节点下方，横版侵入注解带（y 650..800）与旁白注解必撞（几何实测 4+ 阶段）。阶段信息以 label 上屏（交接单验收口径），caption 细节由旁白承载；IR 仍接受 caption（校验 ≤12 字）。
3. **flow 走独立 flow-steps@1**：explainer-composition 的 flow 竖版布局组件内重排（diagramOffsetY/titleY 均不生效），标题×首步全参数空间恒叠位（offset-sweep 实测）；flow-steps 横/纵×2..4 步×双画幅最坏内容零碰撞。代价：flow 镜头旁白不上屏（无注解位），走 TTS/确认卡。
4. **音频链未验证**：本轮未跑 TTS 合成，有声成片链标为「未验证」（旁白文本/时长预算已按 TTS 口径约束：400+300×字数 ≤ durationMs）。
5. 视觉模型通道（读图→CDN→analyze）本机仍不可用（400），画面审片以确定性几何校验为准 + PNG 抽帧留档人工复核。
6. 无密钥/坏 JSON/超限/超时/4xx 均有分类错误与测试；模型输出非法时长等由确定性延长/拒绝兜住。

## 五、真实调用台账

| 主题 | 结果 | 路由时延 | tokens |
| --- | --- | --- | --- |
| 水循环（多轮） | 4..6 镜，13.2→20.5s | 14-20s | 1295-1390/轮 |
| 光合作用（多轮） | 5..6 镜，17.4→25.3s | 19-22s | 1326-1390/轮 |

约 10 次真实 qwen-plus 调用（含校准期的失败轮），总 tokens ≈ 1.4 万（qwen-plus 计价约 ¥0.1-0.2，远低于 ¥50 预算）。

## 六、复跑命令

```bash
pnpm --filter @acs/web test                          # 340/340
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
