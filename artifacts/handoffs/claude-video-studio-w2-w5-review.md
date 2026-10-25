# W2–W5 汇总复核交接（2026-10-24）

分支 `claude/video-studio-w2-w5`（基线 `origin/main@be77030`，HEAD 见分支尖）。四包连续执行完毕；各包详情见各自报告（`artifacts/handoffs/claude-video-studio-w{2,3,4,5}-result.md`）。

## 里程碑一览

| 包 | 交付 | 四态 | 提交 |
| --- | --- | --- | --- |
| W2 风格代表帧确认与派生 | 三重绑定确认 + 失效导出闸门 + 派生版本 + 三套内部对照（VID-051） | 代码✓/自动✓/浏览器与出片✓/视觉**待人工** | 80707b2→f8bc8a9+ |
| W3 3D 两路线 | Three 路线 Golden Spike（计时/关键帧/身份门禁设计）；Blender 路线协议就绪 | Three✓；Blender **待环境** | W3 专项提交 |
| W4 交互 3D 样片 | 531KiB 自包含交互页（拖转+拆解）+ 离线/iframe/重建一致 e2e（VID-052） | 前三态✓；真机**未测** | W4 专项提交 |
| W5 剪辑交换清单 | `acs-edit-list` v1 导出器 + 真实 STEM 导出 + 人工往返清单（VID-053） | 清单层✓；真实往返**待环境/待人工** | W5 专项提交 |

## 门禁总况

video-scene 189/189、video-document 163/163、web 306/306、typecheck、Biome、`qa:validate` 105 自动 / 56 手工；W2 e2e exit 0（修复轮后三次复跑）、W1 两条回归（配方/STEM 样片）exit 0、W4 e2e exit 0、W5 测试 3/3。

## 请 Codex 独立复核（按严重度）

1. **W2 安全修复**（`f8bc8a9`）：确认帧渲染的 XSS 修复（转义+渲染前校验）与 seededRandom 同源化——建议独立尝试构造恶意 spec 复现与绕过。
2. **W2 schema 加法**：styleFrameApprovals/derivedFrom 的 validate/evolve 语义与「必须伴随 styleBibleRef」规则。
3. **W2 导出闸门只在客户端**（renderFromWorkbench 前置）：API 直连可绕过——是否在 render route 服务端补判（route 文件是 Codex 上轮所有权），属集成决策。
4. **W4 自包含页**：重建逐字节一致依赖 esbuild 确定性（同版本+同输入）；跨 esbuild 版本不承诺。
5. **W5 清单契约**：单一权威时间线的无缝约束是否会与未来转场/垫片需求冲突（v1 已留字段空间）。

## 挂账与待人工汇总

- 待人工：W2 三套对照审片与人耳听审；W3/W5 人工评审项。
- 待环境：Blender 执行器（W3 双路线结论必须等它）；许可剪辑编辑器（W5 真实往返）。
- 已知环境项：`next build` 安全提醒自中断未验证；3210 被其它会话 worktree 占用（本轮 3218）。
- 事故留档：W2 曾对留存 STEM 项目原地渲染（render-scene 回写 14 条记录），已 `git checkout` 还原——对留存证据渲染必须先拷贝。

## 复跑入口

```text
pnpm --filter @acs/video-scene test && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check . && node scripts/qa/run-regression.mjs validate
node scripts/video/e2e-frame-approval.mjs        # 需本 worktree web（:3218）
node scripts/video/e2e-w4-interactive.mjs        # 离线 file://，无需 server
node scripts/video/w3-three-golden-spike.mjs     # Three 路线复跑
node --test scripts/video/export-edit-list.test.mjs
```
