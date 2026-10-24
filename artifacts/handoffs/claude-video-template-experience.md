# Claude 线交接单：模板创作体验（video-template-experience）

- **分支**：`claude/video-template-experience`（基线 `main@d5470be`，交付 HEAD 见下方提交范围）
- **Worktree 绝对路径**：`D:\codex\animate\.claude\worktrees\video-template-experience`
- **提交范围**：`d5470be..19a3c7a`（8 个提交：计划/交接单 → renovation 样片 → appliance 样片 → 预填提示 → e2e+VID-043 → 出片+审计+VID-044 → 终审修复轮）；实现计划见 `docs/superpowers/plans/2026-10-23-video-template-experience.md`
- **交叉审核**（任务单 §4.3）：本线完成后请 Codex 审「模板入口、草稿状态、版本保存、双画幅视觉与回归」；我审 Codex 线的「包契约、内容寻址、路径安全、失败原子性与恢复出片」。

## 交付状态（2026-10-24 收口）

- 两个样片（renovation 5 镜 16s / appliance 5 镜 16.5s，独立 bible，纯程序化）入库；海报 `p4-renovation.svg`、`p4-appliance.svg`。
- 预填语义提示为纯静态 `<p>`（`shot-editor-card.tsx`，复用 `.aspect-layout-hint`），行为零变更。
- e2e `scripts/video/e2e-gallery-extensions.mjs`（VID-043）：双题材全链路（创建→改标题/标注→显式保存→重开→回滚→双画幅预览 viewBox 断言→预填提示可见），控制台零错误。注意：**修订仅进内存，持久化靠「保存」按钮**——e2e 显式点击。
- 出片与审计 `scripts/video/audit-gallery-extensions.mjs`（VID-044）：双题材双画幅 H.264/24fps，帧数 384/396 精确对齐时长，每项目 10 条渲染记录回写，SHA-256 见 `render-audit.json`。证据（项目/bible/manifest/MP4/20 抽帧/接片/REPORT）在 `artifacts/video-template-experience-2026-10-23/`，MP4 与 PNG 按 `.gitignore` 白名单外惯例 `git add -f` 入库。
- 视觉检查：20 抽帧 + 4 接片逐项过检（无重叠/截断/裁断/对比问题）；无需布局修复。已知限制（REPORT 记录）：竖版纯文字镜头留白偏大；renovation 镜 3 拆改线为实线（组件无虚线参数）。
- 门禁：web 280/280（+3 用例）、video-scene 179/179、video-document 158/158、typecheck、Biome、QA validate 100 自动/53 手工。

## Codex 复核回应（2026-10-24）

- **P2（VID-044 静态审计）接受并已修**：①VID-044 改标「留存证据完整性检查」，审计补逐镜对账——frameMap.versionId ↔ 项目 workingVersionId、renderRecords 逐镜 versionId/contentDigest/frames/尺寸匹配、各画幅记录数与镜头数对账（变异自检：改一条记录 versionId 即被捕获）；②新增 VID-046 live 门禁（`audit-gallery-extensions-live.mjs`）：当前代码跑浏览器链 → 新产物双画幅渲染 → 同套断言，检出样片/渲染器回归。出片证据仍以留存目录为准，live 输出只在 .tools。
- **非阻断提醒照单确认**：回滚断言按交接单承诺口径（操作与导出）保留，不扩诺"回滚后保存重开"；`next build` 维持未验证项；商业成片口径不变。测试数勘误：修复轮后 web 为 280/280。

## 与现有入口的区别（任务单 §2.1 要求，避免换名重复）

| 层 | 现有 | 本轮新增 | 区别 |
| --- | --- | --- | --- |
| 项目级样片 | STEM 解说 / 数据动画 / 产品展示（3 个） | 家装方案、设备操作（2 个，**追加在 GALLERY_SAMPLES 末尾**） | 一键复制的完整多镜头叙事项目；题材面向非 STEM 用户；均为纯程序化镜头 + 独立 Style Bible，无外部素材依赖 |
| 镜头级模板 | 图表/地图/流程/火柴人/手绘/加载/媒体/3D + 多元素三模板 | 无新增 | 镜头内换视觉的预填机制保持不变；新样片内部**使用** explainer-composition 等组件，但不与模板机制重复——样片是项目起点，模板是镜头换装 |
| 编辑提示 | 模板 label、画幅微调提示 | 组件模板下拉下方一条静态预填语义提示 | 纯文案（R1 裁决：语义不改），说明「选中即预填、还原不撤销」 |

题材说明：采用任务单建议的「家装方案讲解」「设备操作说明」原题——现有组件能力（text-animation、explainer-composition flow/drawing、sketch-note、number-counter）完整覆盖两题材叙事，无需调整。

## 实际修改文件清单（计划）

- `apps/web/src/app/video-studio/sample-gallery.ts` — 新增 2 个 GallerySampleId、镜头构建、palette
- `apps/web/src/app/video-studio/sample-gallery.test.ts` — id 列表与新样片断言
- `apps/web/src/app/video-studio/shot-editor-card.tsx` — 仅加一段静态提示 `<p>`（复用 `.aspect-layout-hint`）
- `apps/web/public/samples/p4-renovation.svg`、`p4-appliance.svg` — 新海报（自有 SVG）
- `scripts/video/e2e-gallery-extensions.mjs`（新）— 双题材浏览器全链路
- `scripts/video/audit-gallery-extensions.mjs`（新）— 双题材双画幅出片审计
- `qa/registry.json` — VID-043/044
- `artifacts/video-template-experience-2026-10-23/` — REPORT 与证据
- 不改：`packages/video-document` schema、`packages/media-store`、`render-scene.mjs`、`composition-templates.ts`（无新模板）

## 接口假设

- `createGallerySample(id)` 现有签名不变；新 id 走同一路径（bible 必挂，同 stem/data 模式）。
- `GallerySampleId` 联合类型扩充是唯一导出形状变化；调用方（page.tsx `useGallerySample`）按 id 泛型透传，无需改动。
- `.sample-card` DOM 顺序 = GALLERY_SAMPLES 数组顺序（既有 e2e 依赖 nth(1)，追加保证不破坏）。
- 标注坐标界内（y ≤800 / portraitY ≤1450）由 `validateSceneSpec` 硬约束，样片构建时即守。

## 验收脚本

```text
pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
node scripts/video/e2e-gallery-extensions.mjs        # 需本 worktree web :3210
node scripts/video/audit-gallery-extensions.mjs
```

证据目录：`artifacts/video-template-experience-2026-10-23/`（双题材项目 JSON、横竖 MP4、抽帧、render-audit、REPORT）。

## 环境与基线记录

- 新 worktree 引导：`pnpm install --frozen-lockfile && pnpm -r build`（`@acs/shared` 等从 dist 导出；跳过 build 则 tsc TS2307、web 测试挂）。
- 基线（build 后）：video-scene 179/179、video-document 158/158、web 277/277、typecheck OK、Biome 426 文件。
- **已知未验证项**：`@acs/web` 的 `next build` 在本 worktree 失败（非本轮门禁，未查因）；TTS 旁白不在本轮（样片 MP4 无声）；视觉验收为抽帧级检查，非逐帧商业审片。
