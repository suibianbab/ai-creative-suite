# W2 风格代表帧确认 · 三套内部对照报告（2026-10-24）

构建入口：`node --import tsx artifacts/video-studio-w2-style-frame-2026-10-24/build-sets.mjs`（需本工作树 web dev server，默认 `BASE_URL=http://localhost:3219`）。出片命令与摘要见下。本目录 `.md/.json` 入库；PNG/MP4/WAV 为本地文件（gitignore），路径全部列明。

## 共同口径

- 关键帧：`POST /api/video/style-frame`（与出片同一 Remotion 引擎、同 bundle、同 Chrome），横 1280×720 / 竖 720×1280 PNG，SHA-256 钉进确认记录 `styleFrameConfirmations[-1].keyframes`。
- 确认：`appendStyleFrameConfirmation` 机械签收（note 标注「非人工审片」），绑定内容版本摘要、风格引用摘要与全工作集摘要。**这是链路验证，不是人工审片。**
- 字体：Remotion 打包 `NotoSansSC-Regular.woff`，manifest `fontDigests` 钉住（sha256 `1c1e8136…a7a`）。**许可**：思源黑体子集，SIL Open Font License 1.1（https://openfontlicense.org），允许打包与商用分发。
- 出片：`node scripts/video/render-scene.mjs --project <json> --style-bible <json> [--narration <dir>] --out render-*`，24fps H.264 双画幅。

## Set A · 文字动效

- 源项目：`text-motion.video-project.json`（3 镜头：fade-up 2.2s / scale-in 2.0s / fade-up 2.0s）；风格：`text-motion.style-bible.json`（深蓝 #101820 底、米色 #f3e6cf 标题、暖金 #e8b04b 副色）。
- 关键帧（真实渲染器）：`7229b951-…-landscape.png`（30,239B）/ `7229b951-…-portrait.png`（30,123B），frameIndex 21。
- 成片：`render-text-motion/landscape.mp4`（49,796B，sha256 `b50f31a2a46605a6…`）/ `portrait.mp4`（42,912B，`96c17b8c0e09e94e…`）；终帧抽检 `text-motion-finalframe-*.png`。
- 自动抽查（构建方视觉模型，非人工）：横版关键帧与竖版 2.4s 终帧均为深蓝底+米色标题、文字完整居中不裁切。入场节奏（fade-up 400ms / scale-in）在成片中逐镜存在。
- 关注点与结论边界：可读性达标（大字号、安全边距）；**节奏与停留时长是否「舒适」属人工审片范畴——待人工验证**。

## Set B · 数据解释

- 源项目：`data-explain.video-project.json`（画廊 data 样片：标题/柱状对比/关键数字/结论 4 镜头）；风格：`data-explain.style-bible.json`。
- 关键帧：`256d7f22-…-landscape.png`（45,448B）/ `256d7f22-…-portrait.png`（41,862B）。
- 成片：`render-data-explain/landscape.mp4`（141,309B，`3ee4f8f8b251d317…`）/ `portrait.mp4`（140,159B，`395519f1149bac1a…`）；终帧 `data-explain-finalframe-*.png`。
- 自动抽查：横版 3.5s「季度销量」横条图 Q1–Q4 标签与数值全部可读，条形用调色板 object 色。竖版 5.0s 同构。
- 边界：数字滚动的信息节奏、条形动效的引导性**未经人工评阅——待人工验证**。

## Set C · 竖版字幕（有声）

- 源项目：`portrait-subtitles.video-project.json`（STEM 七镜头终版 + 一条真实关键帧确认）；风格：`portrait-subtitles.style-bible.json`（同 STEM）。
- 音频来源：DashScope TTS（cosyvoice-v3-flash / longanyang），**全部命中既有内容寻址缓存**：`tts-narration.mjs` 报告「镜头 7/7 使用已计费旁白缓存」，共享台账 `usage.jsonl` 运行前后均 28 行——**本轮零新计费**。核对文件 `tts-cache-check.json`（missing=0）。
- 成片：`render-portrait-subtitles/landscape.mp4`（1,363,472B，`1578d5bbc91152b3…`）/ `portrait.mp4`（1,353,457B，`d5ae36c27a99edfb…`）。ffprobe 实测 portrait.mp4：**aac 双声道**、26.005s、24fps。manifest：`narration=7`、`subtitleCues` 在列、fontDigests 与 styleBibleRef 摘要钉住。
- 字幕抽检：竖版 3.0s 帧 `subtitle-check-portrait.png` —— 标题「蒸发」+ 太阳/水线图示 + 底部药丸字幕「太阳晒过海面，水变成水汽升到天空。」完整可读、未裁切、句号未单独成块。
- 音画配合：字幕由 TTS 字级时间戳驱动烧录，与旁白 WAV 同源；**语速舒适度、人声自然度、音画情绪匹配未做人耳评审——待人工验证**。

## 明确不做 / 未保证

- 外部实拍素材（媒体镜头）的色彩**不由** Style Bible 自动保证；本三套均为程序化画面。
- 单帧与自动抽查**不构成**成片质量结论；节奏、审美、音画配合以人工审片为准，本报告全部标注待验证项。
- `render-*` 目录内 `*.log` 为渲染日志，`props-*.json` 为渲染 props 证据。
