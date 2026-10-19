# Video Studio P2.5-T4 设计：媒体镜头出片链路（render-scene 媒体 props + OffthreadVideo + 原声混音 + assetDigests + 成功判定收口）

- 日期：2026-10-19；分支 `worktree-video-studio-p2` 续叠（基线 = T3 收口 `8ee700d`）
- 上游：`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md` §4 任务 4 + §3 数据流行 6（出片成功/失败语义）+ §2.3 确定性口径
- 依赖：T1 契约（SceneSource media-clip C1-C6 + MediaAsset 账本 + `RenderRecord.assetDigests?` R1-R2 已校验缺写入方）；T2 仓（`originalPath`/`resolveStoreRoot`/storeKey 形状门）；T3（op mediaClip 通道 + 预览裁切数学）
- 本刀性质：**scripts/video 出片脚本 + @acs/remotion-engine 合成器 + @acs/video-scene 纯函数迁移**。零网络、零计费（旁白冒烟用 ffmpeg 合成假件）；单测零 Remotion 渲染（真渲染 = 一次性手工冒烟 + T6 VID-023 e2e）

## 0. 现状锚点（2026-10-19 勘察，行号以本工作树为准）

1. **双 spec 门**：`render-scene.mjs:130-131` 对非 spec 场景源大声拒（「出片仅支持 spec 镜头」）；第二道在 `frame-dryrun.mjs:105-106`（`buildProjectDryRunJobs`，render-scene:258 调用）。`verify-determinism.mjs:79-80` 与 `export-shot-svg.mjs:39` 也拒非 spec——后两者按设计就是单镜头 spec 工具，本刀**保持拒绝**。
2. **Timeline props 与合成器**：`render-scene.mjs:291-331` 装配 `timelineProps.shots = [{spec, startFrame, frames, narration?, subtitles?}]`；类型 `TimelineShotProps`/`TimelineProps` 在 `packages/remotion-engine/src/scene-spec-composition.tsx:103-120`；`TimelineScene`（128-185）逐镜头 `Sequence` 内挂旁白 `<Audio>` + `renderSpecLayer(active.spec, …)`。**props 文件双画幅逐字节一致**（transitions 金标准注释 335 行明示的既有不变量）。引擎全程无任何视频元素。
3. **画幅是 1280×720 / 720×1280**（`root.tsx` 六 Composition + `render-scene.mjs:35` DIMENSIONS，双处手工同步）；fps 恒 24（SCENE_FPS）。
4. **音频链**：旁白 wav 由独立进程 `narration-server.mjs` http 托管（白名单精确串 + CORS * + `Content-Type: audio/wav` + readFileSync 整读；探针裁决注释 185-191 行：Remotion CLI 渲染的媒体 src 只认 http(s)，`file:///` 抛「Can only download URLs starting with http://」、data URI 静默无声）；混音由 Remotion 对挂载的音频元素自动完成，**全仓无 ffmpeg amix**。aac 门 = `narrationEntries.length > 0`（render-scene:416-436，媒体 keep 原声可造出「零旁白却有音轨」，该条件必须拓宽）。
5. **Remotion 4.0.534**（`@remotion/cli` 4.0.534，无 lambda；渲染走 `pnpm --filter @acs/remotion-engine exec remotion render` CLI-shell，零程序化 API）。`OffthreadVideo` 全仓未用，由 `remotion` 包直接导出（零新依赖）；`video/props.d.ts` 证 `volume`/`muted`/`style`（CSSProperties → objectFit/objectPosition）与 `trimBefore`（`startFrom` 更名，**单位=帧**）；`offthread-video-server.js` 内 `downloadAsset`→`downloadFile`→`readFile`→`getClient` 只认 http(s)（与 `<Audio>` 同约束，源码级确认），且以 `shouldAnalyzeAudioImmediately: true` 调用——音频提取受支持。
6. **成功判定现状**：render exit 0 + ffprobe 视频五项精确（codec/宽高/帧数/帧率/时长 ±0.05s）+ 有旁白时 aac + 回写前 `validateVideoProject` 重校验。**无尾帧空白核算**（修订文档 §3 行 6 新要求「显式尾帧核算」）。帧数学 `quantizeTimeline`（quantize.ts:21-42）累计边界 round-half-up。
7. **TTS 时长对齐只 stretch spec**：`tts-sse.mjs:357-358` `applyDurationAlignments` 仅 patch `sceneSource.spec.durationMs`；而 C4（validate.ts:275 附近）钉死 media 镜头 `durationMs === outMs−inMs`——media 镜头**不能**走「加长时长」对齐，必须排除并指路。
8. **`RenderRecord.assetDigests` 契约在、写入方缺**（types.ts:70-72 注释「T1 契约，T4 写入」；validate.ts:622-633：key 须在账本、value 64 位小写 hex）。追加点 render-scene:479-497（每画幅 × 每 span 一条）。
9. **裁切数学孤悬 web**：`mediaClipCss` 在 `apps/web/.../media-preview.ts`（cover：宽溢出轴 focalX 百分比、竖溢出/无溢出恒 50%；contain 恒居中）——引擎与脚本不可 import apps/web，需单一共享来源。
10. **仓路径解析**：`originalPath(resolveStoreRoot(), storeKey)`（media-store/src/store.ts:40-43，storeKey 形状门防穿越）；脚本侧经 `pathToFileURL(dist/index.js)` 动态 import（media-ingest.mjs:31-33 先例）。

## 1. 架构总览

```
packages/video-scene（纯渲染包，双端可达）
  media-crop.ts        mediaClipCss 自 web 迁入（objectFit/objectPosition 纯函数）+ 测试随迁
packages/remotion-engine
  scene-spec-composition.tsx  TimelineShotProps 扩联合（spec? | media?）+ TimelineScene
                        media 分支：<OffthreadVideo trimBefore muted style(裁切)>，旁白/字幕/转场层正交叠加
scripts/video
  media-server.mjs     新增：媒体文件 http 服务（独立进程，同 narration-server 协议；子路径白名单、
                        按扩展名 Content-Type、流式响应）
  render-scene.media.mjs 新增：媒体装配纯逻辑（收集/存在+摘要核验/props 映射/aac 判定/尾帧判定/manifest 形状）
  render-scene.mjs     接线：spec 门分支 media、media-server spawn、props 装配、--disable-web-security
                        拓宽、aac 门拓宽、尾帧核算、assetDigests 写入、frameMap/manifest 证据
  frame-dryrun.mjs     media 镜头跳过浏览器干跑
  tts-sse.mjs          planDurationAlignments 排除 media 镜头 + 指路 notice
apps/web
  media-preview.ts     mediaClipCss 改从 @acs/video-scene 导入（公共导出面不变），seek 两函数原地保留
```

**裁定**：
- **B1 服务进程**：新增 `media-server.mjs` 而非改造 narration-server——narration-server 是 D2 金标准路径，独立复制约 50 行换取零回归风险；差异点：白名单成员为相对子路径 `original/<storeKey>`（精确串匹配天然拒穿越）、Content-Type 按扩展名（Remotion `getSanitizedFilenameForAssetUrl` 依 contentType 定下载文件扩展名，不能谎报 audio/wav）、`statSync` 定长 + `createReadStream` 流式（original 可达 500MB，不整读入内存）。
- **B2 裁切数学单一来源**：`mediaClipCss` 迁 `@acs/video-scene`（web 预览与引擎渲染双端消费的纯渲染包）；web `media-preview.ts` 转发导出保持公共面稳定，测试断言随迁。
- **B3 渲染源 = original**（非 proxy）：出片取最高画质；确定性输入集按 §2.3 钉 original sha256；`assetDigests` 记 original 实测摘要。proxy 仅供浏览器预览（T3 语义不变）。
- **B4 原声混音走 OffthreadVideo 自身音频**（`muted={audio === "mute"}`）：Remotion 对同 Sequence 内挂载的音频元素自动混音（旁白 `<Audio>` 同机制现成），不预提取音频轨——少一道 ffmpeg 中间产物即少一处非确定性。
- **B5 取整口径**：`trimBefore = roundHalfUp(inMs × fps / 1000)`（与 quantizeTimeline 同 half-up）；播放帧数 = span.frames（`Sequence durationInFrames` 已界，**不传 trimAfter**）。T3 M4 预警「出片将按帧取整」的语义就此钉死。
- **B6 尾帧核算施于全部渲染**（非仅媒体）：黑帧是渲染缺陷的通用信号（时长/帧数错配、合成器截尾）；阈值取转场 e2e 实测纯黑 YAVG=16。

## 2. 规则表

### 2.1 G 表（render-scene 媒体装配，纯逻辑 `render-scene.media.mjs`）

- **G1（收集）**：`collectMediaShots(project) → { entries: [{shotIndex, versionId, mediaAssetId, storeKey, inMs, outMs, fit, focalX, audio, width, height, sha256}], byShotIndex: Map }`——逐镜头工作版本 `sceneSource.type === "media-clip"` 收集，`width/height/sha256/storeKey` 取自账本 `original`；资产不在账本 → 大声错（中文指路账本；文档校验已拦，此为渲染侧双保险）。
- **G2（props 映射，aspect-agnostic）**：spec 镜头 props 形状**逐字节不变**；media 镜头 = `{ media: { src, assetWidth, assetHeight, inMs, outMs, fit, focalX, audio, trimBefore }, startFrame, frames, narration?, subtitles? }`——无 `spec` 键；`src` 为 media-server 注入的 `http://127.0.0.1:<port>/original/<storeKey>`；`trimBefore` 为源内起始帧（B5 半进位）；props 携带文档字段 + 素材原始画幅，**不含任何画幅特定数值**（双画幅 props 逐字节一致的既有不变量保持；裁切在合成器内按 `useVideoConfig()` 现算）。
- **G3（存在 + 摘要核验）**：渲染前逐 media 镜头 `originalPath` 解析 → 不存在 → 大声拒（消息含 storeKey 与 `ACS_MEDIA_STORE` 指路）→ 实测 `sha256(file)` ≠ `asset.original.sha256` → 大声拒（内容寻址漂移 = 仓损坏，§3 行 6「摘要不符→大声失败，不写 RenderRecord」）→ 相等则以实测值写 `assetDigests[mediaAssetId]`。核验函数 fs 注入可测。
- **G4（aac 门拓宽）**：期望音轨条件 = `narrationEntries.length > 0 || entries.some(e => e.audio === "keep")`——mute 媒体 + 零旁白 = 合法无声片（不期望 aac）。
- **G5（尾帧核算）**：每画幅 ffprobe 五项后追加末帧 `signalstats YAVG` 核算（`ffmpeg -sseof -0.2 -i <mp4> -frames:v 1 -vf signalstats,metadata=print -f null -` 解析 YAVG）；`YAVG ≤ 16` → 大声拒（转场 e2e 实测纯黑=16、内容帧 220+）。探针输出解析为纯函数（注入文本可测）。
- **G6（manifest 证据）**：`frameMap` 逐项 `componentId`：media 镜头记 `"media-clip"` 并增 `mediaAssetId`；新增 `manifest.aspects[aspect].media = [{shotIndex, versionId, mediaAssetId, storeKey, sha256, inMs, outMs, trimBefore, frames, audio}]`。
- **G7（RenderRecord）**：media 镜头记录加 `assetDigests: { [mediaAssetId]: sha256 }`（同资产多镜头同值；spec 镜头不加该键）；`contentDigest` 现有口径已覆盖（hash 整 ContentVersion，内嵌 sceneSource）。
- **G8（渲染旗标）**：`--disable-web-security` 条件从「有旁白」拓宽为「有旁白或有媒体」（跨源本地服务同一理由）。

### 2.2 S 表（`media-server.mjs`）

- **S1（协议）**：`node media-server.mjs --root <媒体仓根> --files <storeKey,storeKey,…>`（白名单为裸 storeKey，路径固定 `original/<storeKey>`）→ stdout 一行 `{"port":N}` 常驻；白名单 = 精确串匹配（`../`、反斜杠、未列成员一律 404，穿越天然不可达）；仅 GET（其他方法 405 + `Allow: GET`），响应带 `Accept-Ranges: none`（不承诺 Range 语义）；CORS `*` + Private-Network；`decodePathName` 复用（畸形 percent-encoding 回 400 不崩进程）；父进程 exit 钩子 kill（沿 narration-server 先例）。
- **S2（响应）**：Content-Type 按扩展名（mp4→video/mp4、webm→video/webm、mov→video/quicktime、wav→audio/wav 防御兜底）；`statSync` 定 Content-Length + `createReadStream` 流式；`Accept-Ranges: none`（Remotion 整 GET 下载，20s 无数据超时由 data 事件续命）。

### 2.3 E 表（remotion-engine）

- **E1（props 联合）**：`TimelineShotProps` 增可选 `media` 成员、`spec` 转可选——判别 `"media" in shot`；spec 镜头类型形状不变。
- **E2（media 分支）**：`Sequence` 内 `<OffthreadVideo src={videoSrc} trimBefore={roundHalfUp(inMs × fps / 1000)} muted={audio === "mute"} style={{ width: "100%", height: "100%", …mediaClipCss(width, height, cfg.width, cfg.height, fit, focalX) }} />`（fps/画幅取 `useVideoConfig()`）；封面裁切/信箱缩放语义与浏览器预览同一纯函数（B2）。
- **E3（层正交）**：旁白 `<Audio>`、字幕层、转场叠层与场景源分支正交——media 镜头照常叠加（Audio 与 OffthreadVideo 同 Sequence 并存即混音；转场窗按 span 帧工作与源无关，T3 设计已裁定）。

### 2.4 A 表（TTS 时长对齐排除，`tts-sse.mjs`）

- **A1（planDurationAlignments 排除 media）**：media-clip 工作版本不进对齐计划（时长被 C4 钉死 = 片段长度，stretch 必破坏 C4）→ 该镜头若旁白溢出，`notices` 增指路条目（「缩短旁白或扩大入出点」），不产对齐动作。
- **A2（渲染期防线无差别）**：`buildNarrationEntries` 溢出 warnings 与 render-scene 默认拒绝/`--allow-truncate` 逃逸语义对 media 镜头同样生效（media 镜头旁白超片段 → 默认拒绝出片）。

### 2.5 D 表（干跑）

- **D1（media 跳过干跑）**：`buildProjectDryRunJobs` 对 media-clip 镜头跳过（无 spec 可浏览器干跑）——不报错；spec 镜头照常逐帧干跑；跳过数打提示日志。

### 2.6 X 表（兼容）

- **X1（spec-only 逐字节不变）**：media 键只在 media 镜头的 props 项出现；spec-only 项目 props 文件、渲染命令、RenderRecord、manifest 逐字节不变——**A1 金标准复跑**（e2e-dataviz 双画幅产物哈希逐字节保持）是硬验收。
- **X2（spec 渲染路径零改动）**：`renderSpecLayer` 与六族路径不动；TimelineScene 仅加条件分支。
- **X3（spec-only 工具保持拒绝）**：`verify-determinism.mjs`/`export-shot-svg.mjs` 对 media 镜头维持大声拒（单镜头 spec 工具的既定语义；media 的确定性对账走 T6 双跑解码帧一致）。
- **X4（web 迁移公共面不变）**：`media-preview.ts` 对外导出 `mediaClipCss` 名不变（转发自 video-scene），web 既有 import 零改动。

## 3. 错误消息约定

媒体出片域新增消息全中文（沿 T1-T3 先例，以下为逐字实现口径）：`镜头 N 素材不在账本：<assetId>（mediaAssets 无此 assetId，请先上传或恢复账本）` / `镜头 N 原声设为保留但素材无音轨：<assetId>（<storeKey>，请改为静音或更换有音轨的素材）` / `媒体文件缺失：<storeKey>（仓根 ACS_MEDIA_STORE=<path>，请检查媒体仓与项目账本是否同机同步）` / `素材摘要不符：<storeKey> 账本 <sha12>… 实测 <sha12>…（仓文件被改动，内容寻址被破坏，拒绝出片）` / `素材读取失败：<storeKey>（<原因>）` / `<aspect>.mp4 末帧为黑帧（YAVG=<n>）：疑似镜头装配/时长事故，拒绝收片` / aac 缺失沿现案拓宽。manifest/RenderRecord 字段名英文沿现状。

## 4. 测试清单（全零网络；单测零 Remotion 渲染）

- **video-scene `media-crop`（+4，自 web 随迁）**：cover 横溢出轴 focalX 百分比 / cover 竖溢出与同比归一 50% / contain 恒居中忽略 focalX / 双画幅（1280×720 与 720×1280）同素材期望逐条钉死。
- **web `media-preview`（净 -4）**：迁出 mediaClipCss 断言，seek 两函数（mediaSeekTargetSec/shouldSeekVideo 含 80ms 边界）测试原地保留。
- **scripts `render-scene.media.test.mjs`（预计 +12）**：G1 收集与账本缺大声拒 / G2 props 形状（spec 项无 media 键、media 项无 spec 键、无画幅数值、narration/subtitles 正交并存）/ G3 注入 fs 三态（缺文件拒、摘要漂移拒、相等过 + assetDigests 形状与多镜头同值）/ G4 aac 判定四象限（旁白×keep）/ G5 YAVG 解析（黑帧拒/内容帧过/解析失败拒）/ G6 manifest media 块与 frameMap / G7 RenderRecord assetDigests。
- **scripts `media-server.test.mjs`（预计 +4）**：S1 白名单 404（未列成员/穿越串）+ 畸形编码 400 / S2 Content-Type 按扩展名 + 流式 Content-Length（真起服务 + fetch 127.0.0.1 回环，进程退出清理）。
- **scripts `tts-sse.test.mjs`（+2）**：A1 media 排除 + 指路 notice / A2 溢出纳入 warnings。
- **scripts `frame-dryrun.test.mjs`（+1）**：D1 media 镜头跳过、spec 镜头照常。
- **回归**：web / video-document 111 / video-scene / media-store 31 / scripts 全绿；`pnpm -r typecheck` 零错；biome clean。

## 5. 非目标（本刀不做）

VID-023 全链路 e2e 与双跑**解码帧一致**对账（T6；本刀冒烟已含双跑但按解码帧哈希口径）；Wikimedia（T5）；尾帧阈值调优/豁免旗标（若合法黑尾片被误伤再单议）；proxy 出片（B3 已定 original）；`verify-determinism`/`export-shot-svg` 的 media 扩展（X3）；交付物/GIF 的媒体特化（既有消费 renderRecords/渲染产物抽帧，媒体镜头照常工作无需改动）；manifest 新增 ffmpeg 版本字段（`rendererVersion` 已含 Remotion compositor 二进制版本，素材侧输入由 assetDigests 钉住——ADR 0003 第四次修订已述）；缩略图/预览改动（T3 已定）。

## 6. 验收

1. §4 清单全绿 + 既有套件零回归 + typecheck 零错 + biome clean。
2. **手工冒烟**（一次性，不进自动化；证据存 `artifacts/video-studio-media-render/`，仓用临时目录）：ffmpeg `testsrc` 生成 3s 测试素材 → `media-ingest` 入临时仓 → 手写 2 镜头项目 JSON（1 spec + 1 media `audio:"keep"`，旁白轨用 ffmpeg 合成正弦 wav 假件放 narration 目录，**零计费**）→ `render-scene` 双画幅 → ffprobe 五项 + aac（keep 见证）+ 尾帧过 + RenderRecord `assetDigests` 在档 + manifest media 块在档 → 同机双跑 `decodeFrameHash` 逐帧一致（§2.3 口径：解码帧一致，不承诺字节一致）→ 再跑 `audio:"mute"` 版零旁白 → 无 aac 且全部门过（G4 反向见证）。
3. **A1 金标准复跑**：e2e-dataviz 重跑 props 逐字节相等 + 当前金样 contentDigest `5b016ee3…`/`5a1e16da…`/`47b85441…`/`e64ec36a…`（四条 frameMap，以 `artifacts/video-studio-dataviz/render/render-manifest.json` 为准）逐一保持；出片 MP4 SHA-256 `3c6950b9…`/`36f64db7…`（X1 硬证明）。
4. 零计费（台账 34 行不变）；媒体不入库。
5. 集成（merge/PR）由用户决定；Codex 交接单收口。
