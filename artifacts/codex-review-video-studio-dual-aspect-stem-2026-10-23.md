# Codex 复核交接：双画幅整改 + STEM 有声样片

## 范围

分支 `video-studio/dual-aspect-edit`，基于 main `226a488`。本轮增量是在原有双画幅预览/微调交付之上修复三项复核问题，并把 STEM 样片库起点扩为 7 镜头、约 26 秒有声解说。仅提交开发分支，不合并或推送 main。

## 重点复核

1. `packages/video-scene/src/components/line-chart.ts`：末点优先时，前一个过近采样标签让位；竖版覆写的字号宽度按真实可见标签的相邻间距计算。无覆写旧路径应保持渲染行为。参看 `line-chart.layout.test.ts` 与双画幅真出片关键帧。
2. `apps/web/src/app/video-studio/shot-editor-card.tsx` + `aspect-layout-edit.ts`：构造中间 spec 时移除旧 layout，再将本次内容/布局草稿合并至最终 spec 并校验。注意旧覆写保留、换模板清除、不支持组件拒绝三种路径。
3. `sample-gallery.ts`：原 4 镜头/9 秒 STEM 起点改为 7 镜头/26 秒，移除了没有来源的 100% 数值镜头。浏览器创建/修改/保存/重开/横竖预览/双版导出由 `e2e-gallery.mjs` 覆盖。
4. `flow-diagram.ts`：可选 `nodeTextColor` 解决浅色节点与白字低对比；未提供该字段的旧 spec 继续沿用 `textColor`。Style Bible 不覆盖此字段。
5. `audit-stem-sample.mjs` + VID-037：对已留存的项目、Style Bible、7 份 WAV/字级时间戳、双版视频、AAC、字幕摘要、时长和 14 条渲染记录进行无计费复核。

## 证据及结论

- 双画幅整改：[审片报告](video-studio-dual-aspect-edit-2026-10-23/REPORT.md)、[竖版折线修复帧](video-studio-dual-aspect-edit-2026-10-23/keyframes/after-portrait-line-chart.png)；VID-035/036 实跑通过。
- STEM 样片：[逐镜报告](video-studio-stem-sample-final-2026-10-23/REPORT.md)、[横版 MP4](video-studio-stem-sample-final-2026-10-23/render/landscape.mp4)、[竖版 MP4](video-studio-stem-sample-final-2026-10-23/render/portrait.mp4)。定位是可编辑的基础 STEM 解说工作流演示，不宣称高端科普动画质量。
- 失败后重做记录：首轮人工审片发现汇流节点低对比与结尾不佳，修正后重做；早期试验产物未作为最终验收证据。

## 复跑

```text
pnpm --filter @acs/video-scene test                 # 168/168
pnpm --filter @acs/web test                         # 269/269
pnpm --filter @acs/video-document test              # 155/155
node --test scripts/video/frame-dryrun.test.mjs scripts/video/render-scene.props.test.mjs  # 15/15
pnpm -r typecheck
pnpm exec biome check .
node scripts/qa/run-regression.mjs validate         # 92 automated / 53 manual
node scripts/video/audit-stem-sample.mjs            # PASS, 不需 TTS key
SAMPLE_ID=stem node scripts/video/e2e-gallery.mjs   # 需 web :3210
node scripts/video/e2e-dual-aspect-edit.mjs          # 需 web :3210
node artifacts/video-studio-dual-aspect-edit-2026-10-23/audit-exports.mjs
```

人工审片涵盖逐镜抽帧构图、文字可读性和颜色；音轨、旁白时长与字幕由结构化数据检查，尚无独立人耳主观审听。请将这点视为质量证据边界，不要把编码通过误判为审美达标。
