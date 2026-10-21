# P3-A 交互 HTML 交付设计（逐步点击的解说页）

- 日期：2026-10-21
- 状态：已实施
- 前序：`docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md`（P3：交互动画/动态网页走独立交互交付路径，保留可运行源、不经成片渲染；验收「实际触发+嵌入，不以 MP4 充数」）
- 相关：`scripts/video/svg-serialize.mjs`（逐帧 SVG 翻页册）、`scripts/video/delivery.mjs`（DeliveryRecord 追加器）、`scripts/video/export-shot-svg.mjs`（同层导出先例）

## 1. 意图

P0–P2.5 的产物都是 MP4，观众只能看。P3-A 交付另一种成品：**一个不懂技术的使用者自己打开、跟着一步步往下点的解说页**。

用户原话（2026-10-20）：使用场景是「不懂技术的使用者自己操作」，动作是「跟着一步步往下点」。本刀只做这一种交互形态；3D（P3-B）、小游戏、分支剧情不在本刀。

## 2. 核心裁定（每条都写明代价）

### R1 交付物 = 单个自包含 `index.html`

页面内联全部 SVG 与数据，零外部文件、零网络请求；双击可开（`file://`），也可被 `<iframe>` 嵌入。**不做**「目录 + 运行时」「MP4 套壳」「在线托管链接」。

- 理由：使用者不懂技术，最可靠的分发单位是一个文件；`file://` 下 `fetch` 会被浏览器拦截，所以数据必须内联。
- 代价（若判断错）：大项目页面体积大；媒体类镜头（视频）无法内联，本刀直接拒绝（R4）。改为目录形态只需换打包层，不影响步骤数据模型。

### R2 交互模型 = 分镜即步骤

项目的每个镜头（按 `shots[].order`）成为一个步骤；进入页面显示第 1 步，点击「下一步」推进。**不做**分支、跳转表、自由脚本、每步自定义交互。控件：`上一步`、`下一步`、`重新开始`；键盘 `←` / `→` / `Space` / `Enter` 前进后退、`Home` 重开。

- 理由：用户要的就是线性逐步点击；分镜是项目里唯一稳定的步骤单位，不需要新数据结构。
- 代价：不能做「点不同按钮看不同结果」的分支互动；若以后要，需新增步骤类型，属于 P3 扩展而非推翻。

### R3 每步的动画 = 既有 SVG 翻页册，进入步骤时重启动画

复用 `buildAnimatedSvg`：把每镜头按 `--fps` 采样成逐帧 `<g>`，用 CSS `steps(1,end)` keyframes 循环播放。播放器在切换步骤时整体替换舞台内容，因此各步的 keyframes 不会互相污染，动画也从第一帧重新开始。

- 理由：零新运行时、零 React 注入、零网络；出片与交付共用一套逐帧纯函数，确定性有既有测试背书。
- 代价：动画是逐帧翻转而非连续补间（与 SVG 导出一致，既有产品已接受）；文件体积与帧数成正比，用 `--fps` 控制。

### R4 场景源范围 = 仅 `spec`

`media-clip` 与 `editor-binding` 镜头一律**导出失败并报镜头号**，不静默跳过。P3-A 不支持视频步骤；`editor-binding` 的平台语义是「永不解析」，无法在无引擎环境下渲染。

- 理由：范围可控，失败可读；避免「部分镜头静默丢失」这种最难排查的交付事故。

### R5 落账 = DeliveryRecord 追加可选字段

每次成功导出写一条 `DeliveryRecord`：`versionIds` = 各步骤工作版本、`renderIds` = `[]`、`frameMap` = 各步骤采样帧数；新增**可选**字段 `kind: "interactive-html"`、`outputRef`（相对 `--out` 的文件名，固定 `index.html`）、`digest`（`index.html` 的 SHA-256）。旧记录无这些字段，校验与重开行为不变。

- 理由：交付必须可追溯（与 GIF/SVG 导出同纪律）；可选字段保证向后兼容。
- 代价：`DeliveryRecord` 类型新增键；若以后要给旧记录回填，需迁移，本刀不做。

### R6 确定性 = 同输入两次导出逐字节一致

HTML 内**不写入** `deliveryId`、时间戳、项目 id 或任何随机值；两次导出 `index.html` 的 SHA-256 必须相同。交付记录里的 `deliveryId/at` 落在项目 JSON，不落页面。

- 理由：这是本仓库一贯的确定性门禁，也让 e2e 能用哈希对拍。

### R7 QA = 新用例 VID-024（真实浏览器触发 + iframe 嵌入）

`scripts/video/e2e-interactive.mjs`，playwright-core 驱动，**不需要 dev server 与端口**（页面是 `file://`），因此 `tier: "integration"` 且 `requiresPorts: []`（不登记端口）。断言见 §5。

### R8 P3-A 不含工作台按钮与宿主 SDK

导出入口是 CLI，与 GIF/SVG 导出同层；工作台「导出交互页面」按钮、`postMessage` 宿主协议、埋点都不在本刀。

- 理由：先钉住交付物本身与验收门禁，UI 接线是独立小刀。

## 3. 页面结构与交互细节

```html
<!doctype html><html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{项目标题}</title><style>…</style></head>
<body data-step="1" data-total="{N}">
  <main class="stage" id="stage"><!-- 当前步骤的内联 SVG --></main>
  <footer class="controls">
    <button id="prev" type="button">上一步</button>
    <span id="indicator" aria-live="polite">第 1 / N 步</span>
    <button id="next" type="button">下一步</button>
    <button id="restart" type="button">重新开始</button>
  </footer>
  <script type="application/json" id="steps-data">{…}</script>
  <script>…固定播放器…</script>
</body></html>
```

- 数据块：`{"title":string,"width":number,"height":number,"steps":[{"svg":string}]}`；序列化时把 `<` 转义为 `<`，防止 SVG 内容提前闭合 `<script>`。
- 播放器：解析 JSON → `stage.innerHTML = steps[i].svg`；更新 `body[data-step]` 与指示文案；第 1 步禁用「上一步」，最后一步禁用「下一步」；「重新开始」回到第 1 步。
- 键盘：`ArrowRight`/`Space`/`Enter` 下一步，`ArrowLeft` 上一步，`Home` 重新开始；焦点在 `<button>` 上时跳过 `Space`/`Enter`，避免与按钮原生点击重复触发。
- 样式：深色页面底（`#0b1020`），舞台居中、`svg{width:100%;height:auto;display:block}`、保持 `width/height` 比例；控件固定尺寸，移动端换行不溢出。步骤切换无过渡（避免动画起点被淡入遮挡）。
- 无外部字体；SVG 沿用 `NotoSansSC, sans-serif`，缺字体时回退系统字体（见 §8）。

## 4. CLI 契约

```bash
node scripts/video/export-interactive.mjs \
  --project <path.json> --out <dir> \
  [--fps 12] [--aspect landscape|portrait]
```

- 默认：`--fps 12`（同 `export-shot-svg` 的采样档位 `1/2/3/4/6/8/12/24`）、`--aspect landscape`。
- 输出：`<out>/index.html`（覆盖写）；成功打印步数、帧数、字节数、`DeliveryRecord` 短 id 与 `savedVersion`。
- 失败：任一镜头非 `spec`、`scene_spec` 校验失败、`spec.durationMs` 与版本时长不一致、总字节超上限、0 镜头、参数非法 → `exit 1`，文案含镜头号与原因。
- 上限：`index.html` ≤ **8 MiB**（`Buffer.byteLength`），超出时报「降 `--fps` 或拆分项目」。
- 落账：写回 `--project` 指向的项目文件（缩进 2，末尾换行，与既有导出器一致）。

## 5. 验收链（VID-024）

1. **导出**：固定夹具（3 镜头：`text-animation` → `flow-steps` → `text-animation`）导出 exit 0；`index.html` 存在；`data-total="3"`。
2. **自包含**：HTML 中无 `src=`/`href=` 外部引用、无 `fetch(`/`XMLHttpRequest`、无 `<link>`；`lang="zh-CN"`。
3. **确定性**：两次独立导出（各自清空输出目录）`index.html` 逐字节 SHA-256 相同。
4. **真实触发**（`file://`）：第 1 步 `data-step="1"`、舞台含 SVG、`上一步` 禁用；点击 `下一步` → `data-step="2"` 且舞台 SVG 内容变化；键盘 `ArrowRight` → 3、`ArrowLeft` → 2、`Home` → 1；最后一步 `下一步` 禁用。
5. **嵌入**：临时宿主页 `<iframe src="index.html">` 打开；在 iframe 内点击 `下一步`，`data-step` 推进，页面无 `X-Frame-Options`/控制台错误。
6. **零网络**：除文档自身与 iframe 文档外，无任何请求（playwright 请求监听计数）。
7. **控制台**：0 error。
8. **落账**：项目 JSON 追加一条 `kind:"interactive-html"` 的交付：`versionIds` = 3 个工作版本、`renderIds` = `[]`、`frameMap` 为 3 个正整数、`outputRef:"index.html"`、`digest` 匹配 `/^[0-9a-f]{64}$/` 且等于实测哈希；`savedVersion` +1；`validateVideoProject` 通过。
9. **失败路径**：把夹具任一镜头改成 `media-clip`（补资产账本）→ exit 1 且文案含该镜头号。
10. **纪律**：导出产物、宿主页、证据全部 untracked 或 `artifacts/` 下，不入库。

## 6. 非目标

- `media-clip` / `editor-binding` 步骤；视频与音频播放；TTS 旁白与字幕。
- 步骤间转场、分支、输入控件、外部事件钩子、任意 JS。
- 工作台 UI 按钮、API 路由、宿主 SDK / `postMessage`、多语言。
- 3D（P3-B）、小游戏、Gallery/分享链接。
- 字体嵌入（页面依赖系统字体）与打印样式。

## 7. 失败与证据

- 证据目录 `artifacts/video-studio-interactive/`（untracked）：`evidence.md`、导出项目 JSON、`index.html`、宿主页、双跑哈希。
- QA 登记：`VID-024`，`tier:"integration"`，`requiresPorts: []`，`argv:["node","scripts/video/e2e-interactive.mjs"]`，`cwd:"."`。
- 失败文案：`[e2e-interactive] FAIL at <步骤>: <原因>`，`exit 1`。

## 8. 已知限制

- 页面依赖本机字体；无 `NotoSansSC` 的机器上中文按系统默认无衬线显示，版式可能轻微变化（SVG 显式坐标不变）。
- 单页体积随「步数 × 帧数 × 节点数」增长；8 MiB 上限是硬门禁不是目标值。
- `file://` 下页面可用；若宿主站点设 CSP，内联脚本可能被拦截（P3-A 不处理，宿主需放行 `'unsafe-inline'`）。
