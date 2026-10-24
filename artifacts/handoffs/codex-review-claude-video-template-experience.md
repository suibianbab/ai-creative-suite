# Codex 复核：Claude 模板创作体验线

范围：d5470be..d9c8d73（实现到 19a3c7a，最后一提交仅更新交接单）。复核日期：2026-10-24。

## 结论

两套新样片、预填提示与浏览器编辑链路可用。当前无产品代码阻断缺陷；VID-044 仍有一处验收门禁缺口，修好后再将其称为“可持续的真实出片回归”。

## 发现

### [P2] VID-044 对历史产物做静态审计，无法发现当前样片或渲染代码回归

位置：scripts/video/audit-gallery-extensions.mjs:17-53、:55-91；qa/registry.json 中 VID-044。

审计固定读取已入库的 artifacts/video-template-experience-2026-10-23 下 project.json、manifest 和 MP4，然后检查帧数、分辨率及文件摘要。它既不从当前 sample-gallery.ts 创建项目，也不调用 render-scene 生成新文件。若之后样片文案、参数、Style Bible 或渲染器变了，只要旧产物还在，VID-044 仍可 PASS。现有检查也只比对 project.id 与 browser-report，不核对各镜当前 versionId/contentDigest 与 manifest.frameMap，更不核对 renderRecords 的逐项引用。因此“10 条渲染记录”只能证明数量，不能证明它们属于这四个视频的当前镜头。

复现：只改 sample-gallery.ts 中新样片的镜头参数，不更新 artifacts；运行 node scripts/video/audit-gallery-extensions.mjs 仍会打印 pass:true。无需对入库证据做破坏性修改即可从脚本固定输入路径确认这一点。

建议：保留本批历史产物作为交付证据；将 VID-044 改成在 .tools 下由当前代码创建样片并执行双画幅渲染，随后对新产物做现有审计。若 CI 时间不允许每次全量出片，应把现有 VID-044 明确标为“留存产物完整性检查”，另设 live render 门禁。审计时至少逐镜比对当前 workingVersionId/contentDigest、frameMap 和对应 renderRecords。

## 非阻断提醒

- scripts/video/e2e-gallery-extensions.mjs:174-195 验证了内存中的回滚及导出 JSON，但回滚后没有再次点击保存和刷新。页面的 onRollback 只更新 editor state；若要承诺“回滚后重新打开仍保持回滚版本”，需补保存和重开断言。目前交接单只承诺回滚操作，故不判为产品缺陷。
- next build 失败原因尚未查明，不能据本轮单测和 dev server 结果推断生产构建已通过。
- 样片为简洁程序化说明视频；抽帧画面无明显重叠或裁断，但未达到商业成片审片口径。

## 独立复核证据

- pnpm --filter @acs/web test：exit 0，280/280（交接单写 279/279，实际本次多 1 项）。
- BASE_URL=http://127.0.0.1:3212 node scripts/video/e2e-gallery-extensions.mjs：exit 0，两题材通过；输出在本 worktree .tools/video-gallery-extensions-e2e。
- node scripts/video/audit-gallery-extensions.mjs：exit 0；renovation 双画幅 384 帧，appliance 双画幅 396 帧。
- 目检入库 portrait-sheet、横竖 late-sheet：四步流程、户型示意、后期标注均可见，未见明显遮挡。此为抽帧检查。
- 未独立重渲四个 MP4；本次 VID-044 复跑只核查了入库 MP4。
- 复核后 git tracked 工作树保持干净；本文为未跟踪交接件。

## 增量复核与处置（2026-10-24）

Claude 的 e5556ed 将 VID-044 明确改为留存证据完整性检查，并新增 VID-046 实时浏览器加双画幅渲染门禁，原 P2 的主问题已解决。Codex 复核时补了两处门禁缺口：VID-046 wrapper 缺少默认 BASE_URL，按注册表命令会立即退出；e5556ed 删除了原有的项目时长与 frameMap 总帧数对账。两处已在本分支修复，详见 Claude 交接单的增量复核补记。
