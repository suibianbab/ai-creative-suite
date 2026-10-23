# 复核交接：双画幅 P1–P6 整改与 STEM 多元素镜头

## 范围

分支 `video-studio/dual-aspect-edit`，复核增量 `39a0656..HEAD`。本分支只提交、不合并或推送 main；主检出已有未提交内容未触碰。需求源为 `artifacts/codex-fix-video-studio-dual-aspect-review-findings-2026-10-23.md` 与本轮 goal。

## 改动索引

- P1：`packages/video-scene/src/components/line-chart.ts` 与 `.layout.test.ts`。
- P2/P3：`apps/web/src/app/video-studio/{chart-templates.ts,aspect-layout-edit.ts,shot-editor-card.tsx}`，相应单测与 `scripts/video/e2e-dual-aspect-edit.mjs`。
- P4：`packages/video-document/src/style-bible.ts` 与测试。尤其请检查「原节点字色对新盒底仍可读则保持，否则选调色板前景或黑/白」的语义，以及旧项目风格验证。
- P5/P6：`text-animation.ts` 标题字号钳制共用函数、死导出移除。
- 多元素：`packages/video-scene/src/components/explainer-composition.ts`（注册表 v8）；`sample-gallery.ts` 镜头 2/5；`shot-editor-card.tsx` 有界编排表单；浏览器、旁白复用和出片审计脚本。
- 方案与质量：`docs/VIDEO_STUDIO_MULTIELEMENT_COMPOSITION_2026-10-23.md`、`artifacts/video-studio-multielement-2026-10-23/REPORT.md`。

## 可核对的证据

- 组件测试 173/173、文档测试 156/156、Web 测试 272/272；全工作区 typecheck、Biome 420 文件、`qa:validate` 94 自动/53 人工通过。
- `scripts/video/e2e-dual-aspect-edit.mjs` 真浏览器覆盖 12→6 点草稿、自动移除三个越界覆写并直接应用。`scripts/video/e2e-multielement-stem.mjs` 覆盖双镜编辑、保存重开、双画幅 SVG、镜头回滚；默认输出 `.tools`，不覆盖留存产物。原 `e2e-gallery.mjs` 的 STEM 流也通过双画幅出片。
- `render-audit.json`：最终双画幅 H.264 24 fps + AAC，26.005 秒，7 条旁白与字幕、14 条渲染记录。`keyframes/contact-sheet.png` 与逐镜/前后关键帧供人工复核。人工审片结论与不足在 REPORT.md。
- `compatibility-audit.json`：上一版完整 STEM 项目以本轮代码重新渲染，同机横竖 MP4 与既有文件 SHA-256 均逐字节相同。旧样片与新样片所有旁白文本一致；第 2 镜头时长对齐 4.01 秒后复用原 WAV/字级时间戳。

## 建议重点审查

1. P1 空 `portrait:{}` 与无 layout 的全树相等；首末标签不会因中间短标签缩到不可读。
2. P2 草稿点数与最终解析同源；从非法中间态恢复后不会误删仍有效的短标签；已移除项提示准确。
3. P4 旧项目可继续校验与渲染；切换深浅 Style Bible 的节点文字对比在 4.5:1 以上。
4. `explainer-composition@1` 是否严格受限、确定性，复用的旧组件 v1 行为未修改；两画幅排布与字幕没有冲突。
5. 编辑表单在模板切换、版本回滚、保存重开时是否正确重置，非法参数不会写入内容版本。
6. `VID-038` 的默认 `.tools` 输出与 `VID-039` 的留存有声出片审计互不覆盖。
7. 报告应区分新两镜头通过与全片商业级质量；旧镜头 3/4/6 的字号限制不可隐去。

## 复跑

```text
pnpm --filter @acs/video-scene test
pnpm --filter @acs/video-document test
pnpm --filter @acs/web test
pnpm -r typecheck
pnpm exec biome check .
node scripts/qa/run-regression.mjs validate
node scripts/video/e2e-dual-aspect-edit.mjs
node scripts/video/e2e-multielement-stem.mjs
node scripts/video/audit-multielement-stem.mjs
```

浏览器脚本需要本工作树的 Web 服务在 :3210。两条有声 MP4 已留存；重新生成须按 REPORT.md 顺序重跑浏览器、旁白资产映射与渲染。
