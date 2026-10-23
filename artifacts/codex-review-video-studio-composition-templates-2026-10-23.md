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
