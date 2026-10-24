# Claude 线交接单：W1 镜头配方目录（video-shot-recipes）

- **分支**：`claude/video-shot-recipes`（基线 `origin/main@518203e`，交付 HEAD 见 `git log main..HEAD`，6+ 提交）
- **Worktree**：`D:\codex\animate\.claude\worktrees\shot-recipes`
- **需求源**：`docs/VIDEO_STUDIO_EXTERNAL_PROJECTS_DEVELOPMENT_PLAN_2026-10-23.md` §W1；实施计划 `docs/superpowers/plans/2026-10-24-shot-recipes.md`
- **交付状态（2026-10-24 收口）**：三条配方（元数据/编译/SVG 预览/应用）+ 编辑视图目录 UI + VID-049 e2e 全链路（含双画幅真实出片与预览/导出文本一致性）+ 旧样片回归，全部通过。四态与限制见 `artifacts/video-studio-shot-recipes-2026-10-24/REPORT.md`。门禁：web 292/292（+10）、video-scene 186/186、video-document 159/159、typecheck、Biome、qa validate 102 自动/55 手工。
- **裁决记录**（详见 SDD 账本与 REPORT）：配方目录放编辑视图（页面结构决定）；BriefApplication 用标准 schema 形状（sentence 携带配方标识）；media-clip 资产应用时并入项目账本。
- **交叉审核请求**：审配方编译合法性、UI 与既有入口零干扰（nth 序）、SVG 转义、应用-保存语义、VID-049 断言质量；集成注意 qa registry 已含 VID-049（与既有条目无撞号）。

## 概念边界（P-A 裁决，开工前定义）

| 层 | 语义 | 粒度 |
| --- | --- | --- |
| 族模板（chart/map/flow/…） | 镜头内换装，选中即预填草稿（R1 裁决语义） | 单镜头编辑器内 |
| 组合模板（composition-templates） | 多元素族的预填子集 | 单镜头编辑器内 |
| 样片库（GALLERY_SAMPLES×5） | 一键复制的完整多镜头项目 | 项目级 |
| **ShotRecipe（本线新增）** | **按用途选镜头卡：元数据 + SVG 预览 + 编译追加到当前项目** | 镜头级、用途导向 |

不新增第五种编辑入口：配方编译只产出已注册组件 spec 或受控 media-clip 的普通 ContentVersion，应用走 apply-plan 同款「内存追加 + 保存确认」语义。四层各司其职，不互换不合并。

## 实际修改文件清单（计划）

- 新建 `apps/web/src/app/video-studio/shot-recipes.ts`（+`.test.ts`）——元数据/编译/SVG 预览/应用纯函数
- 修改 `apps/web/src/app/video-studio/page.tsx`（样片库后插「按用途选镜头」区块）、`video-studio.css`
- 新建 `scripts/video/e2e-shot-recipes.mjs`、`qa/registry.json` VID-049、`artifacts/video-studio-shot-recipes-2026-10-24/`
- 不改：video-scene 组件、video-document schema、render API、tts-*

## 接口假设

- `apply-plan.ts` 的追加先例（brief.applications + 待保存 notice）可被配方层仿写而非改动。
- page.tsx 的 mediaAssets 状态可供给商品配方资产下拉。
- `.recipe-*` class 全新命名空间，不与既有 e2e 选择器（`.sample-card` nth 序）冲突。

## 验收脚本

```text
pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
node scripts/video/e2e-shot-recipes.mjs        # 需本 worktree web（:3216）
SAMPLE_ID=stem node scripts/video/e2e-gallery.mjs   # 旧样片回归
```

## 集成记录

与便携项目包分支合并后，配方浏览器用例改为 `VID-050`；`VID-049` 保留给便携项目包。QA 从 `apps/web` 以 `node --import tsx ../../scripts/video/e2e-shot-recipes.mjs` 启动，以兼容不原生加载 `.ts` 的 Node 22 版本。上方编号与数量为 Claude 独立分支交付时的历史记录。
