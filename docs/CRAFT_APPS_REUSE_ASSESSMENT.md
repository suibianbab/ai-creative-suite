# Crafting Apps 复用评估（2026-10-10）

## 结论

AI Creative Suite 应把专业编辑能力交给现成引擎，自己负责跨题材的视频创作工作流、项目与素材、品牌规则、自然语言编排、版本、权限和交付。电商与商品广告是重要应用场景，但不限定 Video/Motion Studio 的内容范围。以下是架构候选与验证顺序，不表示这些引擎已经集成。旧 `PROJECT_SPEC.md`、`DECISIONS.md` 中冲突条款已由[目标与架构基线](PRODUCT_ARCHITECTURE_ALIGNMENT.md)和 [ADR-0012](../AI_Creative_Suite_Dev_Pack_v3/docs/adr/0012-reuse-professional-editors.md)明确取代。

| 引擎 | 在本产品中的职责 | 优先级与当前判断 |
| --- | --- | --- |
| [PhotoCraft](https://getartcraft.com/apps/photocraft) | Image Studio 主图片画布；图层、选区、蒙版、调色、传统修图、可编辑源文件 | 最高；先做 Web 嵌入、操作桥接、保存重开闭环。生成式改图仍需模型提供方。 |
| [VectorCraft](https://getartcraft.com/apps/vectorcraft) | Logo、图标、矢量插画、数据图形、SVG/PDF 输入输出 | 高；优先复用矢量编辑器，停止规划自研通用路径、布尔运算和排版工具。 |
| [EffectCraft](https://getartcraft.com/apps/effectcraft) | Motion Studio 的传统 2D 动效、图层、关键帧、曲线、文字动画、特效与合成 | 高优先级候选；先验证 Windows/Web 交互、项目保存和命令行渲染，再决定是否作为主时间线。 |
| [FilmCraft](https://getartcraft.com/apps/filmcraft) | 多轨视频剪辑、转场、字幕、音频、调色和人工精修 | 中高；作为视频剪辑工作台候选。短片自动批量合成先沿用已经验证的 Remotion 路线，真实项目比较后再分工。 |
| [LightCraft](https://getartcraft.com/apps/lightcraft) | RAW 原片导入、非破坏冲印、专业摄影批处理 | 条件接入；当相机 RAW 工作流确实超出 PhotoCraft 能力时启用，避免两个图片主画布。 |
| [DesignCraft](https://getartcraft.com/apps/designcraft) | 多页产品目录、手册、画册、印刷版式 | 后续；简单 Banner 与单页商品图继续在图片/矢量工作台完成。 |
| [PdfCraft](https://getartcraft.com/apps/pdfcraft) | PDF 合并、拆分、整理、保护和交付检查 | 低；只有正式扩展到 PDF 交付工作流时接入。 |

官网列出上述七个应用，宣称均可由 CLI、JSON 控制通道或 MCP 驱动；PhotoCraft、VectorCraft、LightCraft、PdfCraft、EffectCraft、DesignCraft 提供 WebAssembly 浏览器版本。FilmCraft 的官网目录当前只列桌面安装包，仓库文档另提 Web 构建，实际嵌入能力需要单独验证。[来源](https://getartcraft.com/apps)

ArtCraft 主应用另有 2D/3D 场景摆放、图片转 3D、图像与视频生成模型编排等能力，可作为 AI 生成及 2.5D 场景工作流的研究对象；其授权、服务接口与嵌入方式须单独核实，不能假定与七个 Crafting Apps 相同。[来源](https://github.com/storytold/artcraft)

## 与现有引擎分工

- Blender：真实材质、产品 3D、机械拆解及高质量渲染；EffectCraft 的 3D 图层不替代产品级建模与物理渲染。
- Three.js / GSAP / HyperFrames：需要浏览器交互或程序化场景时使用；传统可编辑动效先评估 EffectCraft。
- Remotion：已验证的自动化、多尺寸短视频合成保留；FilmCraft 面向可编辑剪辑。两者职责由样片对比决定，避免双重时间线。
- 自有数据层只保存项目、素材、品牌、版本、工作流、权限及引擎文件引用；专业编辑操作由对应引擎负责。不要再建立第二套完整的图片或动效编辑内部模型。原图仍不可变。

## 原视频参考与 ArtCraft 系列的关系

这些网站定义产品体验、内容类型与质量目标；Crafting Apps 提供其中一部分编辑引擎。参考站点没有因为接入 ArtCraft 系列而从目标中删除。

| 原参考 | 必须保留的目标 | 拟复用的制作能力 / 仍需实现的部分 |
| --- | --- | --- |
| [SVGAnimate](https://svganimate.ai/) | HTML Video、Gallery、文字、数据、STEM 动画和一键生成流程 | VectorCraft 产出矢量素材；EffectCraft 做可编辑文字与图形动效；HTML/SVG/D3/GSAP 场景保留程序化路线。内容模板、脚本、分镜、讲解准确性和 Gallery 需由本产品提供。 |
| [Hera](https://hera.video/) | 自然语言生成且可细调的优秀 Motion Graphics 成片 | EffectCraft 负责可编辑合成；本产品负责创意指导、模板、品牌约束、视觉 QA 与多轮修改。引擎功能不自动等于 Hera 的设计水准。 |
| [Jitter](https://help.jitter.video/en/articles/14111802-work-with-the-timeline) | 易用的 Motion Editor、时间线、预设、节奏调整 | 优先试用 EffectCraft 时间线与关键帧；本产品提供面向任务的入口和预设，不再自建另一套完整时间线。 |
| [Rive](https://rive.app/editor) | 可编辑交互动画与状态机、实时运行 | EffectCraft 可做时间线动效，但状态机仍是独立需求；优先评估 Rive 文件/runtime 接入，不用普通 MP4 或 Lottie 冒充状态机。 |
| [Spline](https://docs.spline.design/basics/what-is-spline) | 浏览器中可编辑、可发布的交互 3D | Three.js/GLB 路线保留；评估 Spline 场景嵌入或交互输出。Blender 负责高质量离线产品广告，不能覆盖交互体验。 |
| HyperFrames / GSAP / Three.js | HTML、SVG、数据、交互与代码场景 | 保留专用场景路线；仅在对应内容类型上使用，传统图层合成交给 EffectCraft。 |
| Blender | 写实产品材质、灯光、镜头与机械拆解 | RTX 4060 本地 Blender Worker 已完成技术样片；与 EffectCraft/FilmCraft 通过渲染镜头和资产交接。 |
| Remotion | 自动化、多尺寸、确定性终片合成 | 现有双尺寸样片继续作为批量导出路径；FilmCraft 补可编辑人工剪辑。 |
| [LTX Studio](https://ltx.io/blog/ltx-studio-tutorial) | 从 Brief 到分镜、镜头、重拍、合成的工作流 | Storyboard、镜头锁定、版本与一致性由本产品编排；PhotoCraft、ArtCraft 主应用、Blender、EffectCraft、FilmCraft 等分别制作镜头资产。 |

单条商品广告路径示例：商品图进入 PhotoCraft；图标、标注进入 VectorCraft；脚本和镜头在 Storyboard 中确定；镜头按类型交给 Blender、ArtCraft AI/2.5D 或 HTML/Three.js；标题、说明动画交给 EffectCraft；FilmCraft 做人工剪辑和音频，Remotion 做模板化批量尺寸导出；最后统一做视觉和商品身份 QA。所有这些步骤共享素材引用与版本记录，编辑器原生文件各自保留。

## 跨题材视频能力边界

引擎按镜头和交付类型选用，不按“商品广告”固定串接。每个视频项目只启用它需要的编辑器。

| 内容类型 | 主要制作路径 | 额外的产品能力 |
| --- | --- | --- |
| 文字动效、Logo 片头、品牌 Motion Graphics | VectorCraft → EffectCraft；复杂网页动效可用 HTML/GSAP | 字体、节奏和动画预设；可编辑模板和多尺寸变体 |
| 数据新闻、商业报告、STEM/教学、地图解说 | 数据/脚本 → SVG/D3/HTML/GSAP 或 EffectCraft → 配音字幕 → 合成 | 数据来源与事实校验、图表语义、讲解脚本、题材模板 |
| 软件演示、教程、录屏、访谈、短视频 | 原始录像/录屏 → FilmCraft → 字幕、音频、动态图形叠加 | 媒体导入、语音转写、镜头/停顿检测、人工可调剪辑 |
| 商品、品牌、活动广告 | PhotoCraft/VectorCraft 素材 + Blender/EffectCraft/FilmCraft | 品牌与商品身份约束、镜头模板、比例适配 |
| 照片故事、2.5D 视差视频 | PhotoCraft 分层/抠图 → 深度/相机 → Three.js、EffectCraft 或 Blender → 合成 | 前中后景分离、遮挡补全、视差安全范围 |
| AI 叙事、角色与影视预演 | Brief → Storyboard → AI 视频模型或 ArtCraft 主应用 → FilmCraft | 角色/场景一致性、分镜锁定、镜头重做；模型质量决定真实感与连续性 |
| 交互动画、交互 3D | Rive runtime / Spline 或 Three.js 场景 | 状态、事件、交互测试；交付物可以是网页体验而非 MP4 |

上述是覆盖路径，不是当前已交付的功能。写实长篇影视、复杂角色表演和稳定的多镜头一致性尤其依赖生成模型、素材与人工制作；现有 Crafting Apps 不能单独保证质量。跨题材的共用底座应保留 Brief、Storyboard、素材/授权、音视频、版本、可编辑源、镜头级重做、视觉 QA 与导出。专有商品身份规则只在商品内容中启用。

## 近期验证顺序

1. PhotoCraft：Web 画布导入商品图，按文字指令调用实际操作，保存并重开可编辑源文件，验证一次帽子改色与一次局部蒙版操作。
2. VectorCraft：导入 SVG，修改路径与文字，输出可编辑文件及 SVG/PNG；交给 EffectCraft 做动画素材。
3. EffectCraft：先做一条非商品题材的文字/数据解说动画，再做商品广告镜头；验证可编辑时间线、Windows/Web 表现及无头渲染。
4. FilmCraft：用真人素材或录屏、EffectCraft 动效和 Blender 镜头分别验证剪辑、配音、字幕及输出；再与现有 Remotion 样片比较。

每项只先做一条端到端样片，记录版本、桥接方式、保存/重开和结果质量。上述项目仍快速迭代：例如 [EffectCraft 仓库](https://github.com/storytold/effectcraft)明确称其尚不能替代商业项目中的 After Effects，Windows 交互有已知问题；[FilmCraft 仓库](https://github.com/storytold/filmcraft)自评实际项目可用度约 50–60%；[VectorCraft 仓库](https://github.com/storytold/vectorcraft)自评专业用户体验约 40–55%；[LightCraft 仓库](https://github.com/storytold/lightcraft)自评日常替代程度约 60–70%。这些都是上游自评，不能当成本产品的验收结果。

## 集成原则

锁定版本，逐个确认仓库许可证与第三方依赖；先用公开 CLI/MCP/控制接口和官方 Web 构建做桥接。不把“agent-ready”直接理解为已具备多租户 SaaS 的浏览器嵌入、云端保存或稳定 API。完成样片后更新开发顺序、当前状态和对应能力验收结果。
