# 多元素模板与 F1–F6 修复验收（2026-10-23）

## 范围和结论

开发分支 `video-studio/dual-aspect-edit`。F1–F6 逐项修复；三种预填模板复用 `explainer-composition@1`、SceneSpec、内容版本及原保存/回滚链路。浏览器真实操作、非 STEM 四镜头双画幅 MP4、图片模板变体、旧项目渲染与 STEM 留样兼容均已检查。该样片为功能验收，不宣称商业级成片。

## 反例与功能证据

| 项 | 结果 | 复核入口 |
| --- | --- | --- |
| F1 流程标签 | 8 步四字标签仍按盒宽适配 | `explainer-composition.test.ts` |
| F2 模板草稿 | 12 点带第 12 条短标签→8 点模板→返回当前组件→应用成功 | `e2e-dual-aspect-edit.mjs`；`aspect-layout-edit.test.ts` |
| F3 旧流程图 | 缺 `nodeTextColor` 的低对比旧 spec 经真实渲染 API 返回 200，且没有强迫写新内容版本 | `verify-legacy-flow-style.mjs`；`style-bible.test.ts`；`flow-diagram.test.ts` |
| F4 标注与字幕 | 越界 y/portraitY 拒绝；合法文字不压字幕带 | `explainer-composition.test.ts` |
| F5 计数 | 空的越界短标签不计“已移除” | `aspect-layout-edit.test.ts` |
| F6 重复解析 | resolvedBase 只解析一次 | `shot-editor-card.tsx`；web 回归 |

三种模板为四步流程、线描解说及上传图片解说。浏览器测试使用“客厅改造”四镜头：选择、改写、保存重开、回滚、横竖版预览均通过，浏览器控制台无错误；[操作报告](browser-report.json)、[横版截图](browser-landscape.png)、[竖版截图](browser-portrait.png)。图片模板另存 [变体项目](image-variant/project.json)，上传真实 PNG 后导出双画幅 MP4；占位图禁止直接保存。

## 真实出片与兼容性

非 STEM 项目在 [项目 JSON](interior.video-project.json) 与 [Style Bible](interior.style-bible.json) 留存，双画幅文件为 [横版 MP4](render/landscape.mp4)、[竖版 MP4](render/portrait.mp4)，各 216 帧、24fps、H.264；4 镜头 × 2 画幅共 8 条渲染记录。[出片审计](render-audit.json) 核对帧数、尺寸、镜头映射与哈希；[manifest](render/render-manifest.json) 留渲染环境。每镜头横竖抽帧位于 `render/landscape-{1..4}.png` 和 `render/portrait-{1..4}.png`。图片变体的双画幅 MP4 与抽帧在 `image-variant/render/`。

旧 STEM 样片使用当前代码重渲染，横版 SHA-256 `F0CC0E151DFB524DA153E55802E8BC24E81C48C610876F3092AEF695CBE8150F`，竖版 `CEE7C159CFBCFEFE69C63DA0F9FFBD9F87663C9BECBD5C4CB529E7780F6C6CC8`，与原留样逐字节相同。旧 `flow-diagram` 项目另经真实 API 导出双画幅，覆盖原留样未命中的低对比情况。

## 人工视觉检查与边界

审看了四镜头横竖各一张抽帧和图片变体双画幅抽帧。标题、流程/线描及标注可辨识，横竖构图均未见文本压字幕或被画幅裁断；图片已在两画幅出现。视觉质量仍是简洁示意视频：线描较抽象，图片模板尚无自动裁切焦点与版面审美建议，镜头节奏、文案和长句换行需要人工调整。本非 STEM 样片有 `narrationText` 但没有调用 TTS，导出的 MP4 是无声验证片。抽帧无法替代逐帧审片或商业验收。

## 复跑命令

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

浏览器脚本需要本工作树的 web 服务在 `http://localhost:3210`。未设置 `STEM_EVIDENCE_DIR`，以免覆盖原留样。
