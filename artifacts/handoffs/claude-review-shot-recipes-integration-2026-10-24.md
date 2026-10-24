# Claude 增量复核：shot recipes 集成分支（2026-10-24）

- **审查对象**：`origin/codex/shot-recipes-integration@29f5007`（合并提交，parents `main@28fc6e0` + `claude/video-shot-recipes@54ebee7`）。增量焦点为相对 `54ebee7` 的集成修复；`apps/web` 代码全量过了一遍。
- **方法**：静态精读（集成 diff + 关联契约）+ 独立工作树复跑门禁与浏览器 E2E。未改任何生产代码，未合并未推送。
- **复跑环境**：Node v22.22.2、pnpm 11.19.0、本 worktree 全新 `pnpm install` + `pnpm -r build`（仅库包）；:3210 被其他会话占用，改起本 worktree 专属 dev server（:3217 + 独立 `ACS_MEDIA_STORE`）。

## 结论

**暂缓合并，剩一个轻量阻断项**：`pnpm exec biome check .` 在本分支失败（`qa/registry.json` 的 VID-050 `argv` 行未按格式器折行，见下）。这与 codex 交接单「Biome 449 文件通过」的声明不符（文件数一致、结果不一致）。修法一条命令：`pnpm exec biome format --write qa/registry.json`（或手改多行）后重跑 biome 与 `qa validate` 即可合入。除此之外，四项集成修复全部核验通过，E2E 在注册表同款启动方式下完整复跑通过。

## 四项集成修复核验（逐项）

1. **VID-050 唯一性 ✓**
   - 注册表全文查重：automated 102 + manual 56 无重复 id；`VID-050`（配方，browser-video）与 `VID-049`（便携项目包，manual）各一次。
   - `node scripts/qa/run-regression.mjs validate` → `QA registry valid: 102 automated and 56 manual cases`，与交接单一致。

2. **page.tsx 风格失败 / 连续点击 / 切项目 ✓**（`page.tsx:649-718`）
   - **失败不误报成功**：`applyLinkedStyle(result.document)` 的 `.catch` 不再写回文档，保留原文档并提示 `配方未应用：<原因>`；`result.document` 仅在风格处理成功后提交。旧代码 catch 里照样写回 + 显示「已应用」的问题已消除。
   - **快速连点不丢镜头**：无 Style Bible 路径同步推进 `documentRef.current = result.document` 后再 `setEditor`，同 tick 第二次点击从最新内存文档追加；有 Bible 路径 `recipeApplyPendingRef` 同步置位串行化（busy 传播前的同批二次点击会收到「请等待当前配方完成风格处理」并显示在 `recipe-error`）。
   - **切项目不串档**：所有异步 `setEditor` 均为函数式更新并带 `previous?.document.id === current.id` 守卫；busy 期间编辑器返回列表按钮禁用（`page.tsx:603`）+ 表单 `inert={busy}`（`page.tsx:615`），异步窗口内无实际切换路径。`documentRef` 的迟到写入在无守卫消费者处有理论竞态，但唯一无 id 防护的读者 `handleStockImport`（`page.tsx:378`）需要秒级网络操作才能与毫秒级风格处理窗口重叠，且旧代码用陈旧 `editor` 闭包整体覆盖更糟——本分支是收窄而非引入，不构成阻断。

3. **<200ms 媒体拒绝与契约一致 ✓**（`shot-recipes.ts:290`）
   - 三层同口径、边界含 200：上传层 `media-store/src/ingest.ts:37` `MIN_DURATION_MS=200`（422 duration-out-of-range）→ 项目校验 `video-document/src/validate.ts:112`（`original.durationMs 须为 200..MAX`）与 `:216`（`outMs ≥ inMs+200`，C3）→ 配方应用前置拒绝并给出中文原因。
   - 拒绝发生在构造镜头之前；回归测试「不足 200 毫秒的媒体原件在创建镜头前拒绝」实跑通过（`shot-recipes.test.ts` 12/12）。

4. **E2E tsx 启动与实跑 ✓**
   - `apps/web` devDeps 含 `tsx ^4.20.0`，`cwd:"apps/web"` + `node --import tsx ../../scripts/video/e2e-shot-recipes.mjs` 与 web 既有 `test` 脚本同款调用；脚本 `root` 由 `import.meta.url` 解析，不受 cwd 影响。
   - **完整复跑 PASS**（注册表同款启动方式，Node 22.22.2）：三配方应用、改标题、保存、刷新重开、双画幅预览、H.264 横竖出片、预览/导出文本一致性全过。证据 `.tools/recipe-review-e2e/`（本 worktree，含 `report.json` pass/3 镜头/0 错误、两个项目 JSON、双 MP4、抽帧、render-manifest）。

## 门禁复跑结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm --filter @acs/web test` | ✅ 300/300 |
| `pnpm -r typecheck` | ✅ 全过 |
| `pnpm exec biome check .` | ❌ **1 错误：`qa/registry.json` VID-050 `argv` 单行超宽应折行**（449 文件中唯一失败；纯格式，JSON 语义不变） |
| `node scripts/qa/run-regression.mjs validate` | ✅ 102 自动 / 56 手工 |
| VID-050 浏览器 E2E（注册表启动方式） | ✅ PASS（证据见上） |
| `next build` | ✅（首次被 Next 安全公告自中断 exit 1，同命令重跑即过——环境已知坑，非分支问题） |

## 剩余问题

**阻断（1，修完即可合并）**

- B1 `qa/registry.json:9` VID-050 `argv` 触发 biome format 失败（上述）。同时请更正交接单中「Biome 449 文件通过」的口径。

**非阻断（合并后跟进，按价值排序）**

1. **[功能] `recipe-catalog.tsx:47-59` 空数值段静默变 0，数据配方默认输入不可达**（Claude 原交付即有，非集成回归，已代码推演确认）：`rawValues` 只 trim 不过滤空串（labels 有 `.filter(Boolean)`，values 没有），`Number("")===0` → 全新打开数据卡直接点「添加到项目」必得「分类数量须为 2..8 个」而非默认四季度图（文字卡空输入却正常走默认，行为不一致）；`"1,,3"` 型空段在计数对齐时静默插 0 值柱。修法：`rawValues` 先 `.filter(Boolean)` 再 `map(Number)`。
2. **[文档] `artifacts/video-studio-shot-recipes-2026-10-24/REPORT.md:9,34`** 回放指引仍是集成前形态（标 `VID-049`、从根目录无 tsx 启动），与 `:38` 的集成记录及注册表实际口径矛盾；按文档复跑会在 Node 22.0 复现 `.ts` 加载失败。
3. **[测试缺口] `shot-recipes.test.ts:340`（F2b）** 用 `values:[1e13,1]` 声称覆盖 `applyShotRecipe` 的 `validateSceneSpec` 防线，实际先被 build 自身 `>1e12` 拦下，该 catch 零覆盖；放宽 build 上限或新增配方时防线失效不会被测出。
4. **[复用] `shot-recipes.ts:69-115`** 手写 SvgNode 字符串序列化 + XML 转义，重复 `scene-preview.tsx` 的 `SvgTree` React 渲染，且因此引入 `dangerouslySetInnerHTML` 注入面；换 React 渲染可消掉整套转义测试负担（e2e 字符串可比性可在测试侧序列化）。
5. **[复用] `shot-recipes.ts:360`** totalMs 归约与 `apply-plan.ts` 私有 `filmWorkingDurationMs` 重复且 fallback 语义分叉（`contentVersions[0]!` vs `?? 0`），与注释「对账口径一致」相悖，应抽共享 helper。
6. **[测试质量] `e2e-shot-recipes.mjs:81`** `const project = await page.evaluate(() => document.title)` 读的是页面标题却命名 `project`，断言恒真；建议删除或改为真实项目断言。
7. **[A11y] `recipe-catalog.tsx:190`** `role="tablist"` 内是无 tab 语义的普通按钮，读屏器宣告与实际行为不符；改普通 group 或补齐 tab 语义。

## 环境备注（复跑者需知）

- **:3210 被占**：注册表用例 `requiresPorts:[3210]`，本机 3210 为其他会话服务器持有；本复核以 `BASE_URL` 指向自起 :3217 完成，脚本原生支持该覆盖。
- **Next 16.4 跨源 HMR 拦截**：`BASE_URL=http://127.0.0.1:<port>` 而服务端广播 `localhost` 时，`/_next/hmr` 被拦 → 水合不完成 → `html[data-studio-ready]` 30s 超时。改用 `http://localhost:<port>` 即过。与分支无关，但 QA 主机起服务时需保证 BASE_URL 主机名与 dev server 广播一致（或配 `allowedDevOrigins`）。
- **E2E 出片的媒体原件**来自用户级仓 `C:\Users\惠普\.acs\media-store`（内容寻址命中历史运行产物）；浏览器侧 ingest 走的是本 worktree 独立 `ACS_MEDIA_STORE`。不影响结论。
- pnpm v11 下 `pnpm dev -- -p <port>` 会把 `--` 透传成无效目录参数，起服务用 `pnpm exec next dev -p <port>`。

## 审查过程说明

静态审查由主会话与一路并行 code-review 代理分头进行后合并去重；并行代理的候选发现中，第 1/2/3/6/7 条经主会话逐一按代码核实保留，第 4/5 条为方向正确的清理项未逐行复核；门禁与 E2E 复跑、biome 失败、Next 跨源坑为主会话独立发现。
