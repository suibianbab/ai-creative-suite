# Video Studio D：Style Bible 样片与实现

## 先验样片门槛

编码前先用既有文字动画与 `orbit3d@1` 组件独立制作四镜头样片：文字 → 3D 球体 → 3D 圆环 → 文字。统一深蓝背景、暖色文字/主体、相同打包字体与固定柔光 rig。只改第 4 镜标题后重新出片。逐帧截图人工检查：背景、文字色、3D 主体色和高光方向跨镜头一致；改后的第 4 镜仍沿用同一风格，前三镜的源版本逐字段不变。初次抽帧发现 1 秒文字镜头的副标题入场太晚，样片将 `enterMs` 调至 400 ms 后重渲；这个修正已纳入回归样片，不拿缺陷图充当通过证据。

该样片证明现有**程序化**画面可以按受控配色保持一致：字体实际由 Remotion 打包的 `NotoSansSC-Regular.woff` 固定并在渲染记录里记摘要；`orbit3d@1` 使用固定环境光 0.35 与方向主光 2.0（位置 2.5,4,3）。它不证明自由换字体、可调摄影灯光或实拍素材自动调色。样片是结构与一致性验证，不是商业广告质量验收。

复现：`node scripts/video/e2e-style-bible.mjs`。留存的 [深色成片](../artifacts/video-studio-style-bible/dark.mp4)、[单镜修改成片](../artifacts/video-studio-style-bible/edited.mp4)、[浅色版本成片](../artifacts/video-studio-style-bible/light.mp4) 以及 [文字帧](../artifacts/video-studio-style-bible/dark-text.png)、[3D 帧](../artifacts/video-studio-style-bible/dark-3d.png)、[浅色文字帧](../artifacts/video-studio-style-bible/light-text.png)、[浅色 3D 帧](../artifacts/video-studio-style-bible/light-3d.png) 可直接复看；摘要与版本号见 [机器报告](../artifacts/video-studio-style-bible/report.json)。整片 H.264 因最后镜头内容变化会轻微改变前段压缩像素，回归以前三镜源内容逐字段相同及前 72 帧解码 PSNR 门槛校验，不宣称 MP4 字节相同。

## 数据与编辑边界

- `StyleBible` 是独立 JSON 记录：`id`、只追加的 `versions`、可移动的 `currentVersionId`。每个不可变版本存五色调色板、受支持字体名与灯光预设；旧版本不得删改。
- `VideoProject` **只存** `{bibleId,versionId,digest}`；`digest` 是目标版本 canonical JSON 的 SHA-256。旧项目无此键照常读取。工作台用 IndexedDB 的独立 `styleBibles` store 保存，不往镜头或项目内嵌风格正文。
- 应用或切换风格时，对需要改色的程序化镜头走既有 `reviseWorkingVersion` 人工路径，追加新内容版本与事件；旧镜头版本、审批与渲染记录不改。单镜修订/重做与新分镜追加后复核当前风格。保存和 CLI 导出都校验引用摘要与工作镜头配色。
- 媒体片段与外部编辑器镜头无法由此版本保证颜色和灯光，应用时给出明确拒绝；不暗中重绘素材。自由字体和可调光型也不在当前能力内，记录中仅允许实际已支持的预设。

## 导出与验收

工作台分别导出项目 JSON 和独立 Style Bible JSON。带风格引用的项目使用 `render-scene.mjs`、`export-gif.mjs`、`export-shot-svg.mjs` 或 `export-interactive.mjs` 时都须传 `--style-bible <风格规范.json>`；缺文件、摘要不符或镜头风格漂移会在产物写出前拒绝。`RenderRecord.styleBibleRef` 钉住本次实际使用的版本。

`VID-028` 实跑四镜 MP4、风格切换、单镜修改，以及 GIF/SVG 导出；导出记录的 SHA-256 与产物字节一致。`VID-029` 实际浏览器走创建、保存、刷新重开、另存新风格版本、切回旧版、单镜修订、再次保存重开，控制台零错误。浏览器导出的最终项目连同侧车文件也完成横竖版 MP4 真实渲染。单元测试覆盖只追加、摘要校验、3D 强调轴配色、本地存储与旧项目读取。全部不调用 TTS。

本次验收：`VID-028`、`VID-029` 均 PASS；前 72 帧（前三镜）深色原片与单镜修改片的解码 PSNR 为 **70.300262 dB**，前三镜源版本完全相同。浏览器导出项目经 CLI 重新出片产生横竖版各一条 MP4、共 8 条钉住相同风格摘要的渲染记录。`video-document` 152/152、Web 248/248、Biome 与 Web typecheck 均通过。全量 `integration` tier 另含旧用例，当前被缺少 `.env` / :3211 服务及 `VID-025` 对 TTS 台账固定 34 行的历史断言影响，不能据此宣称整个 tier 全绿；Style Bible 专项可独立复跑。

后续可扩展点：当接入可编辑器源、可调光 3D 或可选字体时，先增加相应引擎能力和样片，再扩展 Style Bible 的受支持预设；不能只新增元数据字段就声称已经控制了画面。
