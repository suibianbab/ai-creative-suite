# EffectCraft 动效编辑桥验证（2026-10-22）

## 结论

**技术往返可行，现阶段不建议把 EffectCraft 正式接入 Video Studio。** 一条基于现有数据样片 `VideoProject` 的四镜头、12 秒文字与数据动画，已在 EffectCraft 生成可编辑 `.ecproj`，保存重开、只改第 4 镜头、渲染八个横竖版片段，导入现有素材仓，再由 Video Studio 导出两条 12 秒整片。原有项目 ID、四个镜头 ID、顺序和时长均保留，未建立第二套项目或时间线。

样片竖版的排版、字号和留白优于同一分镜的程序化基线，但这些改进来自本轮人工美术调整，不能证明 EffectCraft 引擎自然产出更高质量。程序化样片的数字逐帧计数比本轮 EffectCraft 的静态数字淡入更丰富。单个样片也不足以证明复杂效果、长期稳定性和人工 GUI 编辑效率有显著收益。官方 README 自述项目较新，暂不推荐用于生产客户工作。因此本轮保留研究产物，不改生产编辑架构。

## 版本、许可、格式与官方入口

| 项目 | 核对结果 |
| --- | --- |
| 发布版 | 截至 2026-10-22，GitHub latest 为 [v0.14.0](https://github.com/storytold/effectcraft/releases/tag/v0.14.0)，本次固定 Windows x64 portable；ZIP SHA-256 `63e96a7f53b743d8c3590ce9f5785b18035fd592bb076ade44cd0881ac20ab0e`，与发布包 `SHA256SUMS.txt` 相同。 |
| 许可 | 官方 [README](https://github.com/storytold/effectcraft/blob/v0.14.0/README.md) 明示 [MIT](https://github.com/storytold/effectcraft/blob/v0.14.0/LICENSE-MIT) **或** [Apache-2.0](https://github.com/storytold/effectcraft/blob/v0.14.0/LICENSE-APACHE) 双许可，分发须检查 [NOTICE](https://github.com/storytold/effectcraft/blob/v0.14.0/NOTICE) 和素材 [ATTRIBUTION](https://github.com/storytold/effectcraft/blob/v0.14.0/ATTRIBUTION.md)；ArtCraft 品牌资产另有限制。本轮未复制引擎代码或品牌资产。 |
| 可编辑工程 | `.ecproj` 是可读、版本化 JSON；本次实测文件 `schema: 2`、`savedBy: 0.14.0`、8 个合成，保存后由 CLI 和桌面版均能重开。[架构说明](https://github.com/storytold/effectcraft/blob/v0.14.0/docs/architecture.md) 还列有 `.ecprojx` XML 和 `.ectemplate`，本轮未测它们的往返。 |
| 官方接入 | [agents 文档](https://github.com/storytold/effectcraft/blob/v0.14.0/docs/agents.md) 指明 CLI、MCP、桌面控制通道复用同一命令注册表。本轮实测 CLI 脚本/渲染、桌面 `--control 9877`、MCP 截图，没有调用私有接口。桌面 `info` 报 GPU 为 RTX 4060 Vulkan；头less CLI 报 CPU。 |
| 输出 | 官方 CLI 支持多种视频与图像格式；本轮只实测 H.264 MP4 和 PNG 抽帧，未将格式列表等同于生产可用性。 |

## 样片与往返操作

1. [create-project.mts](create-project.mts) 调用现有 `createGallerySample("data")`，保留四个镜头及内容参数，将每镜时长量化为 3 秒；源项目见 [source-video-project.json](source-video-project.json)。用同一源项目和现有 `render-scene.mjs` 渲染程序化基线，横竖版各 12 秒。
2. [build.jsx](build.jsx) 使用 EffectCraft 官方脚本对象模型创建同一叙事的 8 个合成：`L_01…L_04` 与 `P_01…P_04`。每个合成对应一个 `VideoProject` 镜头的一个画幅，不承担整片编排。保存 [初版原生工程](data-motion.ecproj)，在 CLI 中重开，抽帧后发现横版数字镜头的标题与数字重叠；调整构图并重新保存。此处是本轮真实发现并修正的视觉缺陷。
3. [edit-shot4.jsx](edit-shot4.jsx) 从保存的工程重开，仅将第 4 镜头横竖两个合成标题改为“增长，始终可见”，另存 [最终原生工程](data-motion-edited.ecproj)。8 个合成在 2.2 秒抽帧的 [SHA 比对](edit-diff.json) 显示：只有 `L_04`、`P_04` 变化，其余 6 个完全相同。最终工程又在桌面 EffectCraft 0.14.0 打开，真实 [时间线截图](effectcraft-ui-timeline-shot4.png) 和 [合成截图](effectcraft-ui-composition-shot4.png) 可见修改后的标题。桌面编辑控件的人工点按效率未测；本轮编辑通过 EffectCraft 官方 CLI/脚本完成。
4. 从最终原生工程渲染 8 个 3 秒、24 fps 片段（[片段摘要](clip-digests.json)），调用现有 `scripts/video/media-ingest.mjs` 导入隔离素材仓。用 [handoff.mjs](handoff.mjs) 给原镜头追加原生 `editor-binding` 与横、竖视频 `media-clip` 内容版本，写 [映射与摘要](bridge-manifest.json)。横竖出片分别选择对应工作版本，但项目 ID、镜头 ID、顺序和时长同源。`editor-binding.assetId` 指向原生文件摘要；具体合成名仍由桥接清单映射。
5. 现有 `render-scene.mjs` 完整跑过每版 288 帧干跑及媒体摘要核验，回写每版 4 条 `RenderRecord`，输出 [横版视频](video-studio-landscape/landscape.mp4) 与 [竖版视频](video-studio-portrait/portrait.mp4)。两版均 12.000 秒、24 fps，分别为 1280×720、720×1280；详见 [QA 结果](qa-result.json)。

**风格规范边界：**原始数据样片引用 Style Bible，但现有 `verifyProjectStyleBible` 会正确拒绝“外部媒体画面受本地颜色/灯光规则保证”的声明。两份回传出片快照因此没有 `styleBibleRef`；源分镜及独立风格文件仍保留作人工设计依据。第一次出片尝试在该检查处明确失败，移除无法兑现的保证后出片通过。未来若做正式桥，需定义外部编辑器的风格检查方式。

## 并排画面与效率评估

两边采用同一 `VideoProject` 的四镜头叙事、数据 32/46/58/82、12 秒、24 fps 和相同输出尺寸。基线由现有场景组件出片；EffectCraft 源工程由人手设计，所以比较是**工作流样片对比**，不是引擎控制变量实验。

| 维度 | 程序化基线 | EffectCraft 本轮样片 | 判断 |
| --- | --- | --- | --- |
| 横版单帧 | 简洁，图表和数据可读 | 更明确的标题层级、柱值、底部标识与留白 | 本轮 EffectCraft 画面略完整，差异主要来自手工版式。见 [横版并排图](comparison-landscape.png)（左侧基线、右侧 EffectCraft）。 |
| 竖版单帧 | 开场和结尾的长文本在画幅边缘被截断 | 四个镜头均在安全区域内，图表标签可读 | EffectCraft 样片明显更好，但这是手工横竖两套构图的结果。见 [竖版并排图](comparison-portrait.png)（上排基线、下排 EffectCraft）。 |
| 动效 | 内置图表入场与数字计数；调整参数即可复用，见 [数字计数四帧](baseline-number-motion.png) | 文字淡入上移、柱条错峰升起；本次数字 82 只有淡入，见 [横版 16 帧](motion-contact-landscape.png) 与 [竖版 16 帧](motion-contact-portrait.png) | 各有优劣。不能以静帧好看推断整体动效更强。 |
| 编辑效率 | 同一组件参数跨画幅复用，改数字或标题只需改一次 | 可编辑层和关键帧丰富；一次镜头文案改动需处理 `L_04`、`P_04` 两个合成 | 本轮没有显示总耗时优势。EffectCraft 8 个片段的无头渲染各约 0.52–0.61 秒，但初始版式构建和双画幅维护增加人工成本。 |
| 稳定性 | 原有双画幅管线本轮 8 条渲染记录 | 原生工程保存重开、桌面打开、8/8 片段渲染、2/2 Video Studio 整片出片通过 | 只覆盖一台 Windows/RTX 4060、一个 12 秒样本；不能推断生产稳定性。 |

## 接入缺口与本轮决策

- `SceneSource.editor-binding` 目前只有 `engineId`、`engineVersion`、`assetId`，没有原生工程内 `compId`；本轮用 [bridge-manifest.json](bridge-manifest.json) 保存镜头到合成的映射。真正迁移/协作时需把映射纳入可验证的资产契约。
- 一个镜头当前只有一个 `workingVersionId`，无法在同一保存态自动为横竖画幅选择不同媒体。验证中使用**同一项目 ID 和同一镜头链**的两份出片快照；这是现有契约缺口，并非正式用户工作流。不应以两套平行时间线解决。
- 原生 `.ecproj` 还没有进入 Video Studio 的二进制素材仓及下载/恢复流程。本轮 `editor-binding` 保存摘要和外部清单，能复核本机文件，不能宣称跨机器一键重开。
- `Style Bible` 对外部媒体的质量保证、原生工程版本关联、出片任务状态和失败清理都需要单独契约验证。
- 本轮仅使用官方 CLI/脚本进行实际编辑，桌面应用做打开、重开与可视检查。未实测人工拖拽时间线、大量镜头及复杂效果。因此**不立刻开发正式 EffectCraft Web 嵌入或生产桥**。保留当前程序化组件作为快速可改的主路径；需要复杂逐层动效时，可由人工使用 EffectCraft 制片并按现有媒体导入路径交付。若后续有确切高复杂度镜头，先用成对题材样本证明质量/效率增益，再评估桥接契约。

## QA 与复跑

- 自动用例 `VID-031`：运行 `node research/effectcraft-bridge-2026-10-22/qa-bridge.mjs`；实际结果 PASS，检验项目/镜头身份、原生摘要、单镜差分、8 段片长与尺寸、两版 12 秒整片和渲染记录。
- 人工用例 `VID-032`：检查桌面工程、[横版并排图](comparison-landscape.png)、[竖版并排图](comparison-portrait.png)及两条整片，重点看文字裁切、柱值和镜头边界。本轮人工检查了每镜 4 个时间点（共 16 帧/画幅）及 4 个并排代表帧；两个 MP4 还通过全片解码。未进行多人主观评分。
- `node scripts/qa/run-regression.mjs validate`：89 个自动、54 个人工用例登记有效。`pnpm exec biome check research/effectcraft-bridge-2026-10-22 qa/registry.json`：24 文件通过。系统 `pnpm` 为 v9，与项目要求 v11.19.0 不符，所以没有把 `pnpm qa:validate` 的失败当作代码缺陷；直接运行 QA 脚本成功。
- 若重建原生样片：下载并校验固定发布包，将 `effectcraft-cli.exe` 路径放入 `$cli`，依次运行 `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs research/effectcraft-bridge-2026-10-22/create-project.mts`、`& $cli script research/effectcraft-bridge-2026-10-22/build.jsx --save-as research/effectcraft-bridge-2026-10-22/data-motion.ecproj`、`& $cli script research/effectcraft-bridge-2026-10-22/edit-shot4.jsx research/effectcraft-bridge-2026-10-22/data-motion.ecproj --save-as research/effectcraft-bridge-2026-10-22/data-motion-edited.ecproj`。重新生成素材资产 UUID 会改变项目 JSON 和视频文件 SHA，应对新生成的清单重新对账，不把旧哈希硬套到新运行。
