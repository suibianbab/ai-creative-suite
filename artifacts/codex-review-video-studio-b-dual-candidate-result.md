# Codex 复核结论：Video Studio B 关键镜头双候选

复核范围：`d6abdc2..55e4c0a`，2026-10-22。结论：**暂缓合并；修复 1 项 P1 入口一致性问题后复审**。本轮未修改生产代码。

## P1：旧版“回滚到此版本”可绕过零帧闸门

新对比面板的“选用此候选”在 `shot-editor-card.tsx:336–345` 先调用 `describeDurationImpact` / `durationApplyError`，这条路径正确。但同卡片保留的版本下拉和“回滚到此版本”在 `shot-editor-card.tsx:494` 直接调用 `onRollback`；`page.tsx:699–709` 直接执行 `rollbackWorkingVersion`，没有同样的时长检查。因而用户可对同一候选通过新按钮被拒、通过旧按钮成功。这样会把合法项目变成零帧时间线，后续预览或渲染失败。

复现依据：现成的 `artifacts/video-studio-candidate-compare/blocked.video-project.json` 经交接单的浏览器脚本验证为合法导出，镜头 1 有 2000ms 工作版本和 1ms 非工作候选。用现有 `rollbackWorkingVersion` 指向该 1ms 版本后，`quantizeTimeline([1, 2000], 24)` 抛出“第 1 个镜头在该帧率下为零帧”。本次在工作树内独立执行了这组操作并复现报错。

建议把候选切换的闸门放在两种入口共用的应用路径上，旧按钮和对比面板都调用同一校验；保留锁定镜头可由人工切换和 audit 留痕的现有语义。增加反例回归：同一 1ms 候选，经两个按钮都被拒，`workingVersionId`、文档事件和工作版本时长均不变。再覆盖存量零帧项目的“严格缩小且不新增零帧”修复路径，防止把现有修复能力封死。

## 其余核对

- 候选摘要只读取既有 `contentVersions` 和 `deriveStatus`；选择不引入新 schema 或审批事件，设计方向正确。
- 双列默认对与下拉互斥逻辑、帧数计算复用 `describeDurationImpact`，未发现第二套帧数学。
- 浏览器脚本覆盖了新对比入口、锁定选用、保存重开、导出和新入口的零帧拦截；**未覆盖旧回滚入口的旁路**。
- 本次独立复跑 `@acs/web` 244/244、Web typecheck、Biome 385 文件、QA 注册表 85 automated / 53 manual，均通过。未独立重跑浏览器 E2E；其既有证据只证明新入口。

修复后请提交最小增量和上述双入口反例，再交 Codex 复审。

## 2026-10-22 整改结果

已由 Codex 实施：两个入口统一调用 `version-selection.ts`，对比面板展示局部错误，旧入口展示工作台消息。新增单元测试覆盖拒绝、锁定下合法选用、存量多零帧逐镜修复；VID-027 浏览器第 7 步增加旧入口反例，并检查拒绝后事件数不变。独立复跑 Web 247/247、typecheck、Biome 386 文件、QA 85/53、浏览器 7 步通过，控制台 error 0、TTS 台账 0→0。原 P1 已关闭；上文保留原始发现与复现依据。
