# Video Studio P0 收口样片审片记录（2026-10-17）

**三态标注：本样片 = 样片验证**（P0 验收四要素：生成 / 保存重开 / 双尺寸出片 / 确定性，全部经真实浏览器与真实渲染管线走通；不代表产品级视觉质量）。

## 1. 输入句子（两轮端到端）

| 轮次 | 一句话需求 | 项目标题 | 组件 |
|---|---|---|---|
| 文字 | `做一个12秒的文字动画，标题是云制造发布会，副标题是Video Studio P0` | 云制造发布会 | text-animation v1 |
| 线描 | `做一个8秒的线描动画，标题是山水发布` | 山水发布 | line-drawing v1 |

两轮均：浏览器新建项目 → 规划器解析 → 确认卡应用 → 保存 v2 → 导出项目 JSON → 渲染双尺寸 → 回写 RenderRecord → 刷新重开逐字段校验通过（标题、一句话需求回填、场景源 JSON、事件 `["submitted"]`）。样片共渲染两遍（文字轮裁切修复后重渲、终审补记浏览器版本后重渲），最终 savedVersion=4、RenderRecord ×4/项目。

**措辞更正（2026-10-17 整改）**：本轮记录时的「导出项目 JSON / 回写 / 重开」系开发辅助手段（DevTools 取存储侧文档、文件系统回写），当时工作台尚无原生导出/导入功能——原表述把它写成了用户可走的闭环，不属实。整改后工作台已有原生「导出项目 JSON / 导入项目 JSON」，浏览器→CLI→浏览器闭环由脚本化 E2E 走通并回归（VID-006、`artifacts/video-studio-e2e/E2E_CLOSED_LOOP.md`）；本文档的存储侧数据与渲染结论不受影响（校验的是同一份文档结构）。

## 2. SceneSpec（存储侧 sceneSource.type = "spec"）

文字轮（seed=FNV-1a(句子)）：

```json
{
  "specVersion": 1, "componentId": "text-animation", "componentVersion": 1,
  "durationMs": 12000, "seed": 3923019344, "background": "#ffffff",
  "params": { "title": "云制造发布会", "subtitle": "Video Studio P0",
              "titleColor": "#1b2c29", "subtitleColor": "#5d7469",
              "entrance": "fade-up", "enterMs": 900 }
}
```

线描轮：

```json
{
  "specVersion": 1, "componentId": "line-drawing", "componentVersion": 1,
  "durationMs": 8000, "seed": 3166478433, "background": "#ffffff",
  "params": { "paths": ["M300,200 L300,800 M700,200 L700,800 M300,500 L700,500"],
              "strokeColor": "#1b2c29", "strokeWidth": 4, "revealMs": 4000 }
}
```

## 3. 引擎 / 组件 / 字体版本与摘要

- Remotion **4.0.534**（本地 Chrome Headless 渲染），Node **v22.22.2**
- 无头浏览器 **Google Chrome 155.0.8059.41**（ADR §2.5 确定性输入，已记入 manifest 与 RenderRecord.browser；Windows 经文件版本资源探测，不启动进程）
- 组件注册表 registryVersion **1**；text-animation / line-drawing 均 **v1**
- 字体：NotoSansSC-Regular.woff（本地打包，无网络）
  digest `1c1e8136d03758ce881ca9004151a624082cf33cf1775da54411704747aaaf7a`
- 文字轮 specDigest `aac226e1e6009596584023b179fe1911a7f44818b43f4cf1c8db1febb124b9f5`（横竖同 spec 同摘要）

## 4. 导出参数

| 画幅 | 分辨率 | fps | 帧数 | 时长 | 输出 |
|---|---|---|---|---|---|
| landscape | 1280×720 | 24 | 288 | 12s / 8s | render-text/landscape.mp4、render-line/landscape.mp4 |
| portrait | 720×1280 | 24 | 288 | 12s / 8s | render-text/portrait.mp4、render-line/portrait.mp4 |

ffprobe 校验通过（分辨率/帧数/时长）；RenderRecord ×2 已回写项目 JSON。

## 5. 确定性校验（`pnpm qa:video-determinism`，exit 0，72/72 帧双渲染逐帧一致）

比较语义（2026-10-17 P1-D 整改后）：逐帧比较的是**解码后的像素**（`frame-compare` 的 `decodeFrameHash`，ffmpeg 解码 RGBA 后哈希），不是 PNG 容器字节——容器元数据不同、像素相同应判一致（ADR 0003 §2.5）。回归用例 `scripts/video/frame-compare.test.mjs`（VID-005）证明同像素不同元数据判等、异像素判异。

覆盖范围如实标注：本校验为单夹具（3 秒文字动画）单画幅 PNG 序列的抽查；双画幅 MP4 的尺寸/帧数/时长由出片管线核对（render-manifest + VID-003 ffprobe 步骤）另行覆盖，不属本校验范围。

manifest 原文（终审修复后含 browser 字段）：

```json
{"specDigest":"811c8858baa0b49b7384c2e0f617795f3c56e0c62ead39a9e245e0470ced931b","registryVersion":1,"componentId":"text-animation","componentVersion":1,"remotion":"4.0.534","node":"v22.22.2","browser":"Google Chrome 155.0.8059.41","fontDigests":{"NotoSansSC-Regular.woff":"1c1e8136d03758ce881ca9004151a624082cf33cf1775da54411704747aaaf7a"},"fps":24,"frames":72}
```

说明：确定性夹具为 3 字标题（钳制不触发），故该缺陷修复前后 manifest 摘要不变；钳制行为由组件单测覆盖（26/26）。

## 6. 失败点与修复（本轮唯一）

**竖版文字标题双侧裁切**（人工审片发现）：text-animation 字号仅按 `height/8` 推导，720×1280 竖版下 6 字标题 160px×6=960px > 720px 画布宽，左右双侧裁切；副标题 91.4px×~9em≈754px 同样溢出。
**修复**（TDD，先 RED 后 GREEN，26/26 通过）：按文本 em 宽度钳制字号到画布宽的 88%（CJK 计 1em、拉丁计 0.6em）；横版钳制界 187.7px > 90px，字号不变、渲染像素级一致。修复后重跑：单测绿 → 确定性 exit 0 → 全新端到端 → 重渲染 → 重抽帧复审。

## 7. 人工审片结论（横竖版分别）

方法：从成品 MP4 各抽 1 帧中间画面（文字轮 t=1.5s 帧 36；线描轮 t=1.0s 帧 24），视觉模型读图 + 像素级实测（非白墨迹列分布）双重验证。像素实测为准（视觉模型对竖版帧两次读图结论自相矛盾，其中一次受提示词诱导误报裁切；实测墨迹分布裁决）。

| 样片 | 画幅 | 结论 | 依据 |
|---|---|---|---|
| 文字 云制造发布会 | 1280×720 横版 | ✅ 通过 | 6 字全可见，墨迹 x∈[375,905] 中心 640=width/2 精确居中，副标题 "Video Studio P0" 完整，白底深色字，无 tofu 无裁切 |
| 文字 云制造发布会 | 720×1280 竖版 | ✅ 通过（修复后） | 修复前双侧裁切（见 §6）；修复后墨迹 x∈[49,672] 左留白 49px/右 47px，副标题 x∈[108,613]，均零边缘接触、中心 360.5≈width/2 |
| 线描 山水发布 | 1280×720 横版 | ✅ 通过 | H 形双竖线+横线完整可见，4s reveal 至 1s 时笔画大部分已画出，线条未被裁切 |
| 线描 山水发布 | 720×1280 竖版 | ✅ 通过 | H 形完整、垂直居中、上下留白（信箱式） |

**竖版行为如实标注（ADR 验收允许，但按组件分述实际行为）：**

- 线描 / 基础图形：设计空间（1000×1000）经 viewBox `xMidYMid meet` **等比居中缩放**进竖版画布——真·居中缩放，非重排版（本样片线描竖版即此表现：图形整体缩小居中，上下留白）。
- 文字：**原生竖版排版**（字号重新按竖版画布推导 + 本轮新增的行宽钳制），非横版机械缩放——标题/副标题在竖版画布内按各自钳制字号居中排布。

## 8. 工件清单

- `project-text.json` / `project-line.json` — 存储侧项目文档（含 renderRecords、savedVersion=3）
- `render-text/` / `render-line/` — landscape.mp4、portrait.mp4、render-manifest.json
- `frames/` — 4 张审片抽帧 PNG（文字 t=1.5s、线描 t=1.0s，横竖各一）

## 9. 代码评审整改记录（2026-10-17，P0 收口后复审）

四象限标注：**[实现]** 代码落地 · **[回归]** 自动化测试 · **[链路]** 真实工作台/渲染管线走通 · **[视觉]** 视觉质量结论。凡媒体未入库的视觉结论一律标注「本机复核，不可在推送分支独立复核」。

| 发现 | 修复（提交） | [实现] | [回归] | [链路] | [视觉] |
|---|---|---|---|---|---|
| P1-A 闭环非真实工作台链路（导出/导入缺失） | `e1965c5` + `9460e16` | 工作台原生导出/导入项目 JSON；`importVideoProject` 新项目入库 / CLI 快进接受 / 落后·分叉·篡改拒绝 | store 19 项（导入五分支）；web 套件 23/21 项；`project-io` 4 项 | 脚本化 E2E 浏览器→CLI→浏览器（VID-006）：同项目 ID 贯穿、v2→v3、渲染记录可见、控制台零错误；可复跑 | 不适用（链路验收） |
| P1-B 不可变文档版本缺失 | `f1b34f4` | IndexedDB 快照库（每版本可读回）+ 只追加演进校验（`evolve.ts`） | `evolve.test` 10 项 + store 快照/篡改/迁移 3 项 | E2E 中快进导入保留本地 v2 快照（VID-006 passCriteria） | 不适用 |
| P1-C 并发保存可静默覆盖 | `8bf1806` | 单 readwrite 事务内 get→比较→put；冲突抛 `VideoProjectConflictError` | 双标签并发恰一成功；串行+幂等重放 | 由存储契约保证（浏览器两标签页共享同一事务序列化） | 不适用 |
| P1-D 确定性比较口径错误（容器字节） | `d15c07e` | `frame-compare` 解码像素哈希；verify-determinism 换用并如实声明覆盖范围 | `frame-compare.test` 3 项（VID-005） | 复跑 exit 0，72/72 帧解码像素一致 | 像素级一致≠视觉质量；视觉结论见 §7（本机复核） |
| P1-E 确认卡未预告画面内容 | `4658c56` | 规划确认卡 `renderHint`：模板抽取结果与「标题不进画面/进画面」分组件说破 | planner 单测断言措辞；E2E 断言点名标题 | E2E 校验 renderHint 含「标题「闭环验收」」 | 预览即渲染组件本身，所见即所出 |
| P2-A 禁网络/墙钟无门禁、资源上限不全 | `a8fd9cf` | 静态扫描门禁（§2.3 违禁 API）+ 渲染输出节点预算（§2.4 出站上限） | `determinism-gate.test`（含扫描器自检）+ `svg-budget.test`（VID-007，video-scene 33 项） | 两座渲染桥每帧执行预算检查 | 不适用（门禁） |
| P2-B 确认应用未区分首镜头/另存 | `822c5cb` | `applyPlan` 双模式：空项目落当前文档，已有镜头另存新项目并明示 | `apply-plan.test` 4 项 | E2E 首镜头路径走通 | 不适用 |
| P2-C 跨镜头 shotId/versionId/order 可重复 | `49227f0` | 项目层校验三重唯一性 | `validate.test` 4 项（跨镜头重复拒） | 经 save/import 入口强制（store 保存前校验） | 不适用 |
| P3 SvgTree 双份漂移 | `db3aded` | `reactSvgAttrs` 归一 `@acs/video-scene`，两桥共用；remotion 侧同步消除 React 属性警告 | `react-svg-attrs.test` 2 项（video-scene 套件内） | E2E 复跑零控制台错误；重构前后 MP4/截图 SHA-256 逐字节一致；确定性 72/72 复验 | 渲染输出不变（哈希一致） |

**P2-A 逐帧渲染超时延期声明**（按整改要求：明确可信组件边界 + 当前可执行门禁 + 后续补齐点）：

- 边界：渲染只执行内置注册组件（`defaultRegistry` v1，三组件），`scene_spec` 是声明式数据，无用户/LLM 代码执行路径；违禁 API 由静态门禁拦截。
- 当前门禁：spec 256 KiB 上限 + 组件 params 条目上限（shapes≤24 / paths≤8）+ 渲染输出 ≤2000 节点 + 确定性双渲染回归（VID-002）。
- 补齐点：逐帧墙钟超时需要在渲染 CLI 中以 worker 线程隔离执行组件渲染（超时杀 worker），列入 Video Studio P1 待办；届时 `SceneResourceError` 体系复用。

**媒体证据可复核性**：`render-text/`、`render-line/`、`frames/` 的 MP4/PNG 按 gitignore 约定仅存本机，未随分支分发——§7 视觉质量结论与 §6 修复效果属**本机复核**，不可在推送分支独立复核；分支内可独立复核的是脚本、JSON 文档与哈希清单（E2E 闭环另见 `artifacts/video-studio-e2e/E2E_CLOSED_LOOP.md` 的 SHA-256 表）。
