# Codex 复核交接 —— `worktree-video-studio-p2`（P2.5-T4：媒体镜头出片链路）

- 日期：2026-10-19
- 工作树：`D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`；**主检出 `D:\codex\animate` 由用户管理，勿动**）
- 范围：`8ee700d..3fb9664`（11 提交，20 文件，+3033/−149：video-scene 裁切南迁、media-server、render-scene.media 纯逻辑、tts-sse 时长对齐排除、frame-dryrun 混编、remotion-engine 媒体通道、render-scene 编排、spec+plan 两篇、终评修复）。`8ee700d` 为 T3 收口点（上次复核范围的后续基线）
- 纪律：工作树内只读复核；**不要 push / merge / 改 HEAD**（集成由用户决定）；本刀零计费（`artifacts/tts-usage.jsonl` 台账 34 行不变）；媒体与证据不入库
- 回写约定：结论写 **`artifacts/codex-review-video-studio-p2-media-t4-result.md`**（勿覆盖本交接单）；格式沿 t1/t3 版（Review Focus 逐项 / Rulings 判定 / Declined 逐条 / Issues C-I-M / Ready to merge + reasoning）
- **状态**：本刀已完成一次 opus 终评（**0 Critical / 1 Important / 9 Minor，Verdict: With fixes**）。Important 与三条 Minor 已修复（`3fb9664`），其余 Minor 在册缓办（§6）。以下 §5 是本轮评审的回写，供 Codex 二次独立复核。

## 一、提交链（11 提交，spec → plan → 八任务 → 格式对齐 → 终评修复）

| 提交 | 内容 |
|---|---|
| `001c742` | spec：§0 现状锚点 · §1 架构总览 · §2 G/S/E/A/D/X 六表 · §3 错误文案 · §4 测试清单 · §5 非目标 · §6 验收 |
| `97447ce` | plan：8 任务全 TDD + Global Constraints + Review Focus 5 条 |
| `c273f9c` | Task 1 裁切数学南迁 `@acs/video-scene`（B2 单源，web 再导出；5 条 web 测试随迁） |
| `0c46e55` | Task 2 `media-server.mjs`（B1 白名单双闸 + 流式 + Content-Type 后缀） |
| `2de22cc` | Task 3 `render-scene.media.mjs` 装配纯逻辑 G1-G7（注入式单测） |
| `4a21a47` | Task 4 TTS 时长对齐排除媒体镜头（A1：C4 不可拉伸，溢出进 skipped 提示） |
| `fc85bb9` | Task 5 干跑混编语义（D1：量化全镜头、作业限 spec、全媒空载合法） |
| `98943ca` | Task 6 引擎媒体通道（E1-E3：OffthreadVideo + Sequence 本地帧 + 单源裁切） |
| `fef41d1` | Task 7 `render-scene.mjs` 编排接线（G1-G8：双服务/黑帧门禁/证据回写） |
| `51ca0ee` | biome 格式收口（media-server，零语义） |
| `3fb9664` | **终评 Important 修复**：keep×无音轨大声拒 + media-server `Accept-Ranges: none`/仅 GET + sha 读取异常中文化（RED→GREEN 5 条） |

## 二、核心判据（可挑战的不变量）

1. **G1 装配与 keep×音轨事实**（`render-scene.media.mjs:collectMediaShots`）：media 镜头 → entry（带账本资产快照）；账本缺、出点超素材时长、**`audio:"keep"` 而 `asset.original.hasAudio === false`** 三类问题进 `problems` 并由编排层在 spawn/渲染前统一中文拒。最后一条是本刀终评 Important 的修复：旧实现下「有旁白 + 无音轨素材 + keep」会 exit=0 但静默少一轨原声，「无旁白」则整片渲完才在 aac 门失败。编辑器 `buildMediaRevisePatch` 同规则行内拒（双保险）。
2. **X1 props 字节恒等**：spec 镜头仍由 `{ spec: entry.spec }` 首键展开，键序 `spec,startFrame,frames,narration?,subtitles?` 未变；media 镜头键序为 `src,assetWidth,assetHeight,inMs,outMs,fit,focalX,audio,trimBefore`（整串 JSON 断言锁死）。终评 reviewer **独立复跑 A1**：props 与 dataviz 旧产物 `cmp` 逐字节相等，4 条 contentDigest 逐一相等，新跑 MP4 SHA-256 与金样相同。
3. **B5 trimBefore**：`mediaTrimBefore` 复用 `roundHalfUp`，按源 fps 换算；Remotion 侧按合成 fps 解释（reviewer 对照 Remotion 4.0.534 源码确认口径）。
4. **G3 仓核验顺序**：形状门（regex，先于 fs）→ 存在性 → 流式 sha256 → 全部通过才 spawn 服务/渲染；失败 `process.exit(1)`，项目与 RenderRecord 只在全部画幅成功后写出。终评修复把 sha 读取异常也转成中文 `problems`（不裸抛 Node 栈）；存在性与 open 之间的竞态（流错误）仍在册缓办。
5. **G4 aac 判定**：`buildHasAudioTrack = 旁白数>0 || 任一 media audio=keep`；因 G1 已保证 keep 蕴含 `hasAudio`，该谓词与实际音轨事实一致。四象限有测试；终评 reviewer 实测冒烟产物旁白段与媒体段均有约 −24 dB 能量，keep 原声确实进混音，mute 版无音频流。
6. **B6/G5 黑帧门禁**：`parseTailYavg` 取多行 metadata 的最后一个 YAVG，缺失返回 null 且调用方大声失败；`isBlackTail` 阈值 `<=16`；16/17/缺失/多行有测试。reviewer 对约 40 个既有产物扫尾帧均 >44，未误伤历史产物。
7. **media-server 契约**（`media-server.mjs`）：仅监听 `127.0.0.1`；形状门 + 精确白名单双闸，任何不匹配一律 404；仅 GET（其他方法 405 + `Allow: GET`）；`Accept-Ranges: none`；Content-Type 按后缀；畸形 percent-encoding 400。`%2e%2e` 被 WHATWG URL 在 handler 前规范化，命中白名单原文件（200 + 字节相等）不是逃逸。
8. **编排接线**（`render-scene.mjs`）：旁白/媒体双服务各自 exit 钩子兜杀、白名单只放行本片 storeKey；干跑、渲染旗标、manifest `media` 块、RenderRecord `assetDigests`、黑帧门禁与 aac 门全部按 G1-G8 落位。
9. **前置切片整合**：TTS 时长对齐把 media 镜头排除拉伸（`{plan,skipped}`），干跑只给 spec span，`frameMap.componentId="media-clip"`；`verify-determinism`/`export-shot-svg` 按 X3 不动。

## 三、可复跑验证命令（期望输出）

```bash
cd D:/codex/animate/.claude/worktrees/video-studio-p0

# 单测 / 回归（2026-10-19 收口实测）
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"   # 111 pass
pnpm --filter @acs/video-scene test                                                                      # 136 pass（含 5 条裁切南迁）
pnpm --filter @acs/media-store test                                                                      # 31 pass
pnpm --filter @acs/web test                                                                              # 168 pass（167 + 1 keep×无音轨）
node --test scripts/video/*.test.mjs                                                                     # 83 pass（80 + 3 终评）
pnpm --filter @acs/web run typecheck                                                                     # 零错
pnpm --filter @acs/remotion-engine run typecheck                                                         # 零错
npx biome check .                                                                                        # clean（333 文件）
wc -l artifacts/tts-usage.jsonl                                                                          # 34（零计费）
```

冒烟证据（一次性，零计费，目录不入库）：`artifacts/video-studio-media-render/evidence.md`。成功路径 exit=0、landscape 末帧 YAVG=124.971 / portrait=170.672、manifest `media:[{trimBefore:12,frames:48,audio:"keep"}]`、RenderRecord×4 含 `assetDigests`；双跑 6/6 解码帧哈希相等；仓漂移反证 exit=1 且项目字节不变；mute 反证无音频流；A1 props 逐字节相等 + 4 条 contentDigest 相等。

## 四、给 Codex 的检查清单（按风险排序）

1. **keep×无音轨双保险是否闭合**：渲染期 G1 与编辑器 M 表各拒一次；但 T1 `validate.ts` 仍只校验 `audio` 枚举，手改 JSON 的「keep + hasAudio:false」能过文档校验、在出片前被 G1 拦下。我方裁定：T4 不扩 T1 数据契约（避免旧文档失效），渲染期大声拒已满足「不产错误产物」。请独立判断是否应在 validate 增 C7。
2. **media-server 仅 GET 是否影响客户端**：OffthreadVideo 下载器只发整 GET（reviewer 对照源码确认），无 HEAD/Range 需求；405 门在解码前。请确认没有其他调用方依赖 HEAD。
3. **verifyMediaAssets 的 catch 是否掩盖真实错误**：异常原因原样进中文消息，仍 exit=1、不写项目/RenderRecord。请判断是否应区分「读取失败」与「摘要不符」的错误码。
4. **X1 的持久性**：spec-only props 键序目前靠 A1 e2e 证据（reviewer 已独立复跑），尚无装配层单测；在册缓办。请评估残余风险。
5. **前置切片交互**：T1 `validateMediaAssets` 账本、T2 仓/proxy、T3 预览与本刀 G1-G8 的边界是否一致（尤其 `hasAudio` 只信账本、不重新 ffprobe——素材字节已被 sha256 钉死）。
6. **缓办 Minor 的定级**（§6）：流错误竞态、信号退出、去重、干跑日志、旁白溢出提示、两条回归钉子。

## 五、本轮终评回写（供独立复核）

- **Review Focus 5 条全过**：X1 字节恒等（独立复跑 props + contentDigest + MP4 SHA）、B5 半进位（整串 JSON 断言 + Remotion 口径核对）、G3 失败前置（代码顺序 + 证据）、G4 四象限（测试 + 产物音频能量实测）、B6/G5 解析健壮（16/17/缺失/多行 + 40 个历史产物扫描）。
- **Important（1，已修 `3fb9664`）**：`audio:"keep"` 遇无音轨素材的静默丢原声/晚失败路径。修复 = 渲染期 G1 problems + 编辑器行内拒；RED→GREEN 2 条。
- **Minor 已修**：M1 media-server 缺 `Accept-Ranges: none` 与方法限制（RED→GREEN 2 条）；M2 的 sha 读取异常中文化（RED→GREEN 1 条）；M8 spec/plan 命名与错误文案漂移（G2 字段、S1 参数、§3 逐字消息、`%2e%2e` 期望）；M9 A1 哈希引用过期（改为 `5b016ee3…`/`5a1e16da…`/`47b85441…`/`e64ec36a…` 与 MP4 `3c6950b9…`/`36f64db7…`）。
- **Rulings**：`%2e%2e` 规范化 200 是 WHATWG 事实、不是门被绕开（plan 测试已改写并留证）；Task 1 计划的 137 实为 136（5 条南迁）；Task 7 计划的 82 实为 80；Task 8 冒烟 shotId/versionId 必须 UUID（旁白 wav 命名随全 UUID 形）；冒烟渲染须 `ACS_MEDIA_STORE` 指向临时仓。以上均记入 `.superpowers/sdd/2026-10-19-video-studio-media-render/progress.md`。
- **Declined（reviewer 明列，未改）**：黑帧探针 `-sseof -0.2` 采样 EOF 前数帧（spec 明文）；合法纯黑背景可能被门禁误伤（spec 已裁）；后续画幅失败残留先前产物（既有语义）；`trimBefore+frames` 贴素材末尾 ≤1 帧；media×transitions 未冒烟（非本刀）；proxy 出片/manifest ffmpeg 版本/T5/T6 等非目标。

## 六、延后 Minor 台账（未修，不阻塞）

- **M2 剩余**：`createReadStream` 无 `error` 监听（existsSync/statSync 与 open 的竞态）；失败仍 exit≠0 不写项目，但子进程可能带栈崩溃、Remotion 侧报模糊下载错误。
- **M3**：只挂 `process.on("exit")`，SIGTERM/SIGINT 终止可能留下回环服务（Ctrl+C 通常打到同组子进程，CI `kill` 不一定）。
- **M4**：同一 storeKey 多镜头重复 sha 读盘；`STORE_KEY_PATTERN` 在 scripts/media-store/validate 多处同义复制；`media-server` 内联 decode 而非复用 `decodePathName`。
- **M5**：干跑日志打印量化总帧数并以「全部帧通过」收尾，混合项目实际只跑 spec span（语义与 D1 一致，措辞易误读）。
- **M6**：媒体旁白溢出的错误文案仍建议「先跑 tts-narration 重合成」，但 T4 起媒体镜头不可拉伸，照做无法消除溢出——应分支提示「缩短旁白/加大 outMs/--allow-truncate」。
- **M7**：spec-only timelineProps 键序无装配层单测；G3「失败不写项目」无编排层子进程测试（现靠 A1 证据 + 冒烟反证）。
- **T3 旧账**：F2 MediaStage failed 占位不随 assetId 复位、F3 assetLabel stock 后缀硬编码（T5 前死路径）、F4 uploadMedia 跨 await 陈旧闭包；P1/P2 期旧账仍在册，无新增阻塞项。

## 七、关键文件索引

- spec/plan：`docs/superpowers/{specs,plans}/2026-10-19-video-studio-media-render*.md`
- 纯装配：`scripts/video/render-scene.media.mjs`（G1-G7）+ `render-scene.media.test.mjs`
- 媒体服务：`scripts/video/media-server.mjs` + `media-server.test.mjs`
- 编排：`scripts/video/render-scene.mjs`（媒体装配/双服务/门禁/证据回写）
- 引擎：`packages/remotion-engine/src/scene-spec-composition.tsx`（MediaClipLayer）
- 裁切单源：`packages/video-scene/src/media-crop.ts` + `media-crop.test.ts`（web 经 `media-preview.ts` 再导出）
- 前置切片：`scripts/video/tts-sse.mjs`（A1）、`scripts/video/frame-dryrun.mjs`（D1）、`apps/web/src/app/video-studio/media-clip-templates.ts`（M 表 keep 守卫）
- 证据：`artifacts/video-studio-media-render/evidence.md`（不入库）
- 状态：`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部条目
- P2.5 总纲：`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md`（§4 T4 行）
