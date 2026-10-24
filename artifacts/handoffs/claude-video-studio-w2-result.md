# W2 交付结果：风格代表帧确认、派生版本与内部质量对照（2026-10-24）

分支 `worktree-video-studio-w2-w5`（基线 main `be77030`）。按交接单 W2 执行；四态如下，证据路径全部可打开。

## 四态总览

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 代码实现 | 完成 | 确认账本 + 派生风格 + 关键帧 API + 出片门禁 + 工作台面板，共 6 个提交 |
| 自动回归 | 通过（含 1 个与本线无关的既有失败） | video-document 169/169、video-scene 186/186、web 313/313、`pnpm -r typecheck` 通过、Biome 460 文件 clean、qa validate 103 自动/56 手工；`scripts/video/*.test.mjs` 176/177——唯一失败 `three-bake.test.mjs`「runEncoder 超时后 ffmpeg 进程已退出」为既有环境失败（该文件本分支未改，最后修改在 `117008a`，本机三次复跑均败，与 W2 无交集） |
| 真实浏览器与出片 | 通过 | VID-051 全流程 PASS（下详）；三套对照共 6 条双画幅 MP4 真实出片，C 奦有声（AAC 双声道） |
| 视觉质量 | 部分：自动抽查通过，人工审片待验证 | 构建方用视觉模型抽查关键帧/终帧均合格；节奏/审美/音画配合按交接单要求如实标注待人工 |

## 交付 1：风格代表帧确认（含失效推导与出片门禁）

- **数据模型**（`packages/video-document/src/style-confirmation.ts` + `types.ts`）：`styleFrameConfirmations` 只追加账本，每条绑定不可变内容版本摘要（与 RenderRecord.contentDigest 同源）、风格引用 `{bibleId,versionId,digest}`、量化帧号（与出片同一 quantizeTimeline 帧数学）、横竖关键帧 SHA-256、全工作集摘要（全部镜头工作版本+转场+风格引用）。
- **有效性是推导的，不是存的**：`styleConfirmationStatus` 每次对照当前项目重算——任一内容或风格变更后旧确认自动失效并给出可操作原因；因此保存、刷新、导入（导入路径走同一 validate/evolve 纪律，确认数组已纳入 `assertAppendOnlyEvolution`）后状态天然准确，无需迁移。
- **真实渲染器关键帧**：`POST /api/video/style-frame`（dev-only、同源、单作业互斥、失败清目录）直接以 node 调 `@remotion/cli` 的 JS 入口执行 `remotion still`，与出片同 bundle、同 Chrome 回退；`GET /api/video/style-frame/[frameId]/[aspect]` 出证据 PNG。缓存 30 作业滚动清理。
  - 环境修复：`runRender` 以 `process.execPath` 启动子进程，原先 pnpm 形态参数在 Windows shim 下变成 `node --filter`（bad option）；改为直调 CLI JS 入口后实测出 1280×720/720×1280 PNG。
- **出片门禁**：`POST /api/video/render` 对带 `styleBibleRef` 的项目校验有效确认，缺失/失效返回 400 与原因；非风格项目行为不变。**CLI `render-scene.mjs` 不检查确认**（开发者/回归工具，已有摘要校验）——已知边界，见「限制」。
- **工作台**（`style-frame-panel.tsx`）：选程序化镜头 + 帧时间 → 生成（真实渲染）→ 显式确认；生成后项目再变则该关键帧不可确认（`confirmationBlockSignature` 守门）；状态行实时显示有效/失效原因；越界时间禁用生成（错误路径）。媒体/3D 镜头在下拉中显式禁选。

## 交付 2：派生风格

- `StyleBibleVersion.derivedFrom {sourceBibleId, versionId, digest, changeNote}` + `deriveStyleBibleVersion`：派生产生新不可变版本，明确来源版本摘要与 1..200 字改动说明；`assertStyleBibleEvolution` 保证旧版本逐字段不变。
- 旧项目引用旧版本：`resolveStyleBibleRef` 在演化后的 Bible 上仍解析旧引用（单测钉住）；**实际重开重渲证据**：C 套直接用 2026-10-23 提交的 STEM 终版项目 + 其旧风格 JSON 在当前代码重渲成功（下表 d5ae36c2/1578d5bb 两条 MP4）。
- 工作台「保存为新版本并应用」必填改动说明；派生即换 `styleBibleRef` → 旧确认按「风格版本已变更」失效（浏览器实测）。
- 关键帧与最终导出同快照：确认钉工作集摘要，门禁比对当前项目，通过后出片用的就是同一工作集与同一风格版本（RenderRecord.styleBibleRef 仍钉本次实际版本）。

## 交付 3：三套内部对照

证据目录 `artifacts/video-studio-w2-style-frame-2026-10-24/`（详细口径见其 [REPORT.md](../video-studio-w2-style-frame-2026-10-24/REPORT.md)）：

| 套 | 源项目 | 关键帧（真实渲染） | 成片（24fps H.264 双画幅） | 音频 |
| --- | --- | --- | --- | --- |
| A 文字动效 | text-motion.video-project.json（3 镜 fade-up/scale-in） | 7229b951-*.png 横竖 | render-text-motion/{landscape,portrait}.mp4（b50f31a2…/96c17b8c…） | 无（设计如此） |
| B 数据解释 | data-explain.video-project.json（画廊 data 4 镜） | 256d7f22-*.png 横竖 | render-data-explain/*.mp4（3ee4f8f8…/395519f1…） | 无 |
| C 竖版字幕 | portrait-subtitles.video-project.json（STEM 七镜终版+真实确认） | 74cf31c7-*.png 横竖 | render-portrait-subtitles/*.mp4（1578d5bb…/d5ae36c2…，AAC 双声道 26.005s） | DashScope TTS 缓存 7/7 命中，台账 28 行不变，**零新计费** |

- 每套源项目带一条机械确认记录（真实关键帧摘要钉入；note 标注「非人工审片」）。
- 字体来源：打包 NotoSansSC-Regular.woff（SIL OFL 1.1），manifest fontDigests 钉摘要。
- 自动抽查（构建方视觉模型）：A 套横/竖帧文字完整居中；B 套 Q1–Q4 标签数值可读；C 套竖版 3.0s 字幕「太阳晒过海面，水变成水汽升到天空。」完整未裁切。
- **待人工验证**：节奏、动效舒适度、音画配合、人声自然度——单帧与自动抽查不构成成片质量结论；外部实拍色彩不由 Style Bible 保证（本三套均为程序化画面）。

## 浏览器验收（VID-051，`scripts/video/e2e-style-frame-confirm.mjs`，QA 已注册 103 自动）

PASS 一次走通：创建 4 镜项目 → 应用风格 → **选择**（镜头 1、500ms）→ **生成**（真实渲染横竖 PNG，越界 99999ms 时生成禁用=错误路径）→ **确认**（导出 JSON 含 1 条 human 确认、frameIndex 12、hex 摘要）→ 保存 → **修改**（单镜标题修订）→ 状态「未生效：内容已变更」→ 失效项目 POST 出片被 **400 拒绝**（错误信息含「确认」）→ **再确认**（600ms）→ 保存 → **导出**（真实横竖 MP4 各一下载链接）→ 派生风格（改动说明必填）→ 确认按风格版本失效 → 保存后**刷新重开状态仍准确** → 最终导出含 2 条确认、风格引用指向新版本。控制台零错误。产物在 `.tools/video-style-frame-confirm/`（含 final-*.mp4 双画幅）。

## 复跑命令

```text
pnpm --filter @acs/video-document run build && pnpm --filter @acs/video-document test
pnpm --filter @acs/web test && pnpm -r typecheck && pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
# 浏览器（需本工作树 dev server，如 PORT=3219）：
BASE_URL=http://localhost:3219 node scripts/video/e2e-style-frame-confirm.mjs
# 三套对照（需 dev server）：
cd apps/web && BASE_URL=http://localhost:3219 node --import tsx ../../artifacts/video-studio-w2-style-frame-2026-10-24/build-sets.mjs
# 出片（示例 C 套）：
node scripts/video/render-scene.mjs --project artifacts/video-studio-w2-style-frame-2026-10-24/portrait-subtitles.video-project.json --style-bible artifacts/video-studio-w2-style-frame-2026-10-24/portrait-subtitles.style-bible.json --narration artifacts/video-studio-w2-style-frame-2026-10-24/narration --out artifacts/video-studio-w2-style-frame-2026-10-24/render-portrait-subtitles
```

## 已知限制与失败项

1. **CLI 绕过确认门禁**：`render-scene.mjs` 等开发者路径不检查确认（保留既有摘要校验与回归能力）；门禁语义限定在工作台出片路径。裁决成本：开发者可渲染未经确认的风格项目。
2. **关键帧仅 spec 镜头**：three 需烘焙、media 非风格保证对象，均显式拒绝并在 UI 禁选；确认快照仍钉住它们的内容摘要（变更即失效）。
3. **关键帧为单镜画面**：不含字幕与转场（SceneSpec 组合），与最终整片帧在字幕层有差异——确认语义是「风格代表帧」，非逐帧审片。
4. **确认记录的 keyframe 摘要不可密码学验证**：手工构造的项目 JSON 可伪造确认（门禁是工作流完整性，不是人工视觉的密码学证明）；真实链路证据在 VID-051 与三套对照。
5. **导入含确认项目的浏览器专项用例未单列**：导入走同一 validate/evolve（含确认前缀检查），状态为推导值；未另做专门 e2e。
6. 既有环境失败：`three-bake.test.mjs` 1 例 ffmpeg 进程时序断言（本机稳定失败，本分支未触碰该文件）；3210/3217/3218 端口被其他工作树 dev server 占用，本线使用 3219。
7. 浏览器自动化点击「确认」与构建脚本机械确认均为**工作流验证**，不冒充人工审片；人工审片项见上。
