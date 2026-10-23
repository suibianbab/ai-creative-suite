# Claude 线交接单：模板创作体验（video-template-experience）

- **分支**：`claude/video-template-experience`（基线 `main@d5470be`）
- **Worktree 绝对路径**：`D:\codex\animate\.claude\worktrees\video-template-experience`
- **提交范围**：交付后在本文件补 HEAD 哈希；实现计划见 `docs/superpowers/plans/2026-10-23-video-template-experience.md`
- **交叉审核**（任务单 §4.3）：本线完成后请 Codex 审「模板入口、草稿状态、版本保存、双画幅视觉与回归」；我审 Codex 线的「包契约、内容寻址、路径安全、失败原子性与恢复出片」。

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
