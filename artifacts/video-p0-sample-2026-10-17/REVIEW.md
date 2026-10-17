# Video Studio P0 收口样片审片记录（2026-10-17）

**三态标注：本样片 = 样片验证**（P0 验收四要素：生成 / 保存重开 / 双尺寸出片 / 确定性，全部经真实浏览器与真实渲染管线走通；不代表产品级视觉质量）。

## 1. 输入句子（两轮端到端）

| 轮次 | 一句话需求 | 项目标题 | 组件 |
|---|---|---|---|
| 文字 | `做一个12秒的文字动画，标题是云制造发布会，副标题是Video Studio P0` | 云制造发布会 | text-animation v1 |
| 线描 | `做一个8秒的线描动画，标题是山水发布` | 山水发布 | line-drawing v1 |

两轮均：浏览器新建项目 → 规划器解析 → 确认卡应用 → 保存 v2 → 导出项目 JSON → 渲染双尺寸 → 回写 RenderRecord → 刷新重开逐字段校验通过（标题、一句话需求回填、场景源 JSON、事件 `["submitted"]`）。样片共渲染两遍（文字轮裁切修复后重渲、终审补记浏览器版本后重渲），最终 savedVersion=4、RenderRecord ×4/项目。

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
