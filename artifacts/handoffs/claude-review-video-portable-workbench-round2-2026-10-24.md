# Claude 复核（第二轮）：Video Studio 浏览器可移植项目包（2026-10-24）

范围：`origin/codex/video-portable-workbench` 增量 `3c5538f..a2361ed`（5 个提交：fffe7cd 篡改包 e2e、eacc5a2 旧项目封装覆盖、9d72aef 下载状态保留、6ad91d0 Windows namespaced 路径修复、a2361ed 补齐初审缺口并更新证据）。对照初评 `artifacts/handoffs/claude-review-video-portable-workbench-2026-10-24.md` 的 B1 与 8 条次要建议逐项复核。复核未改动任何生产代码，未发起 TTS 请求，未合并、未推送。

## 结论

**B1 已消除，本轮无新增阻断项。** 初评的全部 8 条次要建议中 7 条已落实（#1 容量闸为部分落实，见下）；三套目标测试在本机（Windows 11 / Node v22.22.2，与初评同机同版本）全绿。从合并门禁角度，初评提出的"先修 B1、重跑验收矩阵再合并"条件已满足；是否合并由用户决定。

## B1 核验：全新媒体仓导入（Windows / Node v22.22.2）

**修复方式**（6ad91d0）：`scripts/video/portable-package.mjs` 新增 `normalizedAbsolute()`（`path.toNamespacedPath(path.resolve(value))`），`within()` 两侧与 `ensureDirectory()` 的目录记录统一进 namespaced 命名空间后再做 containment 比较。POSIX 下 `toNamespacedPath` 为恒等，不影响旧平台。

**本机证据**（独立工作树检出 a2361ed，Node v22.22.2）：

- 初评两条失败用例均转绿：`portable-envelope.test.mjs` 的"单文件包复用目录包校验并在新媒体仓恢复项目与 Style Bible"（restore 到全新 target 仓，即 `ensureDirectory(originalDir)` 的"目录不存在"分支）与 `route.test.ts` 的"项目包接口实际打包和恢复媒体及 Style Bible，篡改包被拒"（经 `execFile` 真实 CLI 子进程向全新临时仓导入）。
- 新增回归"Windows namespaced 绝对路径与普通路径指向同一目录时可打包并恢复"通过。
- 浏览器层证据（Codex 侧重跑，我方做完整性核验而非复跑）：e2e 现在删除原件后追加 `rmdirSync(original 目录)` 并断言目录确已不存在——正是初评指出的 VID-049 未覆盖分支。我未复跑浏览器 e2e（需 dev server 与成片渲染），但做了四项独立核验：① 生成证据的 6+4 个相关文件（两份 e2e 脚本、portable-package/envelope 及其测试、route.ts、page.tsx、local-video-projects.ts、portable-envelope-cli.mjs）与 a2361ed 逐字节一致（Codex 工作树无未提交偏差）；② 重跑 report 中两支成片的 SHA-256（`cd5dd855…a60a` / `f7d70a94…6857`）与 report、交接单一致；③ 用本机 ffprobe 8.0.1 独立探测两支成片，编码/画幅与 report 一致（见下节）；④ 证据文件时间戳 16:58–17:00 早于提交 a2361ed（17:01:39），初评第 4 条（时间戳倒挂）已消除。

## 用户指定核对项

**三套测试复跑**（本机 Node v22.22.2，详见文末表）：

| 测试 | 初评 | 本轮 |
| --- | --- | --- |
| `scripts/video/portable-package.test.mjs` | 10/11（B1） | **12/12** |
| `scripts/video/portable-envelope.test.mjs` | 1/2（B1） | **5/5** |
| `apps/web .../api/video/portable/route.test.ts` | 1/2（B1） | **3/3** |
| `scripts/video/tts-sse.test.mjs`（附带） | 21/21 | **22/22** |
| `apps/web .../local-video-projects.test.ts`（附带） | 9/9 | **9/9** |

**容量闸用例（初评建议 #1，部分落实）**：新增 3 例且全绿——导出侧媒体声明超 3/4 上限提前拒绝（对应 `portable-envelope.mjs:77` 声明闸，断言 `/浏览器单文件容量/`）、导入侧文本超 32 MiB 拒绝（`:30` 长度闸，先于解析，断言 `/32 MiB/`）、路由层 Content-Length 超 34 MiB 返回 413（`route.ts` 声明层）。初评点名的 7 个闸点现覆盖最外 3 个；内层（envelope `:61` 解码总量、`:99` 逐文件 base64 估算、`:107` 成品终闸，route 实测 body 层）仍无直接用例。外层闸已能挡住常规路径，内层属纵深冗余，降级为非阻断遗留。

**篡改 400 与控制台统计（建议 #2，已落实）**：两份 e2e 的 `captureErrors` 同时挂 `pageerror` 与 `console` type=error，字段语义与名字相符；workbench e2e 先导入篡改媒体字节的坏包，断言页面出现含 SHA-256 的错误文案、项目列表为空、媒体原件未恢复、**恰好 1 条**匹配 `/status of 400/` 的控制台错误后清零，终局 `assert.deepEqual(errors, [])`。重跑的 report `consoleErrors: []` 为新语义下的真空值。

**ffprobe 双画幅断言（建议 #3，已落实）**：`probeVideo()` 用 ffprobe 断言横版 `{h264, 1280×720}`、竖版 `{h264, 720×1280}` 并写入 report。我方独立 ffprobe 两支成片：横版 `codec_name=h264, width=1280, height=720`；竖版 `h264, 720×1280`，与 report、交接单一致。VID-049 判据与机器验证已对齐。

**其余初评建议**：#4 证据时间戳（已消除，见上）；#5 导出含历史路径——UI 文案与契约条目同步改为"原样保留 + 分享前提醒"；#6 `importPortableVideoProject` 注释已点明服务端 verify 链跑过 workingStyleIssues；#7 隐藏 input 增加专属 `.project-portable-file-input` 类，两份 e2e 改用之；#8 CLI 输出损坏时 `JSON.parse` 的 SyntaxError 已包为中文提示。

## 新发现问题（均不阻断）

1. **交接单计数口径不准**：称"portable-package、portable-envelope 和 TTS 37/37"，实测三文件合计 12+5+22=39 全绿（TTS 文件本区间未改动，初评记 21、本轮实测 22，差异或为初评口径）。方向有利（实际多于声称），建议改按文件分列数字。
2. **容量闸内层仍无直接用例**：见上，建议后续补 envelope 解码总量/成品终闸与 route 实测 body 层各 1 例。
3. **e2e 环境敏感点**（测试健壮性，非产品缺陷）：`errors.length===1` 依赖页面无任何杂散 console error（如 favicon 404），换环境可能假红；`probeVideo` 依赖 ffprobe 在 PATH（本机 winget 8.0.1 满足）；`rmdirSync` 非递归，专用测试仓当前仅 1 个原件，仓内再加媒体会误杀脚本。
4. **`void refreshProjects().catch(() => {})`**（page.tsx，9d72aef）：保住下载成功状态是对的，但现在把列表刷新失败完全静默，建议至少 `console.error` 留痕。

## 本机复跑记录（Windows 11 / Node v22.22.2，复核工作树检出 a2361ed；先 `pnpm install --frozen-lockfile` + `pnpm -r build`，`@acs/web` 的 `next build` 在本工作树失败为已知非门禁项，不影响上述测试）

`node --test scripts/video/portable-package.test.mjs` → 12/12；`node --test scripts/video/portable-envelope.test.mjs` → 5/5；`node --test scripts/video/tts-sse.test.mjs` → 22/22；`node --import tsx --test src/app/api/video/portable/route.test.ts` → 3/3；`node --import tsx --test src/app/video-studio/local-video-projects.test.ts` → 9/9。浏览器 e2e 未在本机复跑，证据核验方式见 B1 节。
