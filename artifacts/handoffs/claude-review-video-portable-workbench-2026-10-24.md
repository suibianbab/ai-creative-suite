# Claude 复核：Video Studio 浏览器可移植项目包（2026-10-24）

范围：`main@518203e..3c5538f`（单提交 "Add browser portable Video Studio package round trip"），对照交接单 `codex-video-portable-workbench-2026-10-24.md` 的三个焦点。复核未改动任何生产代码，未发起任何 TTS 请求；除阅读外，在复核工作树独立复跑了区间内新增单测（见文末记录）。

## 结论

架构边界成立：单文件格式确是目录包的传输封装（pack/verify/restore 全程复用、零 schema 变更），IndexedDB 三 store 单事务发布实现严谨，安全闸（dev 门/同源/34 MiB 请求闸/路径与 base64 白名单）质量高。但有一个阻断项：在本机（Windows 11 / Node v22.22.2）复跑时，新增单测与交接单声称的“35/35”不可复现，根因是 base `portable-package.mjs` 的 Windows `\\?\` 路径处理缺陷，使“向全新媒体仓导入”这一可移植包的核心场景确定性失败。建议先修 B1、重跑验收矩阵再合并。

## 阻断项

### B1 全新媒体仓导入在 Windows/Node v22.22.2 确定性失败；区间新测试在本机不可复现（缺陷继承自 base，本线新依赖且未被 e2e 覆盖）

- **现象**（本机 Node v22.22.2，检出 3c5538f 独立复跑）：
  - `portable-envelope.test.mjs` 1/2 —— “单文件包复用目录包校验并在新媒体仓恢复…” 确定性失败（3 次重跑一致）；
  - `route.test.ts` 1/2 —— import 步 400≠200（同一根因）；
  - `portable-package.test.mjs` 10/11 —— 同一根因，该文件在区间内零改动；
  - `tts-sse.test.mjs` 21/21、`local-video-projects.test.ts` 9/9 通过。
- **根因**：`scripts/video/portable-package.mjs:49` `within()`（经 `:69-75` `ensureDirectory` 触发）。Windows 下 Node v22.22.2 的 `fs.promises.mkdir(dir,{recursive:true})` 返回首个新建祖先目录且带 `\\?\` 扩展前缀（已用独立探针复现），`path.resolve` 不剥离该前缀，`path.relative` 结果异常 → `创建目录返回异常路径：\\?\...`。
- **对本线的影响链**：`scripts/video/portable-envelope.mjs:129` → `portable-package.mjs:423`（`ensureDirectory(originalDir)`）。凡 `<ACS_MEDIA_STORE>/original` 尚不存在——换新环境首次导入，正是可移植包的目标场景——浏览器导入必失败并报出含 `\\?\` 的费解错误。VID-049 e2e 通过是因为测试媒体仓已存在（脚本只删除单个原件文件），未覆盖“仓/目录不存在”分支。
- **与交接单的矛盾**：交接单称“portable-package、portable-envelope 和 TTS 35/35”；本机确定性复现 3 个文件各有 1 例失败。区间内 `portable-package.mjs` 零改动（`git diff 518203e 3c5538f -- scripts/video/portable-package.mjs` 为空）→ 缺陷先于本线存在，非本提交引入；但本线新路径依赖它，且本线新用例在本机为红。分支后续提交 `fffe7cd`（区间外）只追加了 e2e 篡改步骤，未触及此问题。
- **建议**：在 base `portable-package.mjs` 的 `within()`/`ensureDirectory` 归一化 `\\?\` 前缀（或改逐级 `mkdir` 自管返回值）；补“Windows 全新仓恢复”回归用例；在固定 Node 版本上重跑交接单全量矩阵后再关验收。

## 次要建议（不阻断）

1. **32/34 MiB 容量闸无自动化用例**：`portable-envelope.mjs:30,61,77,99,107` 与 `route.ts:59,67`（413）均无测试触及；相邻 `api/media/ingest/route.test.ts:132` 已有 413 用例可对齐。交接单验收中“过大请求拒绝”目前缺机器证据。
2. **e2e 报告字段名夸大**：两份 e2e 只收集 `pageerror`（`e2e-portable-workbench.mjs:19`、`e2e-portable-style.mjs:12`），`consoleErrors: []` 实为“无未捕获页面异常”，不含 `console.error`；建议改名或补 `page.on("console")`。
3. **VID-049 判据超出机器验证**：passCriteria 声称 “H.264 at 1280x720 and 720x1280”，但 e2e 只断言下载数与 SHA-256（`e2e-portable-workbench.mjs:79-99`），未探测量度/编码；建议 ffprobe 断言或弱化判据措辞。
4. **证据时间戳**：style 报告 16:33:24 早于提交 16:36:59；workbench 包/报告写于 16:38:55/16:39:58，晚于提交 2-3 分钟（疑为提交后复跑；内容哈希与交接单一致）。建议验收证据在提交前落盘并在交接单记录生成时刻。
5. **导出包含历史本机路径**：renderRecords/交付记录随项目进包（交接单已披露“仍是审计数据”），与契约“不能把本地原始路径写进下载文件”存在张力；建议后续导出时脱敏或在 UI 文案明示包含审计路径。
6. **注释缺一层说明**：`importPortableVideoProject`（`local-video-projects.ts:364`）客户端不跑 `workingStyleIssues`，实因服务端 verify 链（`portable-package.mjs` readBible）已在导入时跑过；建议在函数注释点明，避免后人误判漏校验。
7. **e2e 选择器脆弱**：`input[accept=".json,application/json"]` 的 `.last()`（`e2e-portable-workbench.mjs:57`）依赖 DOM 顺序；建议给该 hidden input 加专属 class。
8. **错误文案**：`route.ts:104` 直接 `JSON.parse` CLI 输出，输出损坏时会把英文 SyntaxError 透给用户；包一层中文提示与既有口径一致。

## 已复核且无恙

- **安全边界**：`route.ts:52` 非 development 503；`:57` 同源闸（复用 `api/same-origin.ts` 的 Host 对 Origin 比对）；`:59`/`:67` content-length 与实测 body 双层 34 MiB 闸；CLI 经 `execFile` 子进程 + 临时文件传参（`route.ts:27-33`：无 shell、无 argv 注入、120s 超时、1 MiB stderr 缓冲）；`project.id` 受 UUID 约束（`video-document/src/validate.ts:488`），`route.ts:96` Content-Disposition 无头注入面。
- **封装路径与容量**：`SAFE_PATH`（`portable-envelope.mjs:16`）锚定四类白名单路径，无穿越可能；canonical base64 正则 + 路径去重 + 解码总量闸（`:30,61`）；文件数上限 1003 = 目录包 manifest 上限（1000 媒体 + 项目 + 风格）+ manifest.json 自身，口径一致；导出侧声明字节 24 MiB 早闸 + 逐文件 base64 估算 + 成品文本 32 MiB 终闸（`:77,99,107`），终闸权威（估算仅提前失败）。
- **哈希链**：复用 pack 的“账本 vs 实件 SHA-256/字节数”双向核对与 verify 的逐文件重算、根目录清单比对、restore 的 link-create-only 与失败回滚——篡改/缺件/多余件/同键冲突均拒；新增单测覆盖篡改/漏文件/重复路径/穿越（`portable-envelope.test.mjs`，本机通过）。
- **IndexedDB 原子性**：`importPortableVideoProject`（`local-video-projects.ts:364-461`）单事务三 store；项目冲突/风格同 ID 异版在写前拒绝并 abort，冲突路径不残留风格记录（`local-video-projects.test.ts` 新用例实证，本机通过）；幂等重放与 +1 快进语义与既有 `importVideoProject` 一致；服务端媒体恢复先于浏览器事务、失败时残留不可见内容寻址缓存的边界已在交接单明示，可接受。
- **API 错误处理**：CLI stderr 透传为可行动中文信息；导出任一校验失败即 throw、不产出下载；前端 busy/message 复位完整（`page.tsx:269-323`）；导入失败走 `listMessage`，不产生成功项目。
- **旧链兼容**：项目 JSON 导入/导出与 CLI 目录包零改动（区间 diff 不含二者）；DB 版本保持 3、无新 store、无迁移；`tts-ledger.mjs` 仅改错误信息 + 补 openSync 后写失败的清理（不自动删锁、不计费请求，`tts-sse.test.mjs` 新用例覆盖且本机通过）。
- **真实浏览器证据**：两份 report.json 与交接单逐项一致（原件 SHA `1880911d…f2f`、横版 214,958B `cd5dd855…a60a`、竖版 344,677B `f7d70a94…6857`、`aspectDownloads=2`、无页面异常）；e2e 流程含删原件→全新浏览器上下文导入→SHA 比对→刷新重开→双画幅出片。注意其未覆盖 B1 的“仓不存在”分支（见阻断项）。

## 本机复跑记录（Windows 11 / Node v22.22.2，复核工作树检出 3c5538f）

| 测试 | 结果 |
| --- | --- |
| `scripts/video/portable-envelope.test.mjs` | 1/2（败因 = B1） |
| `scripts/video/portable-package.test.mjs` | 10/11（败因 = B1，区间外文件） |
| `scripts/video/tts-sse.test.mjs` | 21/21 |
| `apps/web .../api/video/portable/route.test.ts` | 1/2（败因 = B1） |
| `apps/web .../video-studio/local-video-projects.test.ts` | 9/9 |
