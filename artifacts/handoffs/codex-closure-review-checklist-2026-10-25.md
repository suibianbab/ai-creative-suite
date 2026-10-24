# Codex 复核清单：claude/video-studio-closure（C1–C5 收口 + 终审轮）

- **对象**：分支 `claude/video-studio-closure`，提交范围 `5ac3375..7295ed6`（8 提交：C1×1、C2×2、C3×1、C4×1、格式化×1、C5 文档×1、终审修复×1）
- **Worktree**：`D:\codex\animate\.claude\worktrees\video-studio-closure`（单会话，请勿引入第二会话）
- **背景**：C1–C5 由会话 `6b5054b7` 执行并自带一轮新鲜上下文终审（`7295ed6`）；Claude（本会话）已独立复核 **C1 全部通过**（route 测试 9/9、web 310/310、typecheck/Biome 绿、真实 e2e exit 0 含 2.7min 真实出片实录），复核范围标注于各条。以下按严重度排序，请重点做**新构造的攻击/边界**，不要只复跑既有用例。

---

## 一、C1 服务端确认闸门（`c9d9ce9`+`cb0ce2e`；Claude 已核实现与既有测试——请攻**新绕过面**）

文件：`apps/web/src/app/api/video/render/route.ts:60-68`、`route.test.ts:139-414`、复用 `apps/web/src/app/video-studio/frame-approval.ts`

| # | 复核项 | 怎么验证 | 预期 |
| --- | --- | --- | --- |
| 1.1 | **剥离确认字段绕过** | POST 一个删掉 `styleFrameApprovals` 但内容已改的项目 | 放行（设计语义=功能未启用不拦）；确认这一定位在文档（c1-result 限制 1）与产品预期一致 |
| 1.2 | **伪造三重绑定** | 生成新 spec 渲染帧取真 sha，但把 `contentVersionId` 换成另一镜头的合法版本 → 应因帧不匹配被拒；再试「同镜头同版本但改 spec 一处颜色再重算 sha 提交」→ 应通过（说明闸门校验的是一致性而非真实性——确认这是否可接受的质量闸定位） | 前者 400 /画面/；后者 200（如认为后者过强/过弱请标注严重度） |
| 1.3 | **并发竞态** | 闸门通过后、渲染期间第二个 POST 修改确认再进 | `active` 409 先挡；确认闸门判定与渲染之间存在的时间窗语义已由 409 覆盖 |
| 1.4 | **帧摘要确定性跨环境** | 同一项目在服务端重渲染 vs 工作台确认时——字体文件版本变化（fontDigests 变）是否导致确认帧 sha 全量失效误报 | 若会：这是产品语义（确认失效要求重确认）还是缺陷，给裁决 |

## 二、C2 edit-list v2（`0257637`+`93f2c4e`；终审已修量化漂移——请攻**恶意文档面**）

文件：`scripts/video/export-edit-list.mjs`（v2 结构：transitions 合成窗口 :125-151、renderSources :183-201、quantizeTimeline :59-62）、`export-edit-list.test.mjs`

| # | 复核项 | 怎么验证 | 预期 |
| --- | --- | --- | --- |
| 2.1 | **恶意 v2 文档拒绝面** | 构造：transitions 数组 10 万条、renderSources.file 含 `..\` 穿越与绝对路径、timeline 断裂、fps=0/负数/小数 | 全部明确拒绝且错误可读；特别确认 renderSources 路径在**消费侧**（人工导入脚本/未来编辑器适配）不会盲信 |
| 2.2 | **量化口径与渲染器逐帧对账** | 用 `[3010,4000,...]` 这类非整帧时长再构造一例，把清单 startFrame 与 `render-manifest.json` frameMap 逐镜 diff | 必须逐镜相等（终审修复的回归面：改回逐镜独立量化会从第 2 镜起漂移） |
| 2.3 | **切片方案实测修正** | 按清单 sliceSpans 对已入库 STEM 源重切 3 镜 | `-frames:v` 计数与 ffprobe 帧数一致；`-t` 的多包帧缺陷在测试中锁定（终审提到实测修正——请确认测试真的断言了差值） |
| 2.4 | **v1 旧清单可读 + 原子写** | 用 W5 期的 v1 文件过校验器；失败路径查无 `.tmp` 残留 | v1 通过；原子写如文档所述 |

## 三、C3 交互页触屏/可访问性/性能（`9284875`）

文件：`scripts/video/w4-interactive/app.js`（单指 pointerId 追踪、touchCancel、双击/双触统一 pointerdown :101、键盘 :163、aria-live :27）、`e2e-w4-touch-a11y.mjs`、`w4-interactive-build.mjs`

| # | 复核项 | 怎么验证 | 预期 |
| --- | --- | --- | --- |
| 3.1 | **双击/双触边界** | 快速三连击（第三击不应再切换）、慢双击（超时窗口外的两击不触发）、双触两指不同时落地 | 各自行为符合注释声明；纪元配对（防误配对相邻手势）逻辑读码+实测 |
| 3.2 | **键盘/读屏完整性** | 仅键盘走完：Tab 聚焦→方向键转动→回车拆解；aria-live 播报状态文本变化 | 全程无需鼠标；播报文本与 data-exploded 同步 |
| 3.3 | **约束未破** | 重建后体积 ≤8MiB、`file://` 离线开、iframe 嵌入仍可交互 | C3 改动未引入联网资源（grep 页面无 http/https 外链） |
| 3.4 | **双渲染器性能口径** | `e2e-w4-touch-a11y.mjs` 输出的无头 SwiftShader vs 有头 GPU 帧率数字 | 口径如实标注真机未测；无头阈值不应因机器负载偶发假红（是否需放宽重试） |

## 四、C4 Blender 对照（`bdbc144`）

文件：`scripts/video/c4-blender-dual.mjs`（625 行）、证据 `artifacts/`（C4 目录 compare 帧/motion mp4/成本记录）

| # | 复核项 | 怎么验证 | 预期 |
| --- | --- | --- | --- |
| 4.1 | **同机位移植公平性** | 读 c4 脚本相机/灯光参数 vs three harness 参数 | 参数级对齐声明属实（否则对照结论无效） |
| 4.2 | **设备归因异常** | 有空窗时复跑 `--phase motion` 采 nvidia-smi | GPU 占用仍 12-13% 则维持"CPU 侧速率入账"的如实口径；解决了则更新成本记录 |
| 4.3 | **许可入账** | Blender 便携版来源、下载渠道、版本哈希 | 与 c4-result 声明一致，无来源不明二进制 |

## 五、流程与交付面

| # | 复核项 | 说明 |
| --- | --- | --- |
| 5.1 | **交叉编辑残留** | 双会话碰撞仅发生在 route.test.ts（Claude 已核：对方强化版胜出、Claude 的 503 探针测试存活、无孤儿代码）。抽查 `git show cb0ce2e` 确认格式化未混入语义改动 |
| 5.2 | **VID 注册** | 本轮未新增 VID（105 自动/56 手工与 W2-W5 收口时一致）——C2/C3/C4 的新链路是否有该登记的用例（如无：登记属集成轮，请确认挂账而非遗漏） |
| 5.3 | **C5 三候选包** | P-A（竖版 3D 视锥 3.16× 拉伸——产品缺陷候选）/P-B（转场可视化）/P-C（交互页产品化）方案的限制声明是否成立；P-A 的存量视觉回归风险表述是否充分 |

## 结论口径

每项给四态（代码实现/自动回归/真实操作/视觉质量）+ 文件行号 + 复现步骤 + 实际影响 + 严重度（Critical/Important/Minor）。阻断项修复后只复核受影响增量；非阻断挂账。结果写 `artifacts/handoffs/codex-closure-review-2026-10-25.md`（或告知路径由本会话转交）。

## 复跑入口（本 worktree）

```text
pnpm --filter @acs/video-scene test && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check . && node scripts/qa/run-regression.mjs validate
node --test scripts/video/export-edit-list.test.mjs                      # C2 10/10
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3221   # 升级提醒自中断就重跑同命令
BASE_URL=http://127.0.0.1:3221 node scripts/video/e2e-frame-approval.mjs
node scripts/video/e2e-w4-interactive.mjs && node scripts/video/e2e-w4-touch-a11y.mjs
node scripts/video/c4-blender-dual.mjs --smoke
```

环境注意：①dev server 升级提醒会自中断一次，重跑同命令即续；②`:3210/:3217/:3218/:3220` 可能被其它会话 worktree 占用，curl 200 不代表代码同源——用本 worktree 专属端口；③对 `artifacts/` 留存证据渲染必须先拷贝到 `.tools`（曾发生原地回写事故）。
