# C1 交付报告：W2 代表帧确认导出闸门补到服务端（2026-10-25）

分支 `claude/video-studio-closure`（基线 `5ac3375` ← `e3887df`）。任务源：`artifacts/handoffs/claude-video-studio-closure-2026-10-25.md` §C1。修复 W2 复核挂账第 3 条「导出闸门只在客户端，render API 直连可绕过」。

## 改动

- `apps/web/src/app/api/video/render/route.ts`：项目与 Style Bible 校验之后、进入真实渲染之前，服务端调用与工作台同一份纯函数 `approvalStatus`（`apps/web/src/app/video-studio/frame-approval.ts`，无第二套判定逻辑），对每条确认记录重渲染双画幅中段帧并比对三重绑定（内容版本 ID / 风格版本引用含 digest / 帧 SVG SHA-256）。任一失效 → 400 `代表帧确认已失效，未导出：…`，渲染子进程不启动。
- `apps/web/src/app/api/video/render/route.test.ts`：新增 4 条 C1 回归（见下）。夹具经 `styleVersionDigest` 构造真实 Bible 摘要、`renderApprovalFrames` 取真实帧摘要，spec 颜色与调色板逐字一致（过 `workingStyleIssues`）。

服务端不读取任何客户端布尔值——请求里只有 project/styleBible 数据本身，绑定与摘要全部由服务端从数据重算。

## 导出入口清单与闸门适用范围

| 入口 | 请求中的快照 | 闸门 |
| --- | --- | --- |
| `POST /api/video/render`（工作台出片按钮 / 任何直连 POST） | 完整 project（含 styleFrameApprovals）+ 独立 styleBible | **本次已加：服务端复验后才进入渲染** |
| `GET /api/video/render/[jobId]/[aspect]` | 无（只按 UUID 取已成片文件） | 无需：只服务于已过闸门的成功渲染产物 |
| `POST /api/video/portable`（action=export） | project + styleBible + 媒体信封 | 不拦：项目包是数据交换/保存，确认记录随包携带，导入后下次出片时在本闸门复验（口径与 W2 一致：闸门管"出片"，不管"存档"） |
| 工作台 `renderFromWorkbench` 前置检查 | 同 API | 保留：给用户即时失效原因（UX），服务端现在是权威判定 |
| CLI `scripts/video/render-scene.mjs` 直用 | 项目文件 | 不拦（见限制 2） |

旧项目兼容：`styleFrameApprovals` 缺省或为空 = 功能未启用，`approvalStatus` 直接放行——与 W2 客户端口径一致，存量项目（如 interactive-sample 夹具）不受影响，由新增 503 探针回归锁定。

## 四态

1. **代码实现**：完成（上述两文件，服务端 +10 行判定，其余为测试）。
2. **自动回归**：RED→GREEN 依 TDD：
   - RED（闸门实现前实拍）：旧版本重开后直接 POST → **200 且带两条下载链接**（绕过实证，真实渲染 37s）；画面/风格漂移 + narrated 无密钥 → 503（到了密钥检查而非被拒）。证据见本轮测试输出。
   - GREEN：`route.test.ts` 9/9（含原有 5 条）；web 309/309、video-scene 189/189、video-document 163/163、`pnpm -r typecheck`、Biome 全绿。
   - 覆盖：直接 HTTP 绕过（旧版本重开=内容版本失配）、确认后改画面（帧摘要失配）、确认后切风格版本（引用+digest 失配）、无确认旧项目放行、确认有效放行（503 探针）、闸门拒绝不建作业目录、渲染中途失败 500 无下载且作业目录清理。
3. **真实浏览器与导出**：`BASE_URL=http://127.0.0.1:3220 node scripts/video/e2e-frame-approval.mjs` → PASS exit 0（证据 `.tools/video-frame-approval-e2e/`）。完整链路：确认 → **合法双画幅真实渲染出片**（过服务端闸门）→ 改内容失效 → 重确认 → 派生版本再失效 → 再确认 → 保存重开徽章准确。闸门未破坏任何合法出片。
4. **视觉质量**：不适用（无画面变化；e2e 已含双画幅出片存在性核验）。

## 复跑

```text
pnpm --filter @acs/web test            # 309/309（含 C1 四条）
pnpm -r typecheck && pnpm exec biome check apps/web/src/app/api/video/render/
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3220   # 升级提醒自中断就重跑同命令
BASE_URL=http://127.0.0.1:3220 node scripts/video/e2e-frame-approval.mjs
```

## 限制（如实）

1. **闸门是质量闸不是鉴权边界**：本地开发环境（route 仅 development + 同源开放）里，执意绕过的调用方本可删掉/改写 project 里的确认记录（等于自行弃用该功能）。闸门保证的是「带着失效确认记录的任何直连出片请求都进不了渲染」，与 W2 设计口径一致。
2. **CLI 直用 render-scene.mjs 不过闸门**：它是渲染 API 自身的底层执行器（本闸门就在其上游）；直接跑 CLI 等同直接改文件，属同信任级，不在 HTTP 入口管辖内。
3. 帧摘要复验在服务端重渲染（纯函数、无头），1 镜头项目 <400ms；确认记录很多时耗时线性增长（当前产品规模可忽略）。
4. 中途失败清理（cleanupFailedJob）为既有行为，本轮以路由级 500 断言 + 作业目录计数锁定，未逐字节验证清理时机。
