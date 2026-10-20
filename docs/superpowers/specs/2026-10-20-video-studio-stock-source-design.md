# Video Studio P2.5-T5 设计：Wikimedia Commons 在线素材源（镜头卡内检索 → 人工选用 → 下载核验 → 直接应用 → 拒绝原因会话级）

- 日期：2026-10-20；分支 `worktree-video-studio-p2` 续叠（基线 = T4 收口 `f7dfc6a`）
- 上游：`docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md` §3 数据流行 2–3 + §4 任务 5 + §7 裁定 1/2；`docs/VIDEO_STUDIO_OPENMONTAGE_ADOPTION_2026-10-19.md` §3A
- 依赖：T1 契约（`MediaAsset.origin` 已含 `stock-source` 联合，`sourceId` 固定 `"wikimedia"`）；T2 仓/探测/解码/转码（`@acs/media-store`）；T3 镜头卡媒体臂 + `buildMediaRevisePatch`
- 本刀性质：`@acs/media-store` 新 `stock` 模块 + web API 路由 + 镜头卡内搜索面板。**单测零网络**（合成夹具 + 注入 fetch/ingest），真实网络仅手工冒烟；零计费；媒体与证据不入库
- 用户已确认：**检索入口在编辑器内**；**下载成功直接设成当前镜头卡的素材**，之后可在卡内继续编辑/替换

## 0. 现状锚点（2026-10-20 勘察，行号以本工作树为准）

1. `MediaAsset.origin` 已含 `stock-source`（`packages/video-document/src/types.ts:129-137`）；`validate.ts:67-96` 已约束 `sourceId === "wikimedia"`、`sourcePageUrl` http(s) ≤2000、`license.name` 1..100、`author/usageNote` 1..200、`retrievedAt` ISO。
2. `ingestMediaFile` 只收 `bytes + fileName`，`origin` 硬编码 `local-upload`（`packages/media-store/src/ingest.ts:40,178`）；支持扩展名 mp4/webm/mov；500MB 上限在 web 路由层（`api/media/ingest/route.ts:9`），仓层无字节上限。
3. 镜头卡媒体臂：`editingMedia` = 选了媒体模板或工作版本已是 media（`shot-editor-card.tsx:212-214`）；素材下拉只列账本；应用走 `buildMediaRevisePatch → onRevise → reviseWorkingVersion`；媒体草稿默认值在 `draftMediaFromVersion`（`media-clip-templates.ts:54-64`：首个资产、入 0、出 `min(2000, duration)`、cover、focal 50%、mute）。
4. 素材面板是项目级（上传 + 列出资产，`media-panel.tsx`）；账本追加 + 保存的现成模板是 `page.tsx:221-269 uploadMedia`。
5. `assetLabel` 对 stock 走 `sourcePageUrl`，但后缀硬编码「本地上传」（`media-assets.ts:21-33`，T3 登记的 F3 死路径，本刀激活）。
6. 当前无任何 Wikimedia/网络素材代码；无 fetch 封装与 User-Agent 策略。
7. 候选与拒绝原因无持久契约（按修订文档 §7 裁定 1 保持**会话级**）。
8. `@acs/media-store` 是 Node-only 包，web 服务端路由可直接 import（ingest route 先例）；web 单测只测纯逻辑模块（node:test），组件靠手工冒烟。

## 1. 架构总览

```
packages/media-store
  src/stock/types.ts       StockCandidate / StockDerivative / StockImportResult
  src/stock/wikimedia.ts   纯函数：搜索 URL、响应归一化、许可/作者清洗、档位筛选、URL 白名单与成员校验
  src/stock/import.ts      下载编排：服务端重取元数据 → 流式下载（上限/超时/重试）→ ingest(stock origin)
                           → 元数据对账 → 失败清理
  src/ingest.ts            origin 参数化（默认 local-upload，向后兼容）

apps/web
  src/app/api/media/stock/search/route.ts   GET 检索（dev 门 + UA + 归一化）
  src/app/api/media/stock/import/route.ts   POST 下载入库（dev 门 + 同源 + 服务端重校验）
  src/app/video-studio/stock-search.ts      纯逻辑：面板状态机 / 拒绝原因 / 默认媒体草稿
  src/app/video-studio/stock-search-panel.tsx 镜头卡内搜索面板（组件薄）
  src/app/video-studio/shot-editor-card.tsx  媒体臂挂搜索入口；导入成功回调页面事务
  src/app/video-studio/media-assets.ts       assetLabel 增 stock 分支（去硬编码）
  src/app/video-studio/page.tsx              importStockForShot：账本追加 + 保存 + 立即应用（单事务）
```

**裁定**：

- **W1 适配器归 media-store**：检索、下载、入库与仓/探测同包，web 路由保持薄；未来第二来源按同接口扩展。
- **W2 入口归镜头卡**：用户确认。面板只在该卡的媒体臂展开，「当前镜头」无歧义；下载成功直接落成该卡的新 ContentVersion。
- **W3 服务端信任边界**：客户端只传 `pageTitle + derivativeUrl`；服务端重取元数据、精确成员校验、host 白名单、`redirect: "error"`；候选展示元数据不直接入账，入账字段全部来自服务端重取。
- **W4 许可不明不可下载**：`extmetadata` 无 `LicenseShortName` → 候选可见但下载禁用，可记「许可不明」拒绝；不做商业用途判定。
- **W5 下载上限沿 500MB**（与本地上传一致）；流式写临时文件；超限/超时/中断即清理，重试每次重开临时文件（不做断点续传）。
- **W6 成功判定**=HTTP 200 且字节完整 + ingest（探测/全片解码/代理）+ 档位宽高/时长对账；任何一步失败不返回 asset、路由不落账、文档零改动。

## 2. 规则表

### 2.1 W 表（`stock/wikimedia.ts` 纯函数）

- **W1（检索请求）**：`action=query&generator=search&gsrsearch=filetype:video <kw>&gsrnamespace=6&gsrlimit=10&prop=videoinfo&viprop=url|size|mime|extmetadata|derivatives&viurlwidth=320&format=json&formatversion=2`。关键词 trim 后 1..80 字符；固定 10 条。
- **W2（候选归一化）**：每页映射 `StockCandidate`：`sourceId:"wikimedia"`、`pageTitle`（`File:` 原样）、`displayTitle`（去 `File:` 与扩展名）、`sourcePageUrl`（`descriptionurl`）、`thumbnailUrl?`（`thumburl`，缺失则无图）、`durationMs`（秒×1000 四舍五入）、`width/height/mime`、`license | null`、`derivatives`、`defaultDerivativeUrl?`、`disabledReason?`。缺 `videoinfo`/`derivatives` 的页面跳过；畸形响应返回结构化失败，不抛裸栈。
- **W3（许可映射）**：`license.name = LicenseShortName.value`、`author = stripHtml(Artist.value)`、`usageNote = LicenseUrl.value + (AttributionRequired === "true" ? " · 须署名" : "")`；无 `LicenseShortName` → `license: null`（候选保留、UI 禁用下载）。清洗后按契约截断：name 100、author/usageNote 200。
- **W4（档位筛选与默认值）**：`derivatives` 按 `src` 扩展名只留 mp4/webm/mov（大小写不敏感），丢弃 ogv/其他；映射 `{url, mime, container, width, height, label, estimatedBytes?}`（`label` 优先 `transcodekey` 的 `NNNp`，否则「原片」；`estimatedBytes = bandwidth × durationSeconds`——实测 Wikimedia 的 `bandwidth` 单位是**字节/秒**，不再除以 8；仅展示用，标「≈」）；按 URL 去重、按宽度升序；**只提供长边 ≤1920 的档位**。默认档位 `defaultDerivativeUrl` = 宽度最接近 720 且 ≤1280 者，否则最接近 720 者；**选择规则只在服务端算一次并随候选下发**，客户端不得重复实现（`@acs/media-store` 是 Node-only，客户端不可 value-import）。候选级 `disabledReason`（服务端下发）：`许可不明` / `无受支持的分辨率档位（仅 mp4/webm/mov）` / `时长超出支持范围（200ms..10 分钟）` / `全部档位超过 1920 长边`；有任一即禁用下载。超时长候选仍展示（可见缩略图与来源），避免「搜不到」的误解。
- **W5（URL 白名单）**：`https:` + `host === "upload.wikimedia.org"` + `pathname` 以 `/wikipedia/commons/` 开头 + 无用户名/密码/端口；仍须与服务端重取后的该候选 `derivatives[].src` **精确相等**（成员校验为主门）。客户端 URL 未经这两道不得进入 fetch。
- **W6（HTML 清洗）**：Artist/Credit 去标签、折叠空白、解码常见实体（`&amp; &lt; &gt; &quot; &#39;`）；空串视为缺失。

### 2.2 P 表（`stock/import.ts` 编排）

- **P1（重取与许可门）**：按 `pageTitle` 单独 GET videoinfo（同 W1 的 props）；页面不存在或无可用档位 → 422 `候选已不存在或不可用：<pageTitle>`；重取结果 `license === null` → 422 `候选许可信息缺失：<pageTitle>（无法入账，请更换素材）`（`license.name` 是 `MediaAsset` 契约必填，服务端是信任边界，不能只靠客户端禁用按钮）。
- **P2（成员校验）**：`derivativeUrl` 须精确等于重取结果中的某个 `src`，且过 W5 → 否则 422 `该分辨率档位不属于此候选：<derivativeUrl>`。
- **P3（下载）**：`fetch(derivativeUrl, {redirect:"error", signal})` 流式写 `mkdtemp` 临时文件；总超时 300s、空闲超时 30s（AbortController + 读流计时）；`Content-Length` 预检 + 累计字节双闸 500MB；网络错误/408/429/5xx 重试，共 3 次（间隔 1s、2s），4xx（除 408/429）不重试；每次重试重开临时文件。UA 固定 `ACS-VideoStudio/0.1 (local development)`。
- **P4（入库）**：临时文件读回 Buffer → `ingestMediaFile({ bytes, fileName: <清洗后的 displayTitle>.<container>, root, origin: {kind:"stock-source", sourceId:"wikimedia", sourcePageUrl, license, retrievedAt} })`。`retrievedAt` 取本次重取时刻；`fileName` 截断至 200 字符且强制正确扩展名。`ingestMediaFile` 增可选 `origin`（默认 local-upload，契约不变）。
- **P5（对账与失败清理）**：ingest 成功后比较探测结果与档位声明：`durationMs` 容差 ±1000ms、`width/height` 容差 ±2px；不符 → 422 `下载内容与候选元数据不符：<详情>（未发布素材）`。**清理边界**：入库前记录 `originalPath`/`proxyPath` 是否存在；对账失败时删除**本刀新写**的 original 与 proxy（预存文件一律不动，沿 T2 W2 分寸）。代理由 ingest 按 `needsProxy` 生成，失败时同样受此清理，不留孤儿代理。
- **P6（清理）**：`finally` 删除临时目录；所有失败路径返回 `{ok:false, error, reasonCode, cleanupDone:true}`，不返回 asset。
- **P7（返回与错误码）**：`{ok:true, asset} | {ok:false,...}`；`reasonCode ∈ upstream | timeout | too-large | unlicensed | mismatch | unsupported | ingest | store-error`。ingest 的 `unsupported-format` → `unsupported`；`probe-failed | decode-failed | duration-out-of-range | proxy-failed` → `ingest`；`store-error` → `store-error`。
- **P8（成功后的落账失败）**：import 成功只代表「素材已入仓」；账本保存发生在页面事务（U5）。保存失败时仓内留下未被引用的内容寻址文件（可能含 proxy），本刀不做仓 GC、不视为半成品资产——它不在账本、不可被项目引用；文档零改动。

### 2.3 U 表（web 路由与面板）

- **U1（search 路由）**：`GET /api/media/stock/search?q=`；仅 dev（503 中文）；q trim 后 1..80（400）；上游 15s 超时；上游非 200/JSON 畸形 → 502；响应 `{ candidates }`（可为空数组）。
- **U2（import 路由）**：`POST /api/media/stock/import`；dev 门 + 同源校验（沿 ingest route）；JSON `{pageTitle, derivativeUrl}`（400）；`pageTitle` 1..255、`derivativeUrl` ≤2000；状态映射 413（too-large）/422（unlicensed/mismatch/unsupported/ingest）/502（upstream）/504（timeout）/500（store-error）；成功 `{asset}`。
- **U3（面板状态机，纯逻辑）**：phase `idle | searching | results | importing | error`；`candidates`、`rejected: Map<pageTitle, reason>`、`selectedDerivative: Map<pageTitle, url>`、`imported: Set<pageTitle>`；动作 search-start/success/failure、select-derivative、reject/unreject、import-start/success/failure、reset。拒绝原因枚举：`题材不符 | 文字画面 | 质量低 | 许可不明 | 其他`。**会话级 = 单张镜头卡内**：状态挂在卡片组件，面板卸载/切项目即失；不同镜头卡各自独立，同一页面可从两张卡分别导入（产两条同 storeKey 资产，标签提示「同内容已在册」）。拒绝原因与候选一律不进项目文档。
- **U4（入口与展示）**：镜头卡媒体臂素材下拉旁「在线搜索」按钮 → 卡内展开面板：关键词输入 + 搜索；候选卡片显示缩略图、标题、作者、许可、时长、尺寸、来源页链接（新窗口）；许可不明 → 禁用下载 +「许可不明」徽标；无受支持档位 → 禁用下载并说明。选中后展示档位下拉（尺寸 + 估算大小）与「下载并应用」。
- **U5（下载成功直接应用，单事务）**：卡片回调页面 `importStockForShot(shotId, {pageTitle, derivativeUrl})`：调 import 路由 → 在**最新文档 ref**（每次 `setEditor` 同步更新的 `documentRef.current`）上 `appendMediaAsset` → 以新资产构造默认草稿（入 0、出 `min(2000,duration)`、cover、focal 50%、mute）→ `buildMediaRevisePatch`（旁白沿用该镜头当前工作版本）→ `reviseWorkingVersion` 得到 `next` → **只调用一次 `saveVideoProject(next)`** → `setEditor(saved)`。**不得**拆成「先保存账本、再在内存里应用修订」：那样关掉项目会丢镜头应用、留下孤立资产。下载期间（最长 300s）允许用户继续编辑其他镜头；完成时以最新 ref 为基线，不覆盖期间改动。若该镜头已在最新文档中被删除：仍保存账本并提示「素材已入库；原镜头已不存在，请在镜头卡中选择」，不强行重建镜头。成功后消息「素材已下载并应用（镜头 N）」；草稿经 `workingVersionId` 变化自动重置为新版本。
- **U6（失败）**：import 失败 → 卡内行内中文错误 + 重试按钮；账本/文档零改动；搜索网络失败同样行内提示，可重试或改用本地上传；本地上传路径恒可用。
- **U7（拒绝）**：「不采用」选原因，卡片折叠进「已拒绝（N）」区，会话内（单卡）可撤销；不写项目文档。

### 2.4 L 表（许可与标签）

- **L1（展示）**：候选卡显示 `license.name`、作者、来源页；`license === null` → 「许可不明」且不可下载。
- **L2（入账）**：`MediaAsset.origin` 的 `sourcePageUrl/license/retrievedAt` 全部来自服务端重取；客户端字段一律不入账。
- **L3（资产标签）**：`assetLabel` 对 stock 显示「Wikimedia Commons · 作者 · 许可」+ 尺寸/时长；不再硬编码「本地上传」；同内容提示保持不变。
- **L4（边界）**：不做商业用途判定、不做许可结论、不抓取许可模板全文。
- **L5（片内署名，用户裁定）**：T5 **只记录与展示**作者/许可/来源（账本 + 资产标签 + 候选卡）；成片是否在画面内叠署名（片尾卡/角标）**不在本刀**，留到 T6 按样片实际选用的素材决定。此为明确接受的限制：在对外发布成片前，署名义务仍需在发布环节处理（T6 审片时给结论）。

### 2.5 X 表（兼容与回归）

- **X1（ingest 默认不变）**：不传 `origin` 时行为逐字节不变；T2 既有测试全绿；本地导入仍只产 `local-upload`。
- **X2（本地上传不变）**：`MediaPanel` 上传/列出行为不变；搜索只进镜头卡媒体臂。
- **X3（旧项目不变）**：无 stock 资产的项目读取/出片零变化；`stock-source` 仅新资产写入。
- **X4（校验不变）**：T1 对 stock origin 的校验照旧；手改非法 origin 仍在文档校验层拒。

## 3. 错误消息约定（逐字实现口径，全中文；上游英文原因可嵌在 `<原因>`）

- 搜索：`搜索关键词不能为空。` / `搜索关键词过长（上限 80 字符）。` / `在线搜索仅在本地开发环境开放。` / `在线素材检索失败：<原因>（可重试或改用本地上传）`
- 导入：`请求须为 JSON 且含 pageTitle 与 derivativeUrl。` / `跨站请求已拒绝。` / `素材来源无效：仅允许 Wikimedia Commons 的 upload.wikimedia.org 直链。` / `该分辨率档位不属于此候选：<derivativeUrl>` / `候选已不存在或不可用：<pageTitle>` / `候选许可信息缺失：<pageTitle>（无法入账，请更换素材）` / `下载超时（<n>s）：已清理临时文件，未发布素材。` / `素材过大（>500MB）：已中止下载并清理临时文件。` / `下载失败（HTTP <status>）：<url>` / `下载失败：<原因>（已重试 2 次）` / `下载内容与候选元数据不符：<详情>（未发布素材）` / `素材导入失败：<ingest error>`
- UI（候选禁用原因）：`许可不明` / `无受支持的分辨率档位（仅 mp4/webm/mov）` / `时长超出支持范围（200ms..10 分钟）` / `全部档位超过 1920 长边`；提示：`许可不明：不提供下载（请更换素材或改用本地上传）` / `素材已下载并应用（镜头 N）` / `素材已入库；原镜头已不存在，请在镜头卡中选择`
- manifest/RenderRecord/仓字段名保持英文现状。

## 4. 测试清单（全零网络；注入 fetch/ingest，不触真实 Wikimedia/ffmpeg）

- **media-store `stock/wikimedia.test.ts`（预计 +14）**：搜索 URL 编码/limit/namespace/filetype / 归一化两候选全字段 / 缺 videoinfo 跳过 / 秒→毫秒 / 许可映射与 HTML 清洗（含空作者）/ 无 LicenseShortName → null 且 `disabledReason="许可不明"` / ogv 档位剔除与 mov/webm 保留 / 宽度排序与长边 1920 上限 / 默认档位选择（含不足 720 的退路）/ 超时长候选禁用 / 无档位禁用 / 畸形 JSON 结构化失败 / URL 白名单（伪 host、http、端口、路径前缀）/ 成员精确校验。
- **media-store `stock/import.test.ts`（预计 +12）**：成功下载→ingest 收到 stock origin 与正确 fileName / 非成员 URL 不触 fetch / 非白名单 host 拒 / 重取无许可 422 且不下载 / Content-Length 超限拒并清理 / 无 Content-Length 流式累计超限中止 / 空闲超时中止清理 / 5xx 后重试成功（次数断言）/ 三次失败中文错误 / 重取失败 422 / 探测对账不符 → 不返回 asset 且删除新写 original/proxy、预存保留 / ingest 错误码映射。
- **media-store `ingest.test.ts`（预计 +2）**：`origin` 传入 stock 时资产 origin 原样落账 / 不传时仍 local-upload。
- **web `stock-search.test.ts`（预计 +8）**：状态机各相位 / 拒绝与撤销 / 档位选择 / 已入库标记 / 默认草稿（入出点/fit/focal/mute）/ 许可不明禁用判定 / 错误态保留候选。
- **web `stock-apply.test.ts`（预计 +4）**：单事务成功（账本+新工作版本+默认字段+只保存一次）/ 最新文档里其他镜头的编辑保留 / 镜头不存在只入库 / 保存抛错不返回文档。
- **web `media-clip-templates.test.ts`（预计 +2）**：`mediaDraftForAsset` 默认字段；短素材 `outMs` 取时长。
- **web `media-assets.test.ts`（预计 +2）**：stock 标签含来源/作者/许可且不含「本地上传」/ 无作者时无空段。
- **回归**：video-document 111 / video-scene 136 / media-store 31+新增 / web 168+新增 / scripts 83 全绿；`pnpm -r typecheck` 零错；biome clean；台账 34 行不变。

## 5. 非目标（本刀不做）

第二个来源（Pexels 等）；自动全网抓取/CLIP 索引；候选自动进时间线；拒绝原因持久化（项目级账本）；断点续传；ogv 下载或即时转码；搜索分页/排序/多语言参数；许可商业用途判定；**成片片内署名（T6 再定）**；仓 GC/孤儿文件回收（内容寻址、未被账本引用的文件不视为资产）；CLI 入口（用户确认走编辑器）；VID-023 全链路 e2e（T6）；proxy 出片与确定性口径（T4 已定）；缩略图本地缓存。

## 6. 验收

1. §4 全绿 + 既有套件零回归 + typecheck 零错 + biome clean。
2. **手工冒烟（真实网络，一次性，证据存 `artifacts/video-studio-stock-source/`，不入库）**：dev 启动 → 某镜头卡选「媒体镜头」→ 搜索关键词（如 `clouds`）→ 候选缩略图/许可/来源页可见 → 选 480p/720p webm → 下载并应用 → 账本出现 stock 资产、镜头卡显示该素材且可编辑替换 → 保存重开项目信息不丢 → 浏览器预览可播。另做反证：断网/非法 URL/超时注入 → 卡内中文错误、项目文档字节不变、无半成品资产。
3. 零计费（台账 34 行不变）；媒体与证据不入库；不 push/merge（集成由用户决定）。
4. Codex 交接单收口（本刀范围、可复跑命令、真实网络证据、未过项）。
