# W1 镜头配方目录 · 交付报告（2026-10-24）

分支 `claude/video-shot-recipes`（基线 `origin/main@518203e`）。需求源：`docs/VIDEO_STUDIO_EXTERNAL_PROJECTS_DEVELOPMENT_PLAN_2026-10-23.md` §W1；概念收编关系见交接单。证据根目录：`artifacts/video-studio-shot-recipes-2026-10-24/`（本目录）。

## 交付内容

- `shot-recipes.ts`：三条配方（`recipe-text-point` 文字重点 / `recipe-data-bar` 数据结论 / `recipe-product-clip` 商品画面）的元数据（稳定 ID/版本、用途、双画幅、时长范围、占位说明、许可、预览帧、验证态）与编译核心；`recipePreviewSvg`（注册表组件渲染一帧，用户文本 XML 转义）；`applyShotRecipe`（追加普通 ContentVersion，BriefApplication 标准形状，media-clip 资产并入账本，内存追加不落库）。
- `recipe-catalog.tsx` + CSS：编辑视图侧栏「按用途选镜头」目录——筛选 chips、SVG 预览卡、占位说明、逐卡输入面板（文字/数据/资产下拉）、应用即追加并提示保存。
- `e2e-shot-recipes.mjs`（VID-050）：全链路验收；集成后 `qa/registry.json` 102 自动 / 56 手工。

**放置裁决**：目录在编辑视图（列表视图无打开项目可应用）；页面结构为 editor 存在时提前 return 编辑视图。

## 四态报告

1. **代码实现**：完成。仅 `shot-recipes.ts(+test)`、`recipe-catalog.tsx`、`page.tsx`（侧栏插块）、`video-studio.css`、e2e 与 registry；未触碰 video-scene 组件、schema、render API、tts-*。
2. **自动回归**：web 292/292（+10 用例：元数据/编译/预览转义/应用/资产校验）；video-scene 186/186、video-document 159/159；typecheck、Biome、qa validate 全绿；旧 STEM 样片 e2e 回归 exit 0。
3. **真实浏览器与真实出片**：通过。浏览器：新建项目 → 三配方应用（商品条经内置样片视频上传取得资产）→ 改标题 → 保存 → 刷新重开（3 镜持久、编辑保留）→ 横竖预览 viewBox 断言；控制台零错误（`report.json`）。出片：导出项目双画幅 H.264（1280×720 / 720×1280），frameMap 3 镜；预览/导出一致性为**字符串级**——导出 spec 在 previewFrame 经同一注册表重渲染，与目录预览的可见文本集合一致（「开场提问（改）」「三十秒讲清楚」双侧断言）；MP4 侧核 codec/尺寸，帧画面以抽帧 PNG 供人工（非像素比对）。
4. **视觉质量**：抽帧级（`landscape/portrait-shot1-mid.png` + `editor-recipes.png` 编辑器整页截图）；文字镜头预览清晰；不宣称商业画质。配方为简洁示意版式，商用需按品牌调整。

## 已知限制 / 挂账

1. 配方时长输入 UI 暂缺（默认值应用；核心支持 durationMs 钳制，UI 字段后续加）。
2. media 配方 outMs 固定 `min(时长, 素材时长)`、fit=contain、静音——精剪需用镜头编辑器。
3. 目录预览的 random 种子固定 0.42（组件含随机元素时预览稳定但与出片帧非逐字节同源；一致性以文本集合断言）。
4. e2e 导入 `shot-recipes.ts`（TS）经 node 类型剥离，有 MODULE_TYPELESS 警告（仅性能提示）。
5. next build 在本 worktree 失败为已知环境项（非门禁）。

## 复跑

```text
pnpm --filter @acs/web test && pnpm -r typecheck && pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3216
BASE_URL=http://localhost:3216 pnpm --filter @acs/web exec node --import tsx ../../scripts/video/e2e-shot-recipes.mjs
SAMPLE_ID=stem BASE_URL=http://127.0.0.1:3216 node scripts/video/e2e-gallery.mjs
```

集成记录：配方 E2E 的 QA 编号调整为 `VID-050`，避免与便携项目包的 `VID-049` 冲突；集成后 QA 数量为 102 自动 / 56 手工。QA 从 `apps/web` 注入 `tsx`，兼容 Node 22.0 的 `.ts` 动态导入。上方数量保留 Claude 独立分支验收时的口径。
