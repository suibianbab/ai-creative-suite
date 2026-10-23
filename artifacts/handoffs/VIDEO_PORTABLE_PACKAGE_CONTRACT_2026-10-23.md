# Video Studio 可移植项目包：CLI 契约与互审入口

基线 `main@d5470be`；实现分支 `codex/video-portable-package`。本任务对应 `D:/codex/animate/docs/VIDEO_STUDIO_CODEX_CLAUDE_PARALLEL_PLAN_2026-10-23.md` 第 3 节。Claude 可先审本契约，重点看资产边界、内容寻址恢复和失败处理；Codex 同时继续独立实现与验证。本文件不是项目 schema 变更提案。

## 现有事实

- `VideoProject.mediaAssets[].original` 保存完整 SHA-256、字节数、`storeKey`；二进制只在 `ACS_MEDIA_STORE/original/<storeKey>`。proxy 可再生成，不是出片必须输入。
- `VideoProject.styleBibleRef` 仅保存 `bibleId/versionId/digest`；实际 `StyleBible` 需要另给出。渲染已有 `--style-bible`，并调用 `resolveStyleBibleRef` 验证。即使当前工作版本不引用媒体，历史内容版本仍可切回，因此打包整个 `mediaAssets` 账本，而非只打包当前镜头引用。
- `renderRecords` 与 `deliveries` 是历史审计记录，其本机相对输出路径不代表包内视频。包内保留原文档，不冒称历史 MP4 也已迁移；新环境可重新渲染。
- `editor-binding` 中的外部编辑器源不在 `mediaAssets`，该源当前没有通用打包接口。若项目含此源，CLI 明确拒绝“完整可移植”打包，不静默遗漏。
- `SceneSpec` 内嵌 data URL（例如图片解说）已属于项目 JSON，按现有 `validateVideoProject` 与场景校验处理，不另拆包。
- 当前 `workingStyleIssues` 会拒绝 Style Bible 项目中以媒体镜头作为工作版本（外部画面的颜色/灯光无法由风格规范保证）。打包必须复用此检查：这种项目明确拒绝，不能“包已成功”而到出片才失败。历史非工作媒体版本仍随素材账本打包。真实出片验收分两臂：有风格规范的 spec 工作镜头项目、无风格规范的媒体工作镜头项目。

## 包结构 v1（目录，不额外引入 ZIP 依赖）

```text
<bundle>/
  manifest.json
  project.video-project.json
  style-bible.json                 # 仅 styleBibleRef 存在时
  media/original/<storeKey>        # 每条 mediaAssets 一份，按 storeKey 去重
```

`manifest.json` 只记录 `format:"acs-video-portable"`、`formatVersion:1`、项目 ID、项目文件及每个打包文件的**相对路径、字节数、SHA-256**。路径是固定生成的 POSIX 相对路径，不接收调用方任意路径。原项目不改写；`manifest` 不参与自己的哈希，避免自引用。proxy、TTS 音轨、历史渲染产物暂不在 v1 包内；若项目有需要这些资源才能复现的步骤，报告明确说明而不宣称完全复现旧交付。

## CLI 行为

1. `pack --project <json> --out <new-dir> [--store <abs-dir>] [--style-bible <json>]`：校验项目与可选 Style Bible 引用；逐项确认仓内原件存在，完整哈希和字节数与账本一致；所有输入合法才在同父目录建立临时包，流式复制和再核验，完成后 rename 到尚不存在的 `out`。任何失败删临时包，原项目、素材仓、既有输出目录不动。`out` 已存在直接拒绝。
2. `verify --bundle <dir>`：先校验 manifest 形状及固定路径规则，再逐文件检查存在、普通文件、大小和 SHA-256；随后校验项目 schema、每条原件与项目账本对账、Style Bible 引用可解析。拒绝额外“成功”声明；不写文件。
3. `restore --bundle <dir> --store <abs-dir> --out <new-dir>`：先完整 verify；目标仓同键文件存在时查**完整 SHA-256**，相同则复用，不同则拒绝覆盖；缺失原件通过目标仓临时文件复制、核验、rename。输出项目和 Style Bible 副本写到新的 `out`，可直接作为 `render-scene.mjs` 输入。失败时清理本次新建仓文件与临时/新输出目录，不动目标仓既有文件。目标 `out` 已存在直接拒绝；`out` 与目标仓均不得位于包目录内部。

全程拒绝符号链接、路径穿越和超出预期结构的 manifest；校验只在**本地受信任 CLI 环境**运行，不宣称远端上传包的沙箱或病毒扫描能力。输入媒体大小沿用项目现有边界；实现使用流式哈希/复制，不一次把视频加载到内存。

## 验收样本

- Style Bible 项目带历史媒体版本与完整素材账本：打包到 A、恢复到独立媒体仓 B 和目录 C，用 C 的项目与风格文件真实渲染横竖版；核对原件 SHA-256 和双画幅产物。另用无 Style Bible、当前媒体工作镜头的项目做相同往返及真实出片，核对渲染记录的 `assetDigests`。Style Bible 与当前媒体工作镜头并存时，按现有风格契约明确拒绝。
- 无媒体、无 Style Bible 的旧项目：pack/verify/restore 成功，原 JSON 语义不变。
- 失败例：缺素材、素材哈希/大小不符、Style Bible 引用不符、manifest 路径穿越、包内文件被篡改、目标仓同键冲突、目标输出已存在；均非零退出且不覆盖既有项目/素材。

## 实现边界与后续

优先新建 `scripts/video/portable-package.mjs`、CLI 包装及针对性测试；只有现有接口不足时才增加 `packages/media-store` 的受限 API。不要修改工作台 UI、`VideoProject` schema 或出片脚本。浏览器导入/导出整包、云端上传、历史渲染产物与音频收集属于后续独立决策。本轮报告必须区分“CLI 可移植链路通过”与“工作台尚未接入”。

## 实施结果与 Claude 复核清单

代码：`scripts/video/portable-package.mjs`（打包、校验、恢复核心）、`scripts/video/portable-project.mjs`（CLI）、`scripts/video/portable-package.test.mjs`（7 条反例/往返）、`scripts/video/e2e-portable-project.mjs`（真实媒体与 Style Bible 的两臂出片）、`qa/registry.json`（VID-043）。证据和明确限制见 [`artifacts/video-studio-portable-package-2026-10-23/REPORT.md`](../video-studio-portable-package-2026-10-23/REPORT.md)。未修改 `VideoProject` schema、工作台、媒体仓或渲染器。

复核时请重点检查：

1. `manifest` 文件集合、允许路径、普通文件/目录检查能否防路径穿越、符号链接与未列出文件；无媒体/无风格的旧项目是否仍通过。
2. 打包前后均核对完整素材 SHA-256；恢复时已有同键文件全哈希相同才复用，不能以 16 位 `storeKey` 前缀或大小代替完整哈希。
3. 临时目录与目标仓硬链接的成功/失败路径是否会覆盖既有文件，失败时哪些本次新增内容会被清理；若发现并发与系统崩溃下的限制，请明确写为限制，不把测试外推成强事务承诺。
4. Style Bible 项目的 `workingStyleIssues` 是否与真实渲染同口径；当前媒体镜头拒绝是否合理，历史媒体版本的资产是否仍随包走。
5. `renderRecords`/`deliveries` 的旧本机路径、proxy、TTS、外部 `editor-binding` 的边界是否如实报告；不要把 CLI 验证说成浏览器导入或云端部署已完成。

本机验证：`node --test scripts/video/portable-package.test.mjs` 7/7；`node scripts/video/e2e-portable-project.mjs` exit 0、两组双画幅 MP4 与媒体 digest 对账；`pnpm -r typecheck` 全通过；`pnpm exec biome check .` 430 文件通过；`node scripts/qa/run-regression.mjs validate` 为 98 automated / 53 manual。e2e 输出在忽略的 `.tools/video-portable-e2e/run-XEFox3/`。请基于提交增量复核，不把主检出 `D:/codex/animate` 的其他未提交资料并入此任务。
