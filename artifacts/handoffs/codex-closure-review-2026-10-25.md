# Codex 复核结果：Video Studio C1–C5 收口

日期：2026-10-25。范围：`claude/video-studio-closure` 的 `5ac3375..de174fc`（代码止于 `7295ed6`，末提交是交接清单）。本次对共享 Claude 工作树仅作只读检查和不会写入跟踪文件的测试，结束时 `git status` 无改动。原 W2–W5 分支及此分支均未合并。

## 总结

**不建议现在合并。** C1 的直连 API 确认检查、C2 的累计帧量化和三段真实切片、C3 的触屏/键盘链路、C4 的 Blender 实际渲染都有证据；但 C1 闸门仍可通过移除确认字段绕过，C2 对外来 v2 清单的校验不构成可信边界，C4 的所谓“同 rig 对照”有可见的建模轴向错误。另有 C1 并发锁竞态和 C3 拖动后误拆解。以下按严重度列出。

## Important（合并前修复或明确收窄承诺）

1. **C1 确认并非强制，且已有确认可被清空。** `apps/web/src/app/api/video/render/route.ts:64` 调用 `approvalStatus`，但函数在 `styleFrameApprovals` 缺失/空数组时直接返回有效（`apps/web/src/app/video-studio/frame-approval.ts:106-111`）。该 API 直接信任 POST 中的项目副本，不读取保存时的旧确认状态；`assertAppendOnlyEvolution` 也不保护这个字段。把一个已确认且内容已改的项目从请求中删掉 `styleFrameApprovals`，新闸门就放行。这是清单 §1.1 写明的“设计语义”，但与 W2“确认代表帧后才出整片”的交付口径冲突。**影响**：该能力只能称为可选的失效提醒，不能称为强制质量闸门。需用可信、持久的“需确认”状态区分旧项目与已启用/新项目；或将产品承诺明确改为可选确认。
2. **C4 Blender 参照轴建错方向，现有对照并非同一几何。** `scripts/video/three/components/orbit3d.mjs:122` 用 `BoxGeometry(0.08, 2.2, 0.08)`，竖直长边是 **Y**；`artifacts/video-studio-c4-2026-10-25/build_scene.py:33` 却设 `axis.scale=(0.08, 0.08, 2.2)`，长边在 **Z**，相机沿 Z 看去后只剩金色小点。[横版对照图](../../.claude/worktrees/video-studio-closure/artifacts/video-studio-c4-2026-10-25/compare-landscape-mid.png)与竖版图均直接可见。**影响**：报告中“rig 参数级一致”、参照轴可见度/BBox IoU 和基于它的身份对照无效。改为 Y 轴后重渲关键帧、并排图和度量；之后才能评估材质差异。
3. **C2 `validateEditList` 会接受伪造的 v2 清单。** `scripts/video/export-edit-list.mjs:217-317` 未校验 `fps`，也未校验 `renderSources` 的文件名、摘要和 `totalFrames`；`sourceSpans.file` 只需等于同样可伪造的 `renderSources.file`。我以入库 v2 工件构造反例，`fps=0/-24/24.5`、`renderSources.landscape.file='../outside.mp4'` 或绝对路径、摘要为 `invalid`、`totalFrames=1`、删掉该画幅源、重复转场，各自均被 `validateEditList` **接受**。CLI 的 `--fps` 正整数检查（`:358`）只覆盖本工具生成新清单；不能让外部载入的 v2 清单安全。**影响**：将来消费端若按已校验清单拼路径，可越出交付目录；错误帧率/摘要也会被误认为可信。应按版本校验正整数 fps、整数帧区间、受限相对文件名、64 位 SHA、总帧数对账、每边界唯一转场、数组大小上限；消费端仍应在受限根目录解析和实测摘要。当前仓库没有编辑器消费端，故这是接口边界缺陷，尚非现成路径穿越执行漏洞。
4. **C1 的 `active` 409 并发闸门存在竞态。** `route.ts:25` 检查 `active` 后，`:34` 的 `await request.text()` 和 `:64` 的 `await approvalStatus()` 均让出执行；直到 `:80` 才置 `active=true`。两个并发 POST 可同时通过最初的 `active=false`，随后分别启动渲染。清单 §1.3 所称“409 先挡、时间窗被覆盖”与代码不符。**影响**：两个本地出片任务可同时占用 GPU/CPU 并争用作业资源。需在第一个异步边界前原子占位，并用同一 `finally` 释放；保留失败路径的 400/503 语义。
5. **C3 拖动后快速单击会被当作双击拆解。** `scripts/video/w4-interactive/app.js:94-110` 在 pointerdown 时记录“上次点击”，`:114-124` 拖动时不清除候选。真实 Chromium 复现：鼠标按下→拖动 20 px→松开→350 ms 内在 40 px 半径内单击，`data-exploded` 从 `false` 变 `true`，虽然只发生了一次单击。**影响**：用户调整角度后点一下会意外拆解；触屏拖拽后轻点也可能误触发。只将未发生有效位移且已完成的 tap 纳入双击配对；pointercancel 应清除候选。

## Minor / 证据口径

- **C2 渲染源只验存在与 SHA，不验媒体属性。** `export-edit-list.mjs:183-192` 的 `totalFrames` 是从项目预计值直接填写，未用 ffprobe 检查源视频的真实帧数、画幅或编码；单测甚至把字符串 `fake-landscape-bytes` 当 MP4 源仍通过。应区分“文件摘要已记录”与“可切片视频已验证”。真实 STEM 源与留存切片有效，但一般输入尚无此保证。
- **C2 切片回归未锁定 `-t` 多包帧反例。** 报告记录人工实测 97≠96；`export-edit-list.test.mjs` 只检查命令文字含 ffmpeg/重编码，未断言该差值。已入库三段切片经独立 `ffprobe` 分别是 72、96、72 帧，可补一条轻量媒体回归或保留为手工证据，不必每次全片重渲。
- **C3 性能数字是独立 rAF 计数。** `e2e-w4-touch-a11y.mjs` 统计另一个 `requestAnimationFrame` 回调，并未读取 app 已公开的 `framesRendered()`；因此 56–60 fps 不能直接等同 WebGL 实际绘制帧率。报告已标明 rAF 口径，建议若要做性能门禁改测实际 render 计数。真机触屏与读屏器仍未测。
- **C4 GPU 归因措辞过强。** `nvidia-smi` 是整卡、0.5 秒采样；低利用率和单帧时长不能独立证明“GPU 未实际承载采样”。程序已显式启用 OPTIX，报告也观察到相对 CPU 计时的差异。可以确定的是“表现低于旧样片且设备归因未决”；不要把该轮成本称为已证实的“CPU 侧速率”。便携版来源和官方 ZIP SHA 在 `artifacts/blender-gpu-spike-2026-10-09/REVIEW.md` 已留档，C4 报告应直接引用。
- **测试库登记缺口。** C2 增补的单测仍由 VID-053 跑到；C1 route 单测在 Web 套件、浏览器链路由 VID-051 覆盖。C3 新 `e2e-w4-touch-a11y.mjs` 与 C4 Blender 冒烟未入 `qa/registry.json`，故 `qa:validate 105/56` 不代表两条新链路会在后续版本回归时自动运行；至少登记合适的 integration/manual-gpu tier。
- C4 `build_scene.py` 和 `c4-blender-dual.mjs` 写死本机执行器/工作树绝对路径，离开该机器不能按报告命令原样复跑；这是样片脚本可移植性限制，不妨碍当前本机证据。

## 独立复核证据与四态

| 项 | 代码 | 自动回归 | 真实操作 | 视觉/人工质量 |
| --- | --- | --- | --- | --- |
| C1 | 已实现服务端复验，但有清空字段绕过与并发竞态 | route 9/9；Web 全套首跑 309/310、随即复跑 310/310（单次失败未稳定复现）；typecheck 通过 | Claude 留存合法双画幅 e2e，本轮未重跑 2.7 分钟出片 | 不适用 |
| C2 | v2 累计量化、转场窗、切片方案已实现；外来清单校验不足 | `export-edit-list` 12/12 | 入库 STEM 清单与 `render-manifest` 横竖 `frameMap` 逐镜相等；独立 ffprobe 三切片 72/96/72 帧 | 转场结构证据可信；编辑器真实往返未做 |
| C3 | 触摸与键盘交互已实现，拖动后误触发待修 | 既有脚本的证据已留；本轮用真实 Playwright 鼠标操作复现误触发 | file:// 样片可打开；用户真机触屏未测 | 演示级，不代表商品画面质量 |
| C4 | Blender 源与脚本在库；参照轴移植错误 | 冒烟报告/像素断言已留，本轮未重跑高耗时渲染 | 关键帧、运动片段和 `.blend` 存在，并排图已视觉检查 | 现有同 rig 比较待纠正；人工评分仍为空 |

流程检查：`cb0ce2e` 仅格式化 `route.test.ts` 的 6 行；交叉编辑没有未提交残留，**但这不足以替代上述语义复核**。工作树在本次结束时仍无未提交改动。合并前先修 Important；随后只复核受影响增量。Blender 全长 72×2 帧仍是外推，不应写为已渲。
