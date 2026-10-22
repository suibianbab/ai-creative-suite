# Video Studio 文字与数据动画双画幅布局验收（2026-10-22）

## 结论

同一份四镜头 `VideoProject` 已按画幅渲染为 1280×720 和 720×1280 两条 12 秒、24 fps MP4。竖版长标题使用两行均衡换行和标点断行；柱图、折线图、数字计数分别有竖版布局，横版图表标题也移入安全区。没有增加项目、镜头或时间线模型。

实际导出的视频抽检 4 个镜头 × 每镜 4 个时点 × 2 个画幅：原版 32 帧中有 12 帧超出中央 80% 可见安全区；修改版 32 帧全部在安全区内。额外将开场与收尾改成长标题后再导出双画幅，32 帧抽检也全部在安全区内。像素检查允许 2 px 编码/栅格误差。[完整逐帧记录](safe-frame-report.json)与[出口核验](export-audit.json)可复核。

## 画面比较

- [竖版前后四镜头](comparison-portrait.png)：旧版开场与收尾文字靠近左右边界；新版留出边距。旧版柱图占中间方形区域，新版图表充分使用竖屏中段，季度标签和值仍完整可见。数字镜头的计数动效保留。
- [横版前后四镜头](comparison-landscape.png)：文字与数字镜头保持原构图；图表镜头把顶部标题下移，避免顶部安全区越界。
- [长标题压力图：开场](long-title/shot1.png)与[收尾](long-title/shot4.png)：分别检查两行分配、标点不位于行首、无末行孤字、字幕不重叠。它们由同一四镜头项目改文案后真实出片，不是单独画的示意图。

| 项目 | 原版 | 修改版 |
| --- | --- | --- |
| 竖版镜头 1 可见内容左右边界（720 宽） | x=44..677 | x=143..578 |
| 竖版镜头 4 可见内容左右边界（720 宽） | x=41..680 | x=107..616 |
| 横版柱图顶部内容（720 高） | y=48 | y=88（10% 安全线为 72） |
| 16 帧/画幅的安全区抽检 | 12/32 越界 | 0/32 越界 |
| 长标题压力样片 | 原版未做同题材出片 | 0/32 越界 |

四个代表帧的边界数值来自视频实际解码的像素，不是 SVG 字宽估算。完整抽检和逐项边界见 `safe-frame-report.json`。

## 实现与契约

- `packages/video-scene/src/safe-layout.ts` 定义 10% 画布安全边界，并为字体估算误差另留 10% 文字余量。标题换行优先均衡两行；靠近中点的句读优先留在上一行。极长标题可能缩到不可读，仍须人工缩写或另做镜头设计。
- `text-animation` 竖版按实际画布排标题、副标题。`bar-chart`、`line-chart`、`number-counter` 在竖版使用画布坐标与独立间距，不再把方形设计区缩入竖屏。柱图数值及轴标签依槽宽缩字号；数字计数的逐帧值变化保留。横版图表标题和底部标签调整至安全区。
- `SceneSpec`、`VideoProject`、镜头 ID 与四镜头时长保持原契约；组件从现有 `FrameContext.width/height` 判断画幅。无需一镜头复制成两个镜头，也没有新增导出通道。
- [原项目](source-video-project.json)、[基准版出片后项目](rendered-video-project.json)、[长标题压力项目](long-title-source.json)与[出片后项目](long-title-rendered.json)可逐项对账。原项目带 8 条基线渲染记录，本轮基准版追加 8 条；压力项目更换文案前清空旧渲染记录，再新增 8 条，避免旧记录错误地声称覆盖新文案。

## 验证与复跑

- `pnpm --filter @acs/video-scene test`：144/144。新增长标题换行、标点断行、竖版标题/柱图/折线图/数字安全区等回归。
- `pnpm -r typecheck`：全工作区通过。新检出先构建 `@acs/shared`、`@acs/image-document`、`@acs/video-document`、`@acs/media-store` 与 `@acs/video-scene`。系统 pnpm 为 v9，根级 `pnpm typecheck` 因包声明 v11.19.0 被版本门禁拒绝，等效的构建后 `pnpm -r typecheck` 通过。
- `node scripts/qa/run-regression.mjs validate`：注册表有效，新增 `VID-034`。直接运行 `node artifacts/video-aspect-layout-2026-10-22/audit-exports.mjs`：核对同一项目/镜头 ID、追加渲染记录、六条 MP4 的尺寸/帧率/12 秒时长、全片解码和 96 帧安全区；PASS。输出默认写到忽略的 `.tools/`，加 `--record` 才刷新本目录证据。
- 真实导出：从[原项目](source-video-project.json)复制工作副本，运行 `node scripts/video/render-scene.mjs --project <工作副本> --style-bible artifacts/video-aspect-layout-2026-10-22/style-bible.json --out artifacts/video-aspect-layout-2026-10-22/after`。长标题用 `node artifacts/video-aspect-layout-2026-10-22/make-long-title.mjs` 生成项目后同法出片，省略 `--style-bible`。两次均跑 288 帧干跑，完成四镜头双画幅编码。`make-comparison.py` 生成对比图。

## 仍需人工设计的边界

安全区合格只证明可见内容没被裁掉，不等于美术成片质量。过长标题即使能缩成两行，也会降低字号；12 个密集数据点或很长的轴标签可能过小，原折线组件还会把超过 6 字的轴标签截成省略号。品牌视觉、图表取舍、留白和复杂动效节奏仍需逐镜设计。本轮真实出片覆盖四镜头柱图与数字计数，折线图的竖版路径由组件回归验证，尚未纳入这条四镜头样片。安全区抽检为每镜 4 个时点，不能替代对所有可能文案与字体的审片。
