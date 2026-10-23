# 交 Claude 复核：多元素 F1–F6 修复与可复用模板

## 范围

分支 `video-studio/dual-aspect-edit`，基线 `357370e`。本轮只提交该开发分支；未合并、未推送 main。问题源为 `artifacts/codex-fix-video-studio-multielement-review-findings-2026-10-23.md`。重点看本轮新增 commit 相对基线的 diff。

## 修复与反例

1. F1：流程标签放大受盒宽上限约束；8 步四字标签横竖渲染测试。
2. F2：模板预填先去掉旧布局后应用；模板选择和最终应用均按当前点数 reconcile。12→8→返回当前组件并应用由真实浏览器回归。
3. F3：旧流程图缺 `nodeTextColor` 时，只豁免自动派生字段的 Style Bible 比较；渲染侧用节点底色现算可读前景。单测覆盖其它调色仍拒绝；旧项目真实 render API 200、两画幅出片。
4. F4：标注 y/portraitY 上界收紧到 800/1450；测试覆盖字幕带和越界拒绝。
5. F5：被删除的空短标签不计为有效删除；纯函数反例测试。
6. F6：`resolvedBase` 提取一次，避免同一基底解析三遍。

## 模板与用户链路

`composition-templates.ts` 定义流程、线描、图片三种预填；经原 `applySceneTemplate` 和 `explainer-composition@1`，不增 SceneSpec 版本或项目表。图片只接受有界 PNG/JPEG/WebP data URL；占位图不可保存。Shot Editor 可改标题、图示数据或图片、1–3 条标注、位置和入场时间。完整“客厅改造”四镜头浏览器路径包含选择→编辑→保存→重开→回滚→双画幅预览；横竖版 MP4 与图片变体均出片。

## 核心证据和复跑

见 `artifacts/video-studio-composition-templates-2026-10-23/REPORT.md`、`browser-report.json`、`render-audit.json`、双画幅 MP4/抽帧、图片变体及项目 JSON。旧 STEM 当前代码重渲染与留存原片 SHA-256 完全一致。`qa/registry.json` 新增 VID-040/041/042。

最终门禁：video-scene 177/177、video-document 157/157、web 276/276；全工作区 typecheck 通过，Biome 425 文件通过，QA 注册表 97 自动/53 手工。双画幅编辑、STEM、模板浏览器脚本均通过，旧流程图 API 与出片审计通过。浏览器双画幅测试曾因等待旧版本更新的时序不足出现一次假红，现等待版本选项真实追加后再切模板，复跑通过。

```text
pnpm --filter @acs/video-scene test
pnpm --filter @acs/video-document test
pnpm --filter @acs/web test
pnpm -r typecheck
pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
node scripts/video/e2e-dual-aspect-edit.mjs
node scripts/video/e2e-multielement-stem.mjs
node scripts/video/e2e-composition-templates.mjs
node scripts/video/verify-legacy-flow-style.mjs
node scripts/video/audit-composition-templates.mjs
```

前三个浏览器脚本及旧流程图 API 测试需本工作树 web :3210。默认 e2e 输出在忽略目录，避免覆盖原 STEM 留样。报告中的四镜头 MP4 无 TTS 音轨；本轮只验证视频编排与导出。

## 请求重点独立核查

1. F2 模板切换过程中 `compositionDraft`、折线草稿和 `layoutDraft` 是否可能跨组件残留；返回当前组件后旧布局是否仍合规。
2. F3 豁免是否严格限于旧流程图自动派生 `nodeTextColor`，其它调色偏离能否继续阻断。
3. 图片 data URL 的格式、大小、签名校验及浏览器导出在任意坏输入下是否安全、明确报错。
4. 三模板选用、再次编辑、回滚与旧项目导入是否共用原版本链，能否避免“看起来预览成功但保存失败”。
5. 对照抽帧做独立视觉检查：字幕重叠、标签溢出、图像裁切、竖版留白与整体审美；不要把自动通过等同于商业成片。
6. 比较基线留存 MP4 哈希，确认兼容性复渲确实来自当前代码。

## 第三轮增量复核（G1–G8）

来源：`artifacts/codex-fix-video-studio-composition-review-findings-2026-10-23.md`。请只看本轮相对 `eb88327` 的增量。

- G1：去除组合模板选择时对共享 `draft.background` 的写入；实际应用时，在用户未手改背景的条件下，向 `buildRevisePatch` 传模板默认背景。已有 Style Bible 的样片会按其背景 `#122137` 自动重映射，模板原始默认 `#102033` 另由单测核对。浏览器增加“浏览→还原→只改时长”背景不变，以及真正选用模板后正确生成组合镜头的断言。
- G2：`flowStepLabelMaxWidth` 从 flow-steps 真实常量得出；组件与 explainer 共用。测试把函数结果对照实际 SVG 盒宽，涵盖横竖 2/4/8 步。
- G3：`@acs/shared` 新增 WCAG 相对亮度/对比与可读前景，Style Bible、flow-steps 和旧 flow-diagram 共用。测试覆盖 `#757575`/`#767676` 临界两侧；包依赖与 lockfile 已更新。
- G4：接受未合并分支内标注边界收紧，明确旧分支实验项目可能需改坐标；见设计文档第三轮节。通用坏 spec 的预览错误 UI 不纳入本轮。
- G5–G8：组合模板错误优先返回本族消息；删永不触发的校验；尺寸膨胀关系在两侧标明；布局草稿为 null 时明确报错并停止，而非用旧草稿回退。

最终验证：video-scene 179/179、video-document 158/158、web 276/276；全工作区 typecheck、Biome 426 文件、QA 注册表 97 自动/53 手工。浏览器双画幅编辑、STEM、组合模板三链通过；旧流程图真实 API 出片通过。把旧 STEM 项目复制到 `.tools/composition-third-compat/`，用当前代码和原 Style Bible/旁白重新生成横竖 MP4，SHA-256 依次为 `F0CC0E151DFB524DA153E55802E8BC24E81C48C610876F3092AEF695CBE8150F`、`CEE7C159CFBCFEFE69C63DA0F9FFBD9F87663C9BECBD5C4CB529E7780F6C6CC8`，与留样逐字节相同。

本机安装 pnpm v9 与项目要求 v11 不一致，正常根 `node_modules` 重装遇在用的 Next 原生模块文件锁；在忽略的 `.tools/isolated-*` 安装了同锁文件依赖并用包内链接执行验证。代码、lockfile 与真实出片验证独立于这种本机安装路径；换环境时用项目声明的 pnpm v11 正常安装即可。请复核 G1 的“手改背景”分支，以及 G4 接受边界收紧是否符合团队发布策略。

## 第四轮增量复核（R1–R6）

来源：`artifacts/codex-fix-video-studio-composition-review-findings-r4-2026-10-23.md`。R1 保留已接受的“选中模板即播种草稿、还原下拉不复位”行为，设计文档说明用户影响与规避方式；浏览器脚本在已有组合镜头上断言浏览线描模板→还原→应用后，标题和图示变为线描模板默认值。原“浏览还原背景不变”测试增加注释，明确只检验文字镜头背景隔离。

R2/R3 将实际应用时的背景交接提取到纯函数，增加未手改、手改后又改回原色、其它模板族三种单测。背景输入框用 touched 状态记录用户动作，切换工作版本时重置。R4 的组合族前缀判定统一为 `isCompositionTemplateId`。R5 删除同族合并路径上不可达的空草稿分支，保留契约注释。R6 将非组合模板的错误回退改为实际解析顺序 chart→flow→map→stick→sketch→loading→composition；第四轮清单中写的 chart→map→flow 与代码顺序不同，以代码路径为准。

验证：video-scene 179/179、video-document 158/158、web 277/277；全工作区 typecheck、QA 注册表 97 自动/53 手工；组合模板、双画幅编辑、STEM 三条浏览器链均通过。旧 STEM 项目从留存 JSON 复制到 `.tools/composition-fourth-compat/`，在当前代码重渲横竖版，SHA-256 为 `F0CC0E151DFB524DA153E55802E8BC24E81C48C610876F3092AEF695CBE8150F`、`CEE7C159CFBCFEFE69C63DA0F9FFBD9F87663C9BECBD5C4CB529E7780F6C6CC8`，与第三轮基线逐字节一致。输出留在忽略目录，不覆盖原样片。
