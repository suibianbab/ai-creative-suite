# Video Studio 首版可用范围（2026-10-26）

基于 `main@655cbdf` 的真实 UI 与能力。所有断言以本次干净环境验收为准，不以历史样片为证据。

## 可完成的项目类型

| 类型 | 入口 | 支持组件 | 验证状态 |
|---|---|---|---|
| STEM 科普解说 | 样片库「水循环 · STEM 解说」 | text-animation, explainer-composition (cycle/drawing/flow), sketch-note, flow-diagram | ✅ VID-037/051 通过 |
| 数据解说 | 样片库「季度销量 · 数据动画」「季度业务数据简报」 | bar-chart, line-chart, number-counter, compare-split, timeline-milestones | ✅ 本次验收重渲通过 |
| 家装改造 | 样片库「两房变三房 · 家装方案」 | text, compare-split, explainer-composition, timeline-milestones, sketch-note | ✅ VID-063 通过 |
| 设备操作 | 样片库「换滤芯四步」 | text, explainer-composition, sketch-note, number-counter | ✅ 样片链路通过 |
| 商品展示 | 样片库「FORM 01 帽子」 | text + media-clip | ✅ 媒体混编链路通过 |
| 3D 镜头 | 组件模板下拉「3D 场景」 | orbit3d@1（@2 竖版取景） | ✅ T1/VID-056 通过 |

## 编辑操作

| 操作 | 支持 | 验证 |
|---|---|---|
| 修改标题/副标题 | ✅ 全组件 | 浏览器链 |
| 修改数值/分类 | ✅ bar-chart, number-counter, compare-split | 浏览器链 |
| 修改标注/说明 | ✅ compare-split, timeline-milestones, explainer-composition | 浏览器链 |
| 修改差值方向 | ✅ compare-split（改善/恶化） | 浏览器链 |
| 修改节点状态 | ✅ timeline-milestones（done/active/pending） | 浏览器链 |
| 入场时长 | ✅ compare-split@2, timeline-milestones@2（200–5000ms） | 单测 + 浏览器 |
| 入场时序 | ✅ @2 sequence（stagger/sync） | 单测 |
| 转场 | ✅ fade（时长 100–2000ms，借帧摘要） | VID-057 |
| 镜头配方 | ✅ 按用途选镜头（文字/数据/对比/时间轴/商品） | VID-049/050 |
| 背景色 | ✅ 全组件 | 浏览器链 |
| 旁白文本 | ✅ 全镜头 | 浏览器链 |

## 输入素材条件

| 类型 | 支持 |
|---|---|
| 程序化参数 | 全部组件（工作台直接编辑） |
| 内嵌图片 | PNG/JPEG/WebP ≤120 KiB（→ data URL ≤180 KiB） |
| 本地视频 | MP4/WebM/MOV（媒体镜头，导入后内容寻址） |
| 3D 场景 | orbit3d 程序化几何（不支持外部模型） |
| 3D 交互页 | 从项目 three 镜头导出自包含 HTML ≤8 MiB |

## 双画幅导出

| 格式 | 横版 | 竖版 | 验证 |
|---|---|---|---|
| H.264 MP4（无声） | 1280×720 24fps | 720×1280 24fps | ✅ 本次验收 |
| H.264+AAC MP4（有声） | 需 DASHSCOPE_API_KEY | 同左 | ✅ VID-047（需密钥） |
| GIF | 横版 | — | CLI 导出 |
| 单镜 SVG | 横版 | — | CLI 导出 |
| 交互页 HTML | 自包含 ≤8 MiB | 离线 file:// 可开 | ✅ VID-058 |
| 可移植项目包 | 含媒体原件 | — | ✅ 既有链路 |

## 不支持项（首版明确排除）

- 任意脚本场景/自由拖拽画布/通用关键帧引擎
- 外部 3D 模型导入（Blender .blend / GLB）
- 真实商品模型还原（Three 程序化几何 ≠ 写实产品广告）
- 3D 镜头工作台动态预览（当前仅代表帧）
- 多人协作/云端渲染队列
- PDF/大纲导出
- 剪映/Premiere 等外部编辑器直连

## 最短操作路径（创建到导出）

1. 打开工作台 → 样片库选卡 → 「使用此样片」
2. 点击镜头卡编辑按钮 → 改内容/动画 → 「应用修订」
3. （可选）转场区加 fade
4. 预览区切「横版/竖版」确认
5. 「保存」→ 刷新验证
6. 「生成无声横竖版 MP4」→ 下载两条链接

## 剩余问题优先级

1. **P1**：3D 镜头工作台内动态预览（当前仅代表帧）
2. **P2**：自然语言生成结构化分镜方案
3. **P2**：timeline-milestones 的 enterMs 在 @2 中的 UI 提示（自动压缩时用户无感知）
4. **P3**：compare-split 差值徽章文字自动计算（当前手动输入）
5. **P3**：多项目搜索/标签
