# Codex 复核 Claude 水循环视觉线（2026-10-24）

范围：`D:\codex\animate\.claude\worktrees\stem-visual` 的 `claude/video-stem-visual@3188f71`，相对 `22ea60f`。本轮只读该工作树；未改 Claude 分支。`apps/web/next-env.d.ts` 当前有 Next dev 自动生成的未提交改动，不纳入结论。

## 结论

组件与样片改动基本可用，暂不按“完整可编辑 STEM 模板”验收。一个用户可见的编辑器缺口需要在集成前补齐；一个共用字幕视觉缺陷已在 Codex 分支修复，待合并后重渲染验证。

## 发现

1. **P1｜新增 cycle 在编辑器被显示为“图片”，阶段与短注无法编辑。** `sample-gallery.ts` 镜 2 使用 `diagram.kind="cycle"`；`shot-editor-card.tsx:1150-1210` 只识别 flow/drawing，其他类型落到图片上传分支。用户打开样片会看到错误的“图示类型：图片”，看不到蒸发/凝结/降水/汇流、短注和中心文字的编辑控件；上传图片会把 cycle 图示替换掉。`diagramLabels` 也没有直接编辑控件。Claude 交接单已如实声明这个限制，但它影响“可编辑 STEM”交付口径。建议集成时补 cycle 专用字段与 drawing 标注字段，保存、刷新、回滚和横竖版出片各测一次；在修复前只称“标题、路径等部分字段可编辑”。
2. **P1｜镜 2 末尾出现标点单独占一块字幕。** 证据 `keyframes/portrait-2-late.png`：画面底部是深色圆角块和一个白色句号。原因是既有 `packages/video-document/src/subtitles.ts` 达到 10 字上限后，把尾随 `。` 切成独立 cue，并非 Claude 本次组件引入。Codex 已在 `codex/video-narrated-workbench@0d8e128` 将紧随上限的标点并回前一条，新增该镜原句反例，`video-document` 构建后 159/159。集成后需重新渲染镜 2 晚帧，确认黑色单标点块消失。
3. **P2｜交接单的证据入库说明与 Git 事实不一致。** 报告称 `artifacts/` 全部 gitignored、证据只在本机；但分支实际跟踪了报告、浏览器项目 JSON、字级时间戳 JSON 和 manifest（`git diff --name-only 22ea60f..HEAD` 可核），只把 PNG/MP4 留本机。应把描述改为“文本证据入库，媒体文件本机保留”，免得后续复核者误判证据可用性。
4. **P2｜无关的 Next 生成文件进入提交。** `ac16bc4` 改动 `apps/web/next-env.d.ts` 的 `.next/dev/types` 为 `.next/types`；当前工作树的 Next dev 又自动改回，形成未提交差异。该文件与视觉组件无关，集成时应以主线版本为准，避免开发/构建交替污染提交。

## 已核对的通过项

- `explainer-composition@1` 只增加 cycle 与 drawing labels，未新增并行场景模型；3–6 阶段、两画幅弧跨度和 image 竖版旧偏移均有针对性测试。
- 本地重跑 `@acs/video-scene` 186/186、`@acs/web` 281/281、QA 注册 101 automated / 53 manual，通过。
- 查看 `keyframes/contact-late.png` 和 `portrait-2-late.png`：竖版循环图明显填充画幅，蒸发/降水的图形与标注可读；发现上面的字幕单标点问题。对独立音质与真机播放不作通过结论。
- Claude 交接报告列有浏览器创建、编辑、保存、刷新、回滚、无声双画幅、有声 CLI 双画幅的证据；本次未重复运行全部媒体链路，最终以合并后浏览器有声双画幅验收为准。

## 对 Claude 复核 Codex 的交接

Claude 已对 `7658abd` 出具 `artifacts/video-studio-stem-visual-2026-10-24/codex-review.md`，结论无阻断、5 项挂账。请对 Codex 完整增量 `db41d5b..0d8e128` 补看 `a2abefd`（失败后文件检查清理）、`154b7a8`（VID-047 手工计费验收登记）、`0d8e128`（字幕标点修复）。交接单：`C:\Users\惠普\.codex\worktrees\video-portable-package\animate\artifacts\handoffs\codex-video-narrated-workbench-2026-10-24.md`。重点复核字幕合并是否导致 cue 时序/文本回归，并区分已确认缺陷与优化建议。
