# Codex 复核交接 —— `worktree-video-studio-p2`（P2.5-T5：Wikimedia Commons 在线素材源）

- 日期：2026-10-20
- 工作树：`D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`；**主检出 `D:\codex\animate` 由用户管理，勿动**）
- 范围：`f7dfc6a..c0e5d75`（20 提交，33 文件，+5009/−21：spec+plan 两篇、media-store `stock/` 纯函数与下载编排、ingest origin 参数化、web 两条 dev-only 路由、能力开关、面板状态机与单事务应用、镜头卡接线、内部终评与 Codex 复核两轮修复、收口文档）。`f7dfc6a` 为 T4 收口点（上次复核范围的后续基线）
- 纪律：工作树内只读复核；**不要 push / merge / 改 HEAD**（集成由用户决定）；本刀零计费（`artifacts/tts-usage.jsonl` 台账 34 行不变）；媒体与证据不入库
- 回写约定：结论写 **`artifacts/codex-review-video-studio-p2-media-t5-result.md`**（勿覆盖本交接单）；格式沿 t4 版（Review Focus 逐项 / Rulings 判定 / Declined 逐条 / Issues C-I-M / Ready to merge + reasoning）
- **状态**：实施、冒烟、内部整支终评（**0 Critical / 1 Important / 6 Minor**，已修 `ffc56e1`，复审 clean）与 **Codex 独立复核（0 Critical / 2 Important / 2 Minor → 修复 `c0e5d75` → 二次复核 0 Critical / 0 Important / 2 Minor，判可合并）**均已完成。§5 为两轮回写。

## 一、提交链（13 + 1 提交，spec → plan → 八任务 → 评审修复 → 收口）

| 提交 | 内容 |
|---|---|
| `3d835d8` | spec：W/P/U/L/X 五表、信任边界、单事务、错误文案、测试清单 |
| `0a88f01` | spec 评审回填：单事务落盘 / 并发编辑 / 许可服务端门 / 默认档位服务端下发 |
| `2442a66` | plan：8 任务全 TDD + Global Constraints + Review Focus 5 条 |
| `f746ba0` | T1 `ingestMediaFile` 增可选 `origin`（默认 local-upload 逐字节不变，X1） |
| `ca3a7a5` | T2 候选归一化、许可/作者清洗、档位筛选与默认值、URL 白名单与成员校验纯函数 |
| `bcfec8b` | T3 下载编排 P1-P6：元数据重取、许可门、成员校验、流式下载/重试/超时/上限、ingest、对账与清理 |
| `ce41e0f` | T3 评审修复：下载总超时改为**跨重试共享预算**（不再每次尝试各 300s） |
| `bcbe370` | T4 `GET search` / `POST import` 两条 dev-only 路由：dev 门、同源、状态码映射 |
| `3e019f6` | T5 面板纯状态机、stock 资产标签、`mediaDraftForAsset` 默认媒体草稿 |
| `0a8b060` | T5 评审修复：导入重试开始/成功时清除旧错误 |
| `f6e39bb` | T6 `applyStockAsset` / `importStockForShot`：最新文档基线 + 账本与镜头修订一次保存 |
| `d915431` | T7 镜头卡内搜索/选用/下载并应用面板接线 |
| `a0cb4cb` | T7 评审修复：导入网络失败（浏览器英文 `Failed to fetch`）转中文可重试文案 |
| `1ee2973` | T8 收口：CURRENT_STATE 条目 + 本交接单（证据 `artifacts/video-studio-stock-source/evidence.md` 不入库） |
| `2699734` | 收口文档勘误与提交链 SHA 回填 |
| `ffc56e1` | **内部终评修复**：同源门改比 Host 头（两条路由 + 8 测试）、导入 fs 异常收 `store-error`、客户端兜底文案逐字入 §3、U6 重试按钮与下载中态 |
| `4062f06` | 交接单补 §8 逐文件改动清单（供 Codex 审核） |
| `c0e5d75` | **Codex 复核修复**：正式环境隐藏入口（能力开关 UI/路由同源）、下载仅收 200 并核 `Content-Length`、清理状态如实上报、`canDownload` 与选档判定对齐（+9 测试） |

## 二、核心判据（可挑战的不变量）

1. **服务端是信任边界（W3/L2）**：客户端只提交 `pageTitle + derivativeUrl`。import 路由按 pageTitle **重新 GET videoinfo**，入账字段（来源页、许可名、作者、usageNote、`retrievedAt`）全部取自本次重取；候选展示字段不直接入账。客户端 `derivativeUrl` 先过 W5 白名单（`https` + host 精确 `upload.wikimedia.org` + `/wikipedia/commons/` 前缀 + 无端口/凭据），再与**重取结果**的 `derivatives[].src` 精确相等（成员校验），两者任何一步失败都在 fetch 前返回 422。
2. **许可不明不可入账（W4/P1）**：`extmetadata` 无 `LicenseShortName` → 候选 `license:null`，UI 禁用下载并显示「许可不明」；服务端独立返回 `unlicensed` 422（`候选许可信息缺失：<pageTitle>（无法入账，请更换素材）`），不只靠客户端禁用。
3. **下载分寸（P3/W5）**：`redirect:"error"`；300s 总预算跨全部尝试与退避共享；30s 空闲超时（相邻字节间隔）；`Content-Length` 预检 + 累计字节双闸 500MB；408/429/5xx 重试，共 3 次尝试（退避 1s、2s）；每次重试重开/截断临时文件；临时目录 `finally` 删除。UA 固定 `ACS-VideoStudio/0.1 (local development)`。
4. **对账与清理边界（P5）**：探测时长容差 ±1000ms、宽高 ±2px；不符 422 并删除**本刀新写**的 original/proxy；入库前记录两路径是否已存在，**预存文件一律不动**（沿 T2 W2 分寸）。
5. **单事务应用（U5/T6）**：页面先 `await` import 路由，**之后**才读 `documentRef.current`（下载最长 300s 期间对其他镜头的编辑不丢）；在最新文档上 `appendMediaAsset` + 默认媒体草稿（入 0、出 `min(2000,duration)`、cover、focal 50%、mute）+ `buildMediaRevisePatch` → `reviseWorkingVersion` → **只调用一次 `saveVideoProject`** → `setEditor(saved)`。save 抛错时 `setEditor` 不被调用，文档字节不变；仓内未被账本引用的内容寻址文件是接受的孤儿。镜头已被删除则只保存账本并提示「素材已入库；原镜头已不存在，请在镜头卡中选择」，不重建镜头。
6. **面板会话级（U3/U7）**：候选、拒绝原因、已入库标记挂在单张镜头卡内，不进项目文档；拒绝原因枚举固定 `题材不符 | 文字画面 | 质量低 | 许可不明 | 其他`。
7. **HTML 清洗（W6/L1）**：Artist/Credit 去标签、折叠空白、解码常见实体后再展示与入账；空串视为缺失，不产生空作者段。
8. **兼容不变（X1-X4）**：不传 `origin` 时 ingest 行为逐字节不变；本地上传、旧项目读取/出片、文档校验口径均不变；stock 仅新资产写入。
9. **零网络单测**：`stock/wikimedia.test.ts`（485 行）与 `stock/import.test.ts`（603 行）全部注入 fetch/ingest 夹具，不触真实 Wikimedia/ffmpeg；web 侧只测纯逻辑模块。
10. **错误文案逐字 spec §3**：搜索 400/502/503、导入 400/403/413/422/502/504/500 全中文；上游英文原因只嵌在 `<原因>` 占位。

## 三、可复跑验证命令（期望输出）

```bash
cd D:/codex/animate/.claude/worktrees/video-studio-p0

# 单测 / 回归（2026-10-20 收口实测）
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"   # 111 pass
pnpm --filter @acs/video-scene test                                                                      # 136 pass
pnpm --filter @acs/media-store test                                                                      # 63 pass（61 + 2 Codex 复核）
pnpm --filter @acs/web test                                                                              # 203 pass（193 + 10 Codex 复核）
node --test scripts/video/*.test.mjs                                                                     # 83 pass
pnpm --filter @acs/web run typecheck                                                                     # 零错
pnpm --filter @acs/remotion-engine run typecheck                                                         # 零错
npx biome check .                                                                                        # clean（351 文件）
wc -l artifacts/tts-usage.jsonl                                                                          # 34（零计费）
```

真实网络冒烟（一次性、零计费、证据不入库）：见 `artifacts/video-studio-stock-source/evidence.md`。要点：

```bash
# 本机需经代理；Node fetch 需显式启用 env proxy（Node 22.22）
NODE_USE_ENV_PROXY=1 ACS_MEDIA_STORE="<absolute-temp-dir>" \
  pnpm --filter @acs/web exec next dev --hostname localhost --port 3101

curl -sS "http://localhost:3101/api/media/stock/search?q=clouds"                    # 200，10 候选
curl -sS -X POST "http://localhost:3101/api/media/stock/import" \
  -H "Origin: http://localhost:3101" -H "Content-Type: application/json" \
  --data '{"pageTitle":"File:Clouds-seloncourt.ogv","derivativeUrl":"<480p webm>"}' # 200
```

实测：`storeKey=cd65ef1336fc1bbc.webm`、`sha256=cd65ef1336fc1bbc5569949d2a758c60585398151bb2976c0d29e0b65676c5e8`（落盘文件 SHA-256 逐位一致）、854×480、28600ms、`hasAudio=false`、无 proxy；反证 403 跨站 / 422 外站 URL / 422 http 方案 / 422 非成员档位，仓零变化。UI（系统 Edge + 仓内 `playwright-core`，未安装浏览器）完成「搜索→480p→下载并应用→保存 v2→重开→素材仍在→`<video>` readyState=4 可播」。

## 四、给 Codex 的检查清单（按风险排序）

1. **Review Focus 1：只有 ogv 档位的候选**：应展示但 `disabledReason="无受支持的分辨率档位（仅 mp4/webm/mov）"`、下载按钮禁用，不得崩溃或发起下载。请核对 W4 档位筛选（仅 mp4/webm/mov、长边 ≤1920）与 `canDownload`。
2. **Review Focus 2：下载期间用户改了别的镜头**：完成时必须以最新文档 ref 为基线；镜头被删则素材入库、不重建。请核对 `page.tsx` 中 `await fetch` → 读 `documentRef.current` → `importStockForShot` 的**顺序**（T6 只保证纯函数，时序由 T7 接线承担）。
3. **Review Focus 3：保存失败**：`saveVideoProject` 抛错时页面不得 `setEditor`，文档字节不变；仓内未引用内容寻址文件是接受的孤儿。请核对 `stock-apply.ts` 不 catch save、`handleStockImport` 的 catch 只复位 busy 并 rethrow。
4. **Review Focus 4：伪装来源**：`http://`、非 `upload.wikimedia.org`、带端口/凭据、`upload.wikimedia.org.evil.com`、不在候选 `derivatives` 中的 URL，都必须在 fetch 前拒绝；`redirect:"error"` 防 30x 逃逸。
5. **Review Focus 5：Artist/Credit 是 HTML**：清洗后展示与入账，不得把 `<a …>` 原样塞进 UI 或许可字段（W6 的实体解码 + 去标签 + 折叠空白）。
6. **同源判定与 dev 绑定的冲突（已修 `ffc56e1`）**：终评将其定为 **Important**——`next dev --hostname 0.0.0.0` 下 Next 16.4 的 `request.url` origin 为 `http://0.0.0.0:<port>`，浏览器从 `localhost` 打开时合法 POST 恒 403，功能唯一写路径不可用。修复 = 共享 `apps/web/src/app/api/same-origin.ts` 改比 **Host 头**（无 Origin 仍放行、`x-forwarded-proto` 兼容反代），stock import 与 ingest 两条路由同改，8 条 helper 测试含 `localhost` vs `0.0.0.0` 回归钉。
7. **清理分寸**：对账失败只删本刀新写 original/proxy；预存文件不动。请核对 `originalExisted/proxyExisted` 快照时点（ingest 之前）与删除条件。
8. **错误文案逐字**：对照 spec §3 的 403/400/413/422/502/504 文案；特别核对 `候选许可信息缺失`、`该分辨率档位不属于此候选`、`下载超时（<n>s）`、`素材过大（>500MB）`。
9. **零网络测试真实性**：确认 stock 两个测试文件没有真实网络/ffmpeg 依赖；确认注入的 fetch 同时覆盖元数据与下载两处。
10. **重试/超时预算**：`ce41e0f` 后总预算跨尝试与退避共享；请核对剩余预算不足时不再额外睡眠、且仍以 timeout 收口。

## 五、终评结论

- **Verdict：0 Critical / 1 Important / 6 Minor — With fixes → 已修 → 复审 clean。** 终评范围 `f7dfc6a..2699734`（opus 只读），修复 `ffc56e1`，范围复审（opus）确认「findings 全部落实、无新 Critical/Important」。
- **Review Focus 5 条全过**：ogv-only 候选禁用不崩 / 下载期间编辑以最新 ref 为基线 / 保存失败不 `setEditor` 且文档字节不变 / 伪装来源在 fetch 前拒 / Artist-Credit HTML 清洗后入账。
- **Important（1，已修）**：dev 绑 `0.0.0.0` 时同源门 403（详见 §4.6）。修复后 `Origin` 由浏览器设定、`Host` 为目标，跨站请求仍无法通过；无 Origin 的非浏览器调用沿既有放行口径（dev-only 路由）。
- **Minor 已修**：导入外围 fs 异常收口 `store-error`（P6 契约闭合）；客户端传输兜底文案四条逐字入 spec §3；U6 重试按钮与「下载中…」态。
- **Rulings 判定**：接受「元数据重取失败→upstream 复用检索文案」「retries=总尝试次数 3」「超时秒数=共享预算」「默认档位按档位高度」「清理只删本刀新写文件」「T6 排序由 T7 承担」（复审核对 `await POST → 读 ref → 唯一 save` 顺序正确）。**挑战并已处理**：`0.0.0.0` 同源门由「交终评」升为 Important 并当日修复；计划估数（media-store +27 / web +16）与实际（+29 / +17）不符已在本文档勘误。
- **Ready to merge：内部终评为是；Codex 二次复核（`f7dfc6a..99a6fc3`）判「是」（0 Critical / 0 Important / 2 不阻塞 Minor）。**（本刀不 push/merge，集成由用户决定。）
- **缓办 Minor（内部终评新增）**：关闭项目路径提示语写「在素材面板中选择」但该资产未入账（文案精度）；`errorMessage` 会把临时绝对路径带进卡内文案；下载后失败重试会二次下载并留孤儿资产（P8 已接受孤儿语义）；重试按钮嵌在 `role="alert"` 段内（a11y nit）。

### Codex 独立复核与修复（2026-10-20，`c0e5d75`）

- **结论**：0 Critical / 2 Important / 2 Minor，暂不建议合并（`artifacts/codex-review-video-studio-p2-media-t5-result.md`，未跟踪）。
- **Important 1（已修）**：正式构建仍渲染在线搜索入口，而两条路由非 development 恒 503 → 新增 `stock-capability.ts` 单一能力开关，镜头卡条件渲染、两条路由共用同一判定；补 capability 3 条与两条路由的 503/400/403 测试（9 条）。
- **Important 2（已修）**：`response.ok` 把 HTTP 206 当成功 → 下载只接受 `status === 200`（206/204 fatal、408/429/5xx 仍可重试），读流结束核对 `Content-Length`（有 `content-encoding` 时跳过）；补 206 与短体反例（ingest 不被调用、临时文件清理）。
- **Minor 1（已修）**：`cleanupDone` 固定 true → 单一 `finish()` 清理点，`rmSync` 失败时失败结果降为 `cleanupDone:false`；成功路径不变。
- **Minor 2（已修）**：`canDownload` 的隐式 `derivatives[0]` 回退移除，与 `effectiveDerivativeUrl` 同口径；补缺失默认档位测试。
- **复审**：范围复审（opus，`4062f06..c0e5d75`）确认四条全部落实、无新 Critical/Important；独立复跑 media-store 63 / web 203 / 双 typecheck / biome 351 / 台账 34。
- **新增缓办（第一轮口径）**：`content-encoding` 的 `identity` 判定大小写敏感（RFC 允许 `Identity`）；204 fatal 无专项测试（与 206 共用路径）；选中非默认档位时 `canDownload` 仍为 false 的防御性不对称（仅服务端归一化退化时可达；`c0e5d75` 后与 `effectiveDerivativeUrl` 同口径）。

### Codex 二次复核（2026-10-20，`f7dfc6a..99a6fc3`；增量 `4062f06..99a6fc3`）

- **结论**：0 Critical / 0 Important / 2 Minor，**Ready to merge：是**（`artifacts/codex-review-video-studio-p2-media-t5-result.md` 文末「二次复核」）。
- 原四项逐一裁定：Important 1（正式环境入口）/ Important 2（HTTP 206）/ Minor 2（`canDownload` 回退）已修；Minor 1 状态不再虚报，剩余文案问题归 Minor。
- **剩余 2 Minor（不阻塞）**：① `downloadToFile` 预生成的超时文案（spec §3 逐字「已清理临时文件」）在 `finish()` 清理失败时与 `cleanupDone:false` 矛盾——需与 spec 同改，留待后续；② `content-encoding` 的 `identity` 大小写敏感（RFC 允许 `Identity`）。
- Codex 独立复跑：media-store 63 / web 203 / web TypeScript / biome 351；并独立执行 `pnpm --filter @acs/web build` 生产构建成功。

## 六、延后 Minor 台账（未修，不阻塞；按任务汇总）

- **T1**：调用方传入 `local-upload` 时 `origin.fileName` 未校验 1..200（仅 `input.fileName` 校验）；新测试只覆盖无代理路径；`origin` 按引用保存。
- **T2**：未要求的静默截断（关键词 80 / 许可名 100 / 作者与 usageNote 200）；videoinfo 缺 `descriptionurl` 或时长非有限值时整页丢弃；URL 去重与扩展名大小写无专项测试；无 `NNNp` 档位一律标「原片」。
- **T3**：`writeSync` 短写未处理；元数据重取失败与 `disabledReason→unsupported` 无专项测试；`response.ok` 会接受 206；`too-large` 文案硬编码 500MB；新增跨重试测试的时序余量对负载敏感。（外围 fs 异常裸抛已于 `ffc56e1` 收口为 `store-error`。）
- **T4**：search 错误透出英文内部原因；JSON 读取期超时被报为「响应不可解析」；`trim()` 后的关键词未用于转发；请求体无大小上限。（未包 try/catch 已由 `ffc56e1` 在编排层兜住。）
- **T5**：自造文案「无可用分辨率档位」不在 spec §3；`startSearch` / `searchSucceeded` 会清/剪会话级拒绝与已入库标记（可能重导同内容）；`draftMediaFromVersion` 复用无专项测试。（`canDownload` 与 `effectiveDerivativeUrl` 的不一致已由 Codex 复核修复 `c0e5d75`。）
- **T6**：镜头不存在路径仍消耗 `newVersionId`；测试未模拟下载期间编辑（时序保证落在 T7）；`applied:true` 未断言；`durationMs<200` 的素材草稿会被 validator 拒但资产已入库；缺失镜头路径无不可变断言。
- **T7**：保存往返窗口内其他镜头编辑仍可能丢（U5 只承诺下载期间）；两卡并发导入靠版本冲突中文拒绝；`pageTitle` 作 path key 可能撞；空结果无提示。（重试按钮与下载中态已于 `ffc56e1` 补齐。）
- **终评新增缓办**：search/import 路由的**状态映射**仍无单测（dev 门/400/403 已补，冒烟已证 403/422）；关闭项目提示语「在素材面板中选择」与实际未入账状态不符；`errorMessage` 可能把临时绝对路径带进卡内文案；下载后失败重试二次下载留孤儿；重试按钮嵌在 `role="alert"` 段内（a11y）。
- **Codex 复核新增缓办**：`content-encoding: Identity` 大小写敏感；204 fatal 无专项测试；选中非默认档位时 `canDownload:false` 的防御性不对称。
- **计数勘误**：计划估 media-store +27 / web +16；实际 +29 / +17（含评审修复测试），终态 61 / 193。
- **跨刀旧账**：T3 F2/F4、P1/P2 期 Minor 仍在册；本刀无新增阻塞项。

## 七、关键文件索引

- spec/plan：`docs/superpowers/{specs,plans}/2026-10-20-video-studio-stock-source*.md`（spec 实际文件名后缀 `-design.md`）
- 纯函数：`packages/media-store/src/stock/wikimedia.ts` + `wikimedia.test.ts`（W1-W6）
- 下载编排：`packages/media-store/src/stock/import.ts` + `import.test.ts`（P1-P8）
- 契约与入口：`packages/media-store/src/stock/types.ts`、`packages/media-store/src/ingest.ts`（`origin` 参数化）
- 路由：`apps/web/src/app/api/media/stock/search/route.ts`、`apps/web/src/app/api/media/stock/import/route.ts`
- 同源门：`apps/web/src/app/api/same-origin.ts` + `.test.ts`（`Origin` 比 `Host`，8 条）
- 面板纯逻辑：`apps/web/src/app/video-studio/stock-search.ts` + `.test.ts`
- 单事务：`apps/web/src/app/video-studio/stock-apply.ts` + `.test.ts`
- 组件与接线：`stock-search-panel.tsx`、`shot-editor-card.tsx`、`page.tsx`（`handleStockImport` / `documentRef`）
- 标签与默认草稿：`media-assets.ts`、`media-clip-templates.ts`（`mediaDraftForAsset`）
- 证据：`artifacts/video-studio-stock-source/evidence.md`（不入库）
- 状态：`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部条目
- 计划进度与 Rulings：SDD 工作区 `.superpowers/sdd/2026-10-20-video-studio-stock-source/`（收尾后删除；Rulings 摘要见 §5）

## 八、改了什么（逐文件清单，Codex 按此按图索骥）

### 8.1 用户可见行为（六条）

1. **入口在镜头卡内**：镜头卡「媒体」编辑臂的素材下拉下方出现「在线搜索（Wikimedia Commons）」面板，仅 `development` 环境可用（**正式构建不渲染入口**，与两条路由同一能力开关）；面板挂在单张卡上，切卡/关项目即失。
2. **检索**：关键词 1..80 字符，固定返回 10 条候选；候选卡显示缩略图、标题、作者、许可、时长、尺寸、来源页链接。许可不明或无受支持档位 → 禁下载 + 中文徽标；「不采用」可选原因并折叠进会话级拒绝区，可撤销。
3. **档位**：只展示 mp4/webm/mov 且长边 ≤1920 的档位，下拉显示尺寸与估算大小；默认档位由服务端算好随候选下发，客户端不重复实现。
4. **下载并应用**：服务端重取元数据（不信任客户端字段）→ URL 白名单 + 候选档位精确成员校验 → 流式下载（500MB 上限、300s 总预算、3 次尝试）→ 探测/全片解码/必要时代理 → 元数据对账 → 账本追加 + 当前镜头媒体修订**一次保存**。成功后卡内提示「素材已下载并应用（镜头 N）」；失败行内中文错误 + 重试按钮，项目文档零改动。
5. **标签**：素材下拉对 stock 资产显示「来源页 / W×H / 时长·s / Wikimedia Commons / 作者 / 许可」，不再硬编码「本地上传」；本地上传标签逐字节不变。
6. **同源门修复**：`pnpm dev`（Next 绑 `0.0.0.0`）下浏览器用 `localhost` 打开时，导入不再 403；本地上传路由同享修复。

### 8.2 契约与接口变化

- `IngestInput` 新增可选 `origin?: IngestOrigin`；`IngestOrigin` 联合原有 `local-upload` 与既有 `stock-source`。不传时行为逐字节不变（X1）。
- `@acs/media-store` 公共面新增（`packages/media-store/src/index.ts`）：`importStockCandidate`、`StockImportReasonCode`、`StockImportResult`、`stock/types.ts` 全部类型、`stock/wikimedia.ts` 全部纯函数。
- 新 web 路由（均 dev-only）：
  - `GET /api/media/stock/search?q=` → `{ candidates }`
  - `POST /api/media/stock/import`（JSON `{pageTitle, derivativeUrl}`）→ `{ asset } | { error }`
- 新 web 纯逻辑：`stock-search.ts`（面板状态机）、`stock-apply.ts`（单事务应用）、`same-origin.ts`（同源门）、`stock-capability.ts`（`development` 能力开关，UI 与路由共用）。
- **无**项目文档 schema 迁移；无新依赖；无 package.json 变更。

### 8.3 逐文件清单（29 文件）

**media-store（8）**

| 文件 | 类型 | 作用 |
|---|---|---|
| `packages/media-store/src/stock/types.ts` | 新增 | `StockCandidate/StockDerivative/StockCandidateDisabledReason` 等公共类型 |
| `packages/media-store/src/stock/wikimedia.ts` | 新增 | W1-W6：搜索/元数据 URL 构造、响应归一化、许可与 HTML 清洗、档位筛选与默认档位、URL 白名单与成员校验 |
| `packages/media-store/src/stock/wikimedia.test.ts` | 新增 | 纯函数零网络测试（含白名单/默认档/许可不明/1920 上限） |
| `packages/media-store/src/stock/import.ts` | 新增 | P1-P8：重取与许可门、成员校验、流式下载（仅收 200、`Content-Length` 核验、上限/超时/重试）、ingest、对账、单一 `finish()` 清理并如实上报 `cleanupDone`；fs 异常 → `store-error` |
| `packages/media-store/src/stock/import.test.ts` | 新增 | 注入 fetch/ingest 的编排测试（含跨重试共享预算、store-error、206 与短体反例） |
| `packages/media-store/src/ingest.ts` | 修改 | `origin` 可选参数化，默认 `local-upload` |
| `packages/media-store/src/ingest.test.ts` | 修改 | 钉 stock origin 原样落账、默认路径不变 |
| `packages/media-store/src/index.ts` | 修改 | 导出 stock 模块公共面 |

**web 路由与同源（7）**

| 文件 | 类型 | 作用 |
|---|---|---|
| `apps/web/src/app/api/media/stock/search/route.ts` | 新增 | dev 门（共用能力开关）、关键词校验、15s 上游超时、502 映射 |
| `apps/web/src/app/api/media/stock/search/route.test.ts` | 新增 | 非 development 503、空/超长关键词 400 |
| `apps/web/src/app/api/media/stock/import/route.ts` | 新增 | dev 门、同源、body 校验、reasonCode→HTTP（413/422/502/504/500） |
| `apps/web/src/app/api/media/stock/import/route.test.ts` | 新增 | 非 development 503、跨站 403、坏 body 400 |
| `apps/web/src/app/api/same-origin.ts` | 新增 | `isSameOriginRequest`：`Origin` 比 `Host`，兼容 `x-forwarded-proto`；无 Origin 沿用放行 |
| `apps/web/src/app/api/same-origin.test.ts` | 新增 | 8 条：`localhost` vs `0.0.0.0` 回归、回环、外站、端口、协议、畸形、无 Origin、反代 |
| `apps/web/src/app/api/media/ingest/route.ts` | 修改 | 内联同源判定换成共享 helper（行为修复，非新功能） |

**web 工作台（14）**

| 文件 | 类型 | 作用 |
|---|---|---|
| `apps/web/src/app/video-studio/stock-capability.ts` | 新增 | `isStockSourceEnabled`：仅 `development`；UI 与路由共用 |
| `apps/web/src/app/video-studio/stock-capability.test.ts` | 新增 | development/production/undefined 三态 |
| `apps/web/src/app/video-studio/stock-search.ts` | 新增 | 面板相位/动作/拒绝/已入库/档位选择的纯状态机 |
| `apps/web/src/app/video-studio/stock-search.test.ts` | 新增 | 状态机与默认草稿/禁用判定测试 |
| `apps/web/src/app/video-studio/stock-search-panel.tsx` | 新增 | 卡内搜索面板（薄组件）：搜索、候选卡、档位、下载/重试/下载中态、拒绝区 |
| `apps/web/src/app/video-studio/stock-apply.ts` | 新增 | `applyStockAsset` + `importStockForShot`：账本+镜头修订一次保存；缺镜头只入账 |
| `apps/web/src/app/video-studio/stock-apply.test.ts` | 新增 | 单事务/期间编辑保留/缺镜头/保存抛错 |
| `apps/web/src/app/video-studio/page.tsx` | 修改 | `documentRef` 最新文档、`handleStockImport`（先 await POST 再读 ref）、全中文错误映射 |
| `apps/web/src/app/video-studio/shot-editor-card.tsx` | 修改 | 媒体臂挂载搜索面板 + `onImportStock` 属性 |
| `apps/web/src/app/video-studio/media-assets.ts` | 修改 | `assetLabel` stock 分支（来源/作者/许可）；本地分支不变 |
| `apps/web/src/app/video-studio/media-assets.test.ts` | 修改 | stock 标签与空作者测试 |
| `apps/web/src/app/video-studio/media-clip-templates.ts` | 修改 | `mediaDraftForAsset`：入 0、出 `min(2000,duration)`、cover、focal 50、mute |
| `apps/web/src/app/video-studio/media-clip-templates.test.ts` | 修改 | 默认草稿与短素材出点 |
| `apps/web/src/app/video-studio/video-studio.css` | 修改 | 面板/候选/缩略图/禁用徽标/错误样式 |

**文档与交接（4）**

| 文件 | 类型 | 作用 |
|---|---|---|
| `docs/superpowers/specs/2026-10-20-video-studio-stock-source-design.md` | 新增 | 设计权威：W/P/U/L/X 表、§3 逐字文案、§4 测试清单、§5 非目标 |
| `docs/superpowers/plans/2026-10-20-video-studio-stock-source.md` | 新增 | 8 任务 TDD 计划 + Global Constraints + Review Focus |
| `artifacts/codex-review-video-studio-p2-media-t5.md` | 新增 | 本文档（复核交接 + 终评回写 + 改动清单） |
| `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` | 修改 | 顶部 T5 条目（交付/回归/冒烟/终评） |

### 8.4 明确未改动

- 旧项目读取/出片、本地上传/列出、文档校验（T1 的 stock origin 校验照旧）、`mediaAssets` schema 均未变。
- 正式构建隐藏在线搜索入口（与路由 503 同一开关），不改变生产路由行为。
- 未 push / 未 merge；主检出 `D:\codex\animate` 未触碰。
- 媒体文件与真实网络证据不入库（证据在 `artifacts/video-studio-stock-source/evidence.md`，未跟踪）。
- 零计费：`artifacts/tts-usage.jsonl` 34 行不变。

### 8.5 建议审核顺序

1. `same-origin.ts` + 两条路由（信任边界的门）；
2. `stock/import.ts`（白名单 → 成员校验 → 下载纪律 → 对账 → 清理）；
3. `stock/wikimedia.ts`（归一化与默认档位）；
4. `stock-apply.ts` + `page.tsx`（单事务与最新 ref 顺序）；
5. `stock-search-panel.tsx`（UI 只走状态机）；
6. `media-assets.ts` / `media-clip-templates.ts`（标签与默认草稿）；
7. 测试文件与 §3 文案逐字对照。
