# W2 交付报告：风格代表帧确认、派生版本与内部对照（2026-10-24）

分支 `claude/video-studio-w2-w5`（基线 `origin/main@be77030`，含终审修复 `f8bc8a9`）。需求源：`artifacts/handoffs/claude-video-studio-continuation-2026-10-24.md` §W2；实施计划 `docs/superpowers/plans/2026-10-24-w2-frame-approval.md`。证据根目录：`artifacts/video-studio-w2-2026-10-24/`。

**承诺口径（Codex r1/r2 复核后收窄）**：代表帧确认是**选用的失效提醒闸门**——已启用确认的项目，任何带着失效确认的出片请求（工作台或直连 API）都会被拦下并给出原因；**不是**「确认后才能出片」的强制边界（本地开发无鉴权，调用方可删字段回到未启用语义）。工作台正常路径（先保存后出片）不受影响。

**终审修复（新上下文评审 10 项全修）**：确认帧渲染前过 validateSceneSpec 且 background 经 escapeSvg（导入项目的 XSS 面）；random 源改为 seededRandom(spec.seed) 与预览/出片同源；schema 规定 approvals 必须伴随 styleBibleRef（杜绝「确认失效却无面板可救」死局）；frames/derivedFrom 空元素给字段错误；e2e 补派生前导出的 CLI 真实重渲、digest 双不等断言、显式镜头配对；面板帧绑定生成时身份（过期画面不可确认）。修后全套：189/163/306、typecheck、Biome、e2e exit 0。

## 交付内容

- **@acs/video-scene**：SVG 序列化器上提（`serializeSvgNode`/`countSvgNodes`/`escapeSvg`，与既有 CLI 实现逐字节对拍锁定；scripts 改为消费包导出——偿还 W1 F9 挂账）。
- **@acs/video-document（加法 schema）**：`VideoProject.styleFrameApprovals?`（当前态可改写，同 transitions 口径；validate 查形状/归属/每镜头一条/横竖双帧）；`StyleBibleVersion.derivedFrom?`（版本不可变纪律内，digest 随 canonicalJson 天然更新；引用须指向本 Bible 其它版本，备注 1..200 字）。
- **工作台**：`frame-approval.ts`（帧渲染 = 注册表在 1280×720 / 720×1280 导出坐标空间直渲染镜头中段帧，确定性；`approvalStatus` 三重绑定失效判定——内容版本/风格版本/帧摘要任一变化即失效，含镜头删除与 spec 不可渲染分支）；`FrameApprovalPanel`（选镜头→生成双画幅关键帧→确认→实时徽章与失效原因）；StyleBiblePanel 派生说明（`derivedFrom` 随新版本保存）；`renderFromWorkbench` 前置闸门（有确认且失效→阻断出片并给原因；无确认不拦截）。

## 四态报告

1. **代码实现**：完成（上述文件 + 各自测试；schema 加法可选，无大改）。
2. **自动回归**：video-scene 189/189（+2 序列化对拍）、video-document 162/162（+3 schema）、web 304/304（+3 帧渲染与失效）、typecheck、Biome、`qa:validate` 103 自动 / 56 手工（VID-051——050 已被 W1 集成方占用，顺延）。
3. **真实浏览器与导出**（`scripts/video/e2e-frame-approval.mjs`，VID-051，exit 0）：样片创建→选代表镜头→生成双画幅关键帧→确认（徽章有效）→改镜头标题→徽章失效+导出被闸门阻断（无下载链接）→重确认→**真实无声双画幅渲染出 2 条下载链接**→派生新版本（备注）→确认因风格 digest 变化再次失效→再确认→保存→刷新重开徽章仍准确；导出 JSON 含确认记录（三重绑定核验）；控制台零错误。证据 `.tools/video-frame-approval-e2e/`。
4. **视觉质量**：三套内部对照见下；**人工审片：待人工**（结构化核对完成，无人耳/逐帧主观评价）。

## 三套内部对照（`artifacts/video-studio-w2-2026-10-24/`）

| 套 | 来源 | 产物 | 许可 |
| --- | --- | --- | --- |
| `text-motion/` | W1 文字配方（标题/副标题替换）+ 深蓝文字 Bible | 项目/风格 JSON、双画幅 MP4、横竖中段帧 | 仓库自有程序化 |
| `data-explain/` | W1 数据配方（三月对比）+ 深蓝数据 Bible | 同上 | 同上 |
| `portrait-subtitle/` | 留存最终 STEM 项目与其旁白资产（7 镜 624 帧双画幅，含字幕） | 项目/风格 JSON 副本、双画幅 MP4、竖版逐镜中段帧 7 张 | 仓库自有 + DashScope 旁白（既有台账内） |

对照脚本 `scripts/video/w2-comparison-sets.mjs` 可复跑。**可读性/节奏/音画配合的人工评价：待人工**——本轮仅核对了帧存在、字幕带位置（竖版低于图示）与编码。

## 关键裁决与事故

- **VID-051**：W2 e2e 原拟 050，已被 W1 集成方登记占用，顺延（validate 查重拦住，响亮非静默）。
- **留存件原地渲染事故**：对照脚本直接渲染了留存的 stem.video-project.json，render-scene 原地追加 14 条记录（savedVersion 2→6）。已 `git checkout` 还原留存件；对照集内的副本（含记录）作为该套产物保留。教训：对留存证据渲染必须先拷贝到工作目录。
- 端口 3217 被其它会话 worktree 占用（curl 200 但代码不同源），W2 改用 3218。

## 已知限制 / 待人工

1. 代表帧确认 gate 目前只在工作台出片按钮前置（客户端判定）；render API 直连（CLI/外部 POST）不经闸门——服务端强制需改 render route（Codex 上轮所有权文件），留集成决策。
2. 确认帧=镜头中段帧（frame=durationFrames/2）；转场借帧不改变该取法。
3. 三套对照的人工审片、STEM 旁白的人耳听审：待人工。
4. `next build` 在本 worktree 因安全提醒自中断，未验证生产构建（已知环境项）。

## 复跑

```text
pnpm --filter @acs/video-scene test && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check . && node scripts/qa/run-regression.mjs validate
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3218   # 升级自中断就重跑同命令
BASE_URL=http://127.0.0.1:3218 node scripts/video/e2e-frame-approval.mjs
node scripts/video/w2-comparison-sets.mjs                              # 会渲染三套对照
```
