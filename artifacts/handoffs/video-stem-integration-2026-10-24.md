# Video Studio STEM 视觉与有声工作台集成验收

日期：2026-10-24。分支：`codex/video-stem-integration`，基线 `main@67ced84`；合并了 `claude/video-stem-visual@61f18ec` 和 `codex/video-narrated-workbench@9b8be55`。

## 交付

- `explainer-composition@1` 增加循环图与线描部件标注；七镜 STEM 样片采用这些结构化镜头。
- 镜头编辑器增加循环阶段、短注、中心字和线描标注的实际控件；新增通用四阶段循环模板。修改进入现有内容版本、保存、重开及回滚链路。
- 浏览器提供独立有声横竖 MP4 入口；TTS 资产按内容寻址缓存在 Git common dir，共享计费台账和跨工作树锁保护既有 ¥50 上限。出片中锁编辑；对齐版与成片版原子导入本地项目。失败不生成成功下载或渲染记录。
- `apps/web/next-env.d.ts` 恢复 main 的开发路径引用，避免视觉分支生成文件的无关变更进入主线。

## 交叉复核

Claude 首轮报告：`D:/codex/animate/.claude/worktrees/video-template-experience/artifacts/claude-review-narrated-workbench-2026-10-24.md`，发现 N1–N7。Codex 在 `9b8be55` 修复。Claude 对 `c01bff1..9b8be55` 二轮复核：`D:/codex/animate/.claude/worktrees/claude-rereview-narrated-9b8be55/artifacts/claude-rereview-narrated-workbench-9b8be55.md`，结论 N1–N7 修复、无新阻断。Codex 对视觉线的审查：`artifacts/handoffs/codex-review-claude-video-stem-visual-2026-10-24.md`；集成时补齐“循环图被当图片”以及结构化标注编辑入口。

## 验证证据

- `node scripts/video/e2e-cycle-editor.mjs`：`cycle/drawing labels edit-save-reopen-rollback PASS`，零 TTS 费用。脚本产出 `.tools/e2e-cycle-editor*.video-project.json`。
- `node scripts/video/e2e-narrated-workbench.mjs`：真实浏览器完成七镜双画幅有声下载；`.tools/video-narrated-workbench-e2e/report.json` 的 `consoleErrors=[]`、`renderRecords=14`、两画幅各七组旁白/字幕。横版 MP4 1,436,570 字节、SHA-256 `91a13980384d9509fa74d074702fc2a4f0603ee7287d0fd01d3f4601848d5c17`；竖版 1,425,326 字节、SHA-256 `05867c8ef9d583a501f037308d0272aece1532f9921fee76f0a7409a31ecb72e`。运行使用故意无效的占位密钥，七段全命中缓存；共享账本前后均 28 条，证明本轮无新付费请求。
- 竖版镜头 2 的 6.8 秒抽帧 `.tools/video-narrated-workbench-e2e/portrait-shot2-late.png`：字幕“天空和陆地间不停移动。”同块显示，句号未单独成块。
- `@acs/video-scene` 186/186、`@acs/video-document` 159/159、`@acs/web` 284/284；`pnpm -r typecheck` 全通过；`pnpm exec biome check .` 438 文件通过；QA 注册表 101 自动、55 手动。

## 能力边界

这是可编辑的结构化 STEM 解说样片和实际有声出片链路验收。音轨非空与字幕可见已验证，配音自然度、最终商业审美未经过正式人耳/客户评价。Claude 二轮复核列出的强杀后遗留 TTS 锁、仍运行旧版 CLI 时绕过共享账、缓存无淘汰等属于后续可用性或运维事项。新版默认只在本地开发环境提供浏览器出片。
