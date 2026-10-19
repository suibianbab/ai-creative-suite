# Video Studio P2.5-T3 设计：媒体镜头编辑与预览（第七族 apply 升格 + `<video>` 预览 + 素材面板）

- 日期：2026-10-19；分支 `worktree-video-studio-p2` 续叠（基线 = T2 收口 `cddf21e`）
- 上游：`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md` §4.3 行 4-5（接入分镜/浏览器预览）+ §4 任务 3
- 依赖：T1 契约（`2026-10-19-video-studio-media-clip-contract-design.md`：SceneSource media-clip 三成员 C1-C6 + MediaAsset 账本 A1-A8 + 只追加执法）；T2 仓与双路由（`2026-10-19-video-studio-media-ingest-store-design.md`：POST /api/media/ingest 返回 MediaAsset 不写文档；GET /api/media/file/[storeKey] original→proxy 回退）
- 本刀性质：**web 工作台 + video-document 操作层**。零渲染路径（T4）、零网络新增（上传走既有本地路由）、零 e2e（T6 VID-023）

## 0. 现状锚点（2026-10-19 勘察，行号以本工作树为准）

1. **六族 apply 骨架逐字重复**：`apps/web/src/app/video-studio/{chart,map,flow,stick,sketch,loading}-templates.ts` 各有同构三件套 `applyXTemplate`（找模板→structuredClone params→validateSceneSpec 门，六份函数体仅模板数组与报错文案不同）/ `draftXFromSpec`（params→表单草稿）/ `buildXRevisePatch`（守卫 isX→解析→合并→validate 兜底，非法 `{spec:null,error}` 不清文档——C1 语义，头注明示沿转场先例）。
2. **镜头卡应用链**（`shot-editor-card.tsx`）：模板下拉 `resolveAnyTemplate`（94-111，族序 chart→flow→map→stick→sketch→loading）→ 应用按钮合并链 791-931（resolveAnyTemplate 基底 → 六族 buildXRevisePatch 逐级 `?.spec ?? baseSpec` → `buildRevisePatch`（shot-edit.ts:54-102，narration/background/durationMs 并发合并，终评 I1 语义）→ 单次 `onRevise(patch)` 落库）。逐族字段按 `spec.componentId` 条件渲染（367-764）；`pendingTemplateId` 三分支（416-445：空值不动/错误行内/合法预填「应用时才落库」）。
3. **版本追加只有 spec 通道**：`operations.ts` `reviseWorkingVersion`（97-159）patch 一旦给 spec 则 `sceneSource: {type:"spec", spec}`（124-127）——**无任何 op 接受非 spec sceneSource**；`addCandidateVersion`（25-47）收整 ContentVersion 但语义是 submitted(ai) 机器重做。C4 对账在 `validate.ts` 274-282（durationMs ≠ outMs−inMs 拒）。
4. **预览不识媒体**：`scene-preview.tsx` `TimelinePreviewItem` 只带 spec（152-158）；page.tsx `shotWorkingSpec`（shot-specs.ts:14-24）对非 spec 场景源返回 null → 整片预览直接不可用（591-594 降级文案）。预览为**单一画布 + rAF 帧循环**（播放/暂停按钮、帧号显示、24fps 与出片同口径）；全 apps/web 无 `<video>` 元素。
5. **GET 路由 original 优先**：proxy 只在 original 缺失时兜底（route.ts 64-108）——预览想要 proxy 优先（≤1280 浏览器安全 codec）没有通道。MediaAsset.proxy 无 storeKey 字段（T1 形状），proxy 路径由 original.storeKey 派生（`proxy/<前 16 位>.proxy.mp4`，仓内事实）。
6. **素材面板不存在**：`page.tsx` 无媒体区；`document.mediaAssets` 类型在册（types.ts:115）无人读写。上传路由头注明示「账本追加是工作台（T3）的职责」。
7. **降级与行内先例**：shotWorkingSpec null → 只读卡 + 整片预览降级；转场预览装配失败 → `.preview-transition-warning` 告警不炸页（transitions-draft.ts 84-103）；非法编辑不清文档（transitions-draft.ts 70-79 返回 previous 同引用）。
8. **旁白对齐不动 media-clip**：`tts-sse.mjs:357-358` 只 patch spec 镜头；media-clip 旁白时长对齐语义按 T1 设计文档留给 T3/T4——本刀只做**溢出预警**（不改时长）。

## 1. 架构总览

三层改动，依赖方向 web → video-document（新 op）→ 既有 T1 校验：

```
apps/web 纯逻辑层（全部可测，组件零逻辑沿 house style）
  media-assets.ts      素材面板纯逻辑：appendMediaAsset / assetLabel / mediaSrcUrl（proxy 优先）
  media-clip-templates.ts  第七族三件套：draftMediaFromVersion / buildMediaRevisePatch / 默认入出点
  apply-template.ts    六族 applyXTemplate 共体提取（第七族升格的机械半边）
  media-preview.ts     mediaClipCss（objectFit/objectPosition 双画幅纯函数）+ 帧对齐 seek 数学
shot-editor-card.tsx   字段分支 + 应用链媒体臂 + 模板下拉第七 optgroup「媒体」
scene-preview.tsx      TimelinePreviewItem 扩联合 + <video> 渲染 + 素材缺失占位
page.tsx               素材面板（上传→POST→append→保存）+ pieceItems 从版本装配（spec|media|missing）
packages/video-document
  operations.ts        reviseWorkingVersion patch 增第三成员 mediaClip（sceneSource 非 spec 通道）
apps/web API
  file/[storeKey]/route.ts  ?variant=proxy（proxy 优先，original 兜底；默认行为不变）
```

**裁定（apply 基底提取的分寸）**：只提取机械共体 `applySceneTemplate(templates, templateId, spec, label)`（六份 20 行同构体 → 六个 3 行薄包装，签名与报错文案不变，web 既有测试零改动即证明等价）；**不**抽象「族描述符注册表」——第七族的应用产物是 ContentVersion 级 patch（sceneSource）而非 spec params，与六族不同类，强统一会造出假对称。卡片应用链加**媒体臂**：工作版本为 media-clip 且未选模板时走 `buildMediaRevisePatch`，选了模板（media→spec 换装）走既有六族链——两臂共用 narration 合并语义。

## 2. 规则表

### 2.1 video-document 操作层（R 表）

- **R1（mediaClip patch 通道）**：`reviseWorkingVersion(p, shotId, patch, newVersionId, at?)` 的 patch 增可选成员 `mediaClip: { mediaAssetId; inMs; outMs; fit; focalX; audio }`。给出时：`sceneSource = { type: "media-clip", ...mediaClip }`；**durationMs 由 op 计算 = outMs − inMs**（C4 单一事实源，调用方不得自带）；narration 继承/provenance `human-edit`/锁定镜头追加 audit 事件，全部沿 spec 路径现语义。`patch.spec` 与 `patch.mediaClip` 同时给出 = 大声抛错（互斥）。
- **R2（校验后盾）**：op 收尾 `validateVideoProject` 拦 C1-C6 违规（UI 行内校验是第一道门，op 是第二道）——错误消息沿 validate.ts 中文现案。
- **R3（appendMediaAsset 幂等语义）**：同 storeKey 不同 assetId 的重复上传各自成条（T2 ingest 每次产新 assetId）——账本只追加纪律容许；**不做**去重合并（YAGNI，面板按 storeKey 标注「同内容已在册」提示即可）。

### 2.2 素材面板与上传（U 表，web 纯逻辑 `media-assets.ts`）

- **U1（appendMediaAsset）**：`(assets | undefined, asset) → MediaAsset[]` 追加返回新数组（不 mutate）；重复 assetId 大声抛（防御，正常路径 T2 randomUUID 不撞）。
- **U2（mediaSrcUrl）**：`asset → "/api/media/file/" + original.storeKey + (asset.proxy ? "?variant=proxy" : "")`——**有 proxy 用 proxy**（≤1280 浏览器 codec 安全），无 proxy 直连 original。
- **U3（assetLabel）**：`local-upload → "「fileName」 WxH · s.s 秒 · 本地上传"`（时长一位小数；license 字样沿修订文档行 1「许可：本地上传」）；同 storeKey 已在册 → 追注「（同内容已在册）」。
- **U4（上传接线）**：面板 file input（accept `.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime`）→ `POST /api/media/ingest` FormData → 成功 append + 保存（乐观并发沿 local-video-projects）；失败（含 503 生产门/415/413/422）→ 行内中文错误 + **文档零改动**。上传中禁用按钮（busy 态）。

### 2.3 第七族编辑（M 表，web 纯逻辑 `media-clip-templates.ts`）

- **M1（draft 形状）**：`MediaEditDraft = { assetId: string; inMsText: string; outMsText: string; fit: "cover"|"contain"; focalPercentText: string; audio: "mute"|"keep" }`——入出点毫秒与 focal 百分比均为文本输入（沿 stick 坐标先例：`^[0-9]+$` 拒全角/小数/负号，`Number("")===0` 陷阱由 regex 先拦）。
- **M2（draftMediaFromVersion）**：media-clip 工作版本 → 草稿（inMs/outMs 直投字符串，focalX×100 取整）；非 media-clip 版本 → 默认草稿（`assetId = 账本首条`，无账本 → `{draft:null, error:"项目尚无媒体素材，请先在素材面板上传"}`；inMs=0、outMs=min(2000, 素材时长)）。
- **M3（buildMediaRevisePatch 行内校验，非法 `{patch:null, error}` 不清文档）**：
  - 素材存在（assetId 在账本，否则 `素材不存在或已移除：${assetId}`）；
  - 入出点正整数毫秒（M1 regex 已拦 + 双重断言）；`inMs ≥ 0`；`inMs+200 ≤ outMs ≤ 素材 durationMs`（消息含三值指路，中文）；
  - fit/audio 枚举（下拉天然合法，仍兜底）；focalPercent 0..100 整数（越界中文拒）；
  - 产出 `{ mediaClip: { mediaAssetId, inMs, outMs, fit, focalX: percent/100, audio }, narrationText: <当前草稿> }`——durationMs 不在 patch 里（R1：op 算）。
- **M4（非整帧软预警）**：inMs/outMs 不在素材帧边界（`ms mod (1000/fps) === 0` 近似：`ms×fps % 1000 !== 0`）→ 返回体附 `warning: "入/出点非整帧（素材 fps=N），出片将按帧取整"`（**非阻塞**，行内黄色提示；T4 兑现取整语义）。
- **M5（旁白溢出预警）**：`语速估算 400+300×字数 ms` > `outMs−inMs` → `warning`（沿 shot-edit speechOverflowMs 语义；**不自动对齐**——media 镜头时长=片段长度，对齐语义归 T4）。
- **M6（模板下拉第七 optgroup「媒体」）**：单条目「媒体镜头（选素材设入出点）」；选中即 `draftMediaFromVersion` 预填媒体字段（pending 语义沿六族：应用时才落库）；当前已是 media-clip 时下拉默认停在本族条目。

### 2.4 预览（P 表，web 纯逻辑 `media-preview.ts` + scene-preview.tsx）

- **P1（TimelinePreviewItem 扩联合，spec 项形状不变）**：既有 spec 项**不带 kind 字段、形状逐字节不变**（判别用 `"spec" in item`）；新增 `{ kind: "media", assetId, inMs, outMs, fit, focalX, startFrame, frames, narrationText? } | { kind: "missing", startFrame, frames, reason }`。page 装配从**工作版本**出发：spec → spec 项；media-clip 且资产在账本 → media 项；media-clip 但资产不在账本（账本被手工删等）→ missing 项（`素材缺失：assetId 不在账本`）。纯 spec 项目装配路径不变（既有测试为证）。
- **P2（media 渲染）**：`<video muted playsInline preload="metadata" src={mediaSrcUrl(asset)} style={{objectFit, objectPosition}}>`；objectFit/objectPosition 由 `mediaClipCss(assetW, assetH, canvasW/H, fit, focalX)` 纯函数给出——cover：`objectPosition: ${(focalX*100).toFixed(1)}% 50%`（宽溢出轴生效，focalX 即注视点；竖溢出轴恒 50%，契约无 focalY）；contain：`50% 50%`（focalX 不参与）。**双画幅数值测试**：同一素材在 16:9 与 9:16 画布下 objectFit/objectPosition 期值逐条钉死（「两画幅裁切显示」的逻辑层兑现；端到端画面核验属 T6 审片）。
- **P3（帧同步）**：镜头本地时间 `(globalFrame − startFrame)/24×1000` → `currentTime = (inMs + 本地)/1000`；seek 节流：与 video.currentTime 差 <80ms 不重设（防 seek 抖动）。**预览近似声明**：媒体镜头预览为帧驱动 seek 近似（不出片级精确），沿字幕预览 R3「预览近似」先例在预览角标注。
- **P4（素材缺失降级，两路）**：账本缺条目 → P1 missing 占位（灰底 +「素材缺失：…」+ 时长保留）；文件 404/解码错（`onError`）→ 该镜头渲染同款占位，**其余镜头照常、不炸页**（沿 preview-transition-warning 先例）。音频恒静音（预览本无声，`audio:"keep"` 是出片混音语义，T4 兑现）。
- **P5（GET ?variant=proxy）**：`searchParams.get("variant") === "proxy"` → **proxy 优先、original 兜底**；缺省行为不变（original 优先）。形状门/404/Range 语义全部复用。

### 2.5 兼容（X 表）

- **X1**：旧项目（无 mediaAssets、无 media-clip 镜头）打开/编辑/保存/预览逐字节不变；素材面板显示空态「尚无素材——上传 mp4/webm/mov（≤500MB，仅本地开发环境）」。
- **X2**：T3 前的降级文案「镜头含非 spec 场景源……整片预览不可用」被本刀**收窄**：media-clip 镜头进预览（media/missing 项），该文案只剩「场景源既非 spec 也非 media-clip 或时长缺失」时出现（editor-binding 等未来成员）。
- **X3**：六族 apply/编辑路径签名与报错文案不变（apply-template.ts 提取后既有 web 测试零改动全绿即等价证明）。

## 3. 错误消息约定

媒体域新增消息全中文（沿 T1/T2 先例）：`素材不存在或已移除：…` / `入点须为 ≥0 的整数毫秒` / `出点越界：须满足 入点+200 ≤ 出点 ≤ 素材时长 Xms（当前 入=Y 出=Z）` / `focal 百分比须为 0..100 整数` / `上传失败：…（路由中文消息直通）`。数组/UUID/ISO 级消息仍英文（video-document 既有约定，本刀 op 层无新增此类）。

## 4. 测试清单（全零网络；组件不测，纯逻辑全测）

video-document（reviseWorkingVersion 扩展，预计 +7）：R1 正路径（mediaClip 落 sceneSource + durationMs=outMs−inMs + human provenance）/ 锁定+audit / spec 与 mediaClip 互斥抛 / narration 继承 / C4 违规被 validate 拦（op 层）/ C1 资产不在账本被拦 / append 幂等（重复 assetId 抛）。
web media-assets.ts（预计 +6）：U1 追加不 mutate + 重复 assetId 抛 / U2 proxy 与无 proxy 两形态 / U3 标签与同内容在册注记 / X1 空态。
web media-clip-templates.ts（预计 +12）：M2 默认草稿（有/无账本两态）/ M3 全负路径（素材缺失/非整数/越界/出点<入点+200/出点>时长/focal 越界）+ 正路径产出形状（focalX=percent/100、无 durationMs）/ M4 整帧预警两态 / M5 溢出预警两态 / M6 草稿回填。
web media-preview.ts（预计 +8）：P2 双画幅 objectFit/objectPosition（cover 横竖溢出两轴 + contain 忽略 focalX）/ P3 seek 数学（含 80ms 节流边界）。
web apply-template.ts（预计 +3）：提取等价（未知模板错/合法克隆参数/validate 拒）+ 一族薄包装冒烟。
GET 路由 variant（预计 +2）：P5 proxy 优先命中 / 缺省不变（original 优先）。
既有回归零改动全绿：web 143+ / video-document 104+ / media-store 31 / video-scene 131 / scripts。

## 5. 非目标（本刀不做）

渲染/出片链路（render-scene 媒体 props、OffthreadVideo、assetDigests 写入、混音——T4）；旁白时长自动对齐 for media-clip（T4 语义）；缩略图生成（YAGNI——列表用文本元信息）；双画幅预览 UI（单一画布现状不动，双画幅由 P2 纯函数测试覆盖）；Wikimedia（T5）；e2e 与 VID 登记（T6）；media-clip 镜头的转场借帧核验（转场窗数学按 span 帧数工作，与场景源无关，T6 e2e 覆盖）。

## 6. 验收

1. §4 清单全绿 + 既有套件零回归 + `pnpm -r typecheck` 零错 + biome clean。
2. 手动冒烟（dev server，不进自动化）：上传 2s mp4 → 素材列表出现条目 → 某镜头换「媒体镜头」→ 设入出点/fit/focal → 保存重开字段回填 → 整片预览该镜头出画面（cover 裁切随 focalX 移动）→ 删仓文件后预览该镜头变「素材缺失」占位且其余镜头照常。
3. 零计费（台账 34 行不变）；媒体不入库（冒烟仓用临时目录）。
4. 集成（merge/PR）由用户决定；Codex 交接单收口。
