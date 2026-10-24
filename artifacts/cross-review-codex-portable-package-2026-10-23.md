# Claude 交叉审核：codex/video-portable-package（可移植项目包）

- **审核对象**：分支 `codex/video-portable-package`，增量 `d5470be..22010d1`，worktree `C:\Users\惠普\.codex\worktrees\video-portable-package\animate`
- **审核方式**：Claude 人工逐行精读核心文件 + 独立代码审读（双重复核）+ 关键发现亲手复现；单测在贵 worktree 独立复跑 7/7 ✓
- **对照**：交接单五项复核清单逐项给结论，发现按严重度排列

## 五项清单结论

1. **manifest 路径/符号链接/未列出文件**：✅ 实现扎实——`safeEntry` 路径白名单与 `STORE_KEY_PATTERN` 精确镜像（扩展名无错配）；根/媒体目录用 readdir **精确集合比对**拒未列出内容（含藏在合法目录下的替换）；`plainDirectory`/`regularFile` 用 lstat 拒符号链接；无媒体/无风格旧项目通过（单测覆盖）。缺口见 C5（最高风险的两道防御无测试锁定）。
2. **全量 SHA-256**：✅ 无一处用 16 位前缀或大小代替完整哈希——打包前对账、复制后复核、恢复前预检、同键复用仅凭全摘要相同、`link` EEXIST 后重验全哈希。清单要求完全满足。
3. **失败原子性**：⚠️ 常规失败路径干净（临时包+rename、先全量预检后安装、created 逆序清理），但**契约要求的并发/崩溃限制未在 REPORT 声明**，且存在一个已复现的自伤+粘滞 bug（C1）与清理盲区（C3）。
4. **Style Bible 同口径**：✅ `readBible` 调用的正是渲染链同款三件套（`validateStyleBible`+`resolveStyleBibleRef`+`workingStyleIssues`），媒体工作镜头打包时明确拒绝、历史媒体版本随账本走，两臂 e2e 验证了口径。改进项见 C7（编排逻辑第三份拷贝）。
5. **边界诚实**：✅ REPORT 界限节如实区分 CLI/浏览器/云端、历史路径/proxy/TTS/editor-binding。补漏见 C3。

另：styled 组横竖 SHA-256（`40c38a7c…/7c96fd71…`）与 composition-templates 留样逐字节相同——跨仓恢复后重渲与既有基线一致，渲染确定性获得额外实证，这是本轮验收的亮点。

## 发现清单（均已核实，C1 为亲手复现）

### C1（Important·必修）restore 的 out/store 包含关系自伤 + 粘滞目录

- 位置：`scripts/video/portable-package.mjs:347-370`（只查 `within(bundle, out/store)`，不查 store 与 out 的互相包含）、`:369`（`mkdir(originalDir, {recursive})` 先于最终 `exists(out)` 守卫创建目录树）、`:420-423`（清理只 `unlink` created 文件，不回收本次 mkdir 的目录）。
- 复现（`.tools/xrev/` 留有现场）：`restore --bundle B --out X --store X/store`，X 原本不存在 → mkdir 创建 `X/store/original` → 终检 `exists(out)` 判"恢复输出目录已存在"失败退出 1 → **`X/store/` 树残留**，此后对同 out 的任何 restore（即使改对 --store）持续失败，需手工删除。
- 方向：①预检扩展为 out 与 storeRoot 互不包含（双向）；②失败清理记录并移除本次 `mkdir` 新建的目录（或把 store 安装也走临时目录+rename）；③顺带修 pack 的同类小项：`mkdir(path.dirname(out), {recursive})` 在后续失败时留下空父目录。

### C2（Important·必修）manifest 1002 文件上限未声明且误伤合法项目

- 位置：`portable-package.mjs:276`（`files.length > 1002` 拒绝，仅 verify 侧）；pack 末尾 `verifyPortableBundle(temp)`（`:249`）使 **>1000 媒体资产的合法项目 pack 必失败**，报错还是误导性的"manifest 格式无效或版本不支持"。`mediaAssets` 账本 schema 无上限，该 cap 未出现在交接单契约与 REPORT。
- 方向：上限写进契约并给专门报错（"素材超过包格式 v1 上限"），或提高到与媒体仓边界一致的值；pack 在读项目阶段就按账本长度前置拒绝，别让用户复制完 1000 个文件才失败。

### C3（Important·按契约补文档）并发/崩溃限制未在 REPORT 界限声明

- 交接单第 3 条明确要求"若发现并发与系统崩溃下的限制，请明确写为限制，不把测试外推成强事务承诺"。REPORT 界限节现无此内容。实际存在的窗口：
  - 崩溃中途：`.acs-video-pack-*/.acs-video-restore-*` 临时目录与目标仓 `original/` 下的 `.tmp` 部分文件会残留（无清理）；
  - `exists(out)` 终检与 `rename` 之间：POSIX rename(2) 会静默替换并发创建的空目录；
  - 回滚 `unlink` 失败会中断剩余清理并吞掉原始错误（`:422`）。
- 方向：REPORT 界限节如实补三条；代码侧可选加固（清理容错、rename 前 flock 类独占），不强制。

### C4（应修）project/style 文件复制后无复核，与媒体不对称

- 位置：`portable-package.mjs:405-410`——媒体复制后逐文件重哈希（`:384-387`），而 `project.video-project.json` 与 `style-bible.json` 直接 `copyFile` 进 tempOut 后 rename 发布，无任何复核。
- 影响：verify 与 copy 之间包被改写（受信本地环境下的窄窗口），篡改字节可无校验直达 out——恰好绕开了代码为媒体特意设的同型 TOCTOU 防御。
- 方向：复制后对两文件重跑 `fileEntry` 比对 manifest 条目（三行改动）。

### C5（应修）两道最高风险防御无测试锁定

- `portable-package.test.mjs` 7 条覆盖了哈希不符与 `../` 路径，但**未列出文件拒绝**（readdir 精确集合比对，`:311-337`）与**符号链接拒绝**（lstat isSymbolicLink 分支）无测试。未来重构把 lstat 换 stat、或删掉集合比对，7 条全绿而 verify/restore 静默接受多余文件/外指符号链接——这正是交接单让我重点查的第 1 项。
- 方向：补两条反例（包内加未列出文件；`media/original/<key>` 换成指向包外的符号链接），断言 verify 非零退出。

### C6（协调项·集成时必须处理）VID-043 撞号

- 本分支注册 `VID-043`（portable e2e）；`claude/video-template-experience` 已用 `VID-043/044`（双题材样片）。`run-regression.mjs:60` 查重复 ID——**双线合并后 `qa:validate` 会整体红**（响亮拦截、非静默，已实测确认校验逻辑）。
- 方向：集成时一方改号（建议本分支顺延为 VID-045，因我方两条已入 REPORT/交接单互引）；§4.5 集成顺序里把"改号后 validate 绿"列为合入前置检查。

### C7（Minor·挂账）readBible 第三份样式闸门编排

- `portable-package.mjs:135-153` 重新编排 `validateStyleBible+resolveStyleBibleRef+workingStyleIssues`，与 `apps/web` 渲染路由、`scripts/video/style-bible-file.mjs` 的 `verifyProjectStyleBible` 并存为第三份。语义今天一致；未来收紧 `workingStyleIssues`（如当年 nodeTextColor 豁免那类改动）漏改这份即出现 pack-成功-渲染-失败（或反之）。
- 方向：改为 import `style-bible-file.mjs` 的现成助手（与 C4 同批做最顺）；挂账亦可，但请在交接单标注这份拷贝的存在。

## 总评

契约设计（临时目录+rename、全哈希对账、内容物精确比对、两臂出片验收）与实现高度一致，边界声明诚实，单测/e2e/typecheck/biome 声明全部独立复现为绿。**C1/C2 修掉、C3 按自家契约补声明后**，本线可进入集成流程；C4/C5 建议同批；C6 集成时处理；C7 挂账。修后按 §4.4 只复核受影响增量即可，无需全量重审。
