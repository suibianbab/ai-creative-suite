# Video Studio P1 导出扩充设计：整片 GIF + 单场景 SVG（D4）

- 日期：2026-10-18
- 对齐：`docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md` P1 行「导出扩充 GIF、单场景 SVG 文件」；决策点 **D4**（GIF 导出工具链，选 ffmpeg palettegen/paletteuse）。
- 前置：P0 出片闭环（`scripts/video/render-scene.mjs`，RenderRecord 回写）与 P1 分镜编辑器（`da5ff3b..f78d189`）已落地。

## 背景与目标

对标 SVGAnimate 的「导出 SVG/GIF/MP4/HTML」。本仓库 MP4 出片已有；本刀补两条导出路径：

1. **整片 GIF**：从已渲染的 MP4 派生 GIF（ffmpeg palette 两遍法），供嵌入消息/文档等无视频控件的场合。
2. **单场景 SVG 文件**：把一个镜头的声明式场景导出为可独立打开的 `.svg` 文件——动画模式（CSS keyframes 翻页册）或静态单帧（海报）。

两条路径都走 **CLI**（与 P0/P1「导出项目 JSON → CLI 出片」管线一致；浏览器无法承载 ffmpeg），并把导出结果作为 **DeliveryRecord** 追加进项目文档（`deliveries` 字段自 ADR 0003 起存在、校验齐备，但至今无人写入——本刀首次落档）。

## 架构事实（为什么这么做可行）

- 场景组件输出**纯数据 SVG 树**（`SvgNode`，`@acs/video-scene` 不依赖 React/DOM）：`component.render(spec, {frame, fps, durationFrames, width, height, random: seededRandom(seed)})`。预览（web）与出片（Remotion）各自桥接同一棵树——SVG 序列化是第三个消费者，零新渲染逻辑。
- ffmpeg 已在仓库工具链中（`scripts/video/frame-compare.mjs` 以 `spawnSync("ffmpeg", …)` 解码帧），PATH 可用。
- 脚本层加载 workspace 包走 `pathToFileURL(packages/*/dist/index.js)` 动态导入（`spec-frame-renderer.mjs` 既有模式），纯函数可被 `node --test` 直测。
- 渲染参数：24fps；landscape 1280×720 / portrait 720×1280；每帧节点预算 `MAX_RENDER_NODES = 2000`。

## R 需求

### R1 整片 GIF 导出（`scripts/video/export-gif.mjs`）

- 用法：`node scripts/video/export-gif.mjs --project <path.json> --aspect landscape|portrait [--out <dir>] [--fps 12] [--colors 128] [--width 480]`
- 源选择：从项目 `renderRecords` 尾部向前取**同 `outputAssetRef` 的连续块**（该画幅最近一次整片渲染的逐镜头记录，数组序即镜头序）：
  - 无该画幅记录 → 报错指路先跑 `render-scene`；
  - 块长度 ≠ `shots.length` → 报错（渲染后镜头数变了，需重渲染）；
  - 块内 `versionId` 必须仍是项目已知版本（回滚/修订不删历史，天然满足）。
- 转码（D4）：ffmpeg 单遍 filter_complex
  `fps=<gifFps>,scale=<width>:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=<colors>[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`，`-loop 0`。
- `gifFps` 必须整除渲染 fps（24 % fps === 0，合法值 1/2/3/4/6/8/12/24），否则报错并列出合法值——保证 `frameMap` 是精确整数。
- ffprobe 校验产物：codec=gif、宽度=请求宽、时长与 `总帧/24` 偏差 ≤ 0.1s，不符即失败不回写。
- 回写：追加 `DeliveryRecord {versionIds: 块内逐镜头 versionId, renderIds: 块内逐镜头 renderId, frameMap: 逐镜头 span.frames × fps ÷ 24}`，`savedVersion + 1`，重校验后落盘。
- 同一 MP4 + 同一 ffmpeg 版本 + 同参数 → 逐字节一致（palettegen 全流扫描 + bayer 抖动均确定性；e2e 双跑哈希验证一次，不立常设 fitness function——GIF 是派生交付物，其源 MP4 的确定性已有 `verify-determinism` 门禁）。

### R2 单场景 SVG 导出（`scripts/video/export-shot-svg.mjs` + `scripts/video/svg-serialize.mjs`）

- 用法：`node scripts/video/export-shot-svg.mjs --project <path.json> --shot <1 基序号> [--fps 12 | --frame <0 基帧号>] [--out <dir>]`（默认动画模式 `--fps 12`；`--frame` 出静态单帧海报）。
- 镜头取 working 版本；`sceneSource.type !== "spec"` → 报错（该镜头无声明式场景源）。
- **翻页册（flipbook）动画**：按 `24 ÷ svgFps` 步长采样帧（同样要求整除，缺省 12fps → 每 2 帧取 1），每帧调 `component.render`（逐帧 `assertNodeBudget`），全部帧的树各自包 `<g class="kf kf-<i>">` 叠进一个 `<svg>`；`<style>` 内生成每帧一段 `@keyframes`，在其时间切片内 `opacity: 1`、其余 `0`，动画 `infinite` 循环。画布 1280×720 / 720×1280 与出片一致，`background` 作底层 `<rect>`。
- 序列化为纯字符串函数（XML 转义 text 与 attr：`& < > " '`），确定性：同 spec+seed → 逐字节同串（单测钉死）。
- **导出级节点预算**：Σ(各采样帧节点数) ≤ `MAX_SVG_EXPORT_NODES = 50000`（约 12fps × 10s × 平均 400 节点的余量），超限报错建议降 fps——防失控文件。
- 回写：追加 `DeliveryRecord {versionIds: [该镜头 working versionId], renderIds: []（不派生自任何 MP4 渲染）, frameMap: [采样帧数]}`，`savedVersion + 1`。
- 诚实边界（非目标）：**不嵌入字体**。SVG 以 `font-family: "NotoSansSC", sans-serif` 引用，观者机器无该字体时文字以系统字体回退渲染，与 MP4 存在版式漂移；嵌入 CJK 字体体积（约 10MB 级）不成比例，P1 不做。

### R3 工作台提示（`apps/web/page.tsx`）

- 「导出项目 JSON」成功提示在既有 CLI 出片文案后追加一行：GIF 与单镜头 SVG 的命令样例。纯文案，无新 UI 组件。

### R4 e2e 与 QA

- 新 e2e `scripts/video/e2e-export.mjs`（VID-015）：本地构造 2 镜头项目 JSON → `render-scene` 出 MP4 → `export-gif`（landscape）→ 断言 GIF 文件/ffprobe 元数据/DeliveryRecord 回写（renderIds 非空、frameMap 精确）→ 双跑转码哈希一致 → `export-shot-svg`（动画 + `--frame` 静态两模式）→ 断言 SVG 头/关键帧段数/DeliveryRecord（renderIds 空）→ 双跑哈希一致 → 计费台账行数不变（零 TTS）。
- 证据文档 `artifacts/video-studio-export/E2E_EXPORT.md`（SHA-256 清单 + 本地不入库媒体声明，沿 VID-014 体例）；`qa/registry.json` 登记 VID-015；`CURRENT_STATE.md` 顶部新增条目。

## 非目标

- 交互式 SVG / SMIL 脚本化（SVGAnimate 的网页交互类）——P3 交互交付路径。
- 字体嵌入 / 文字转路径（见 R2 诚实边界）。
- GIF 的逐镜头裁剪导出、GIF 字幕烧录开关（GIF 继承 MP4 已烧录画面，字幕自然带入）。
- web 内直接下载 SVG/GIF（浏览器无 ffmpeg；SVG 序列化器不复制进 web，避免双份维护）。
- DeliveryRecord 的 UI 展示（渲染记录列表已有，交付列表 P4 产品化再排）。

## 错误表

| 场景 | 行为 |
| --- | --- |
| 项目无该画幅 RenderRecord | exit 1，提示先跑 `render-scene --aspect ...` |
| 渲染块长度 ≠ 当前镜头数 | exit 1，提示镜头已变更需重渲染 |
| `--fps` 不整除 24 | exit 1，列出合法值 {1,2,3,4,6,8,12,24} |
| `--shot` 越界 / 镜头无 spec 场景源 | exit 1，指明合法范围 / 指路仅 spec 源可导出 |
| ffmpeg / ffprobe 失败或元数据不符 | exit 1，不回写项目 |
| SVG 采样总节点超预算 | exit 1，建议 `--fps 6` 降采样 |
| 项目文件校验失败（回写前重校验） | exit 1，原文件不动 |

## 测试策略

- 纯逻辑单测（`node --import tsx --test` 不涉 UI；scripts 层 `node --test *.test.mjs` 沿既有模式）：
  - `export-gif.test.mjs`：块发现（尾块/跨画幅穿插/长度不符/无记录）、frameMap 整数性、filter 串拼接、fps 合法集。
  - `svg-serialize.test.mjs`：XML 转义、keyframes 切片百分比、静态/动画两模式、确定性（同 seed 同串哈希）、节点预算拒绝。
- e2e（R4）：真实 ffmpeg/ffprobe/Remotion 全链，零 TTS 计费断言。
- 回归：video-document/video-scene 构建+测试、web 测试、scripts 测试、`pnpm lint`。

## 验收

- A1 同一项目同一参数两次 `export-gif`，GIF 逐字节一致，DeliveryRecord 各追加一条，savedVersion 各 +1。
- A2 `export-shot-svg --fps 12` 产物含 12fps 采样帧数的 keyframes 段且双跑一致；`--frame` 出静态单帧。
- A3 GIF/SVG 均可在系统默认查看器打开（e2e 以 ffprobe/文件头断言代替人眼）。
- A4 全程零 TTS 计费（台账行数不变）。
- A5 媒体不入库，SHA-256 证据落 `E2E_EXPORT.md`。
