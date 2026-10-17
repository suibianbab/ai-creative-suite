# PhotoCraft 自然语言局部编辑：当前实现与质量边界

2026-10-13 补充：当前图层/选区读取、文字样式与投影连续步骤，以及开发环境生成式局部编辑见 `PHOTOCRAFT_CONTEXT_SEQUENCE_GENERATIVE.md`。生成结果交回 PhotoCraft 原生蒙版图层；真实 Provider 画质尚未验证。

2026-10-13 更新：规划接口现在从 `apps/web/src/app/image-studio/photocraft/planner-catalog.ts` 生成受限模型 schema 和能力说明，覆盖换色、调色、裁切、单点修复、文字、画布/图片尺寸、整图色阶、当前文字样式和图层投影。明确句式先走规则；其余单项要求由本机 `llama.cpp` 判断操作，再从原话提取尺寸、色阶、投影和文字参数并逐项复核。模型不能提交 PhotoCraft 命令 ID。缺少必要参数、未支持的白色换色、混合效果和删除标签会在编辑前拒绝；局部选区尚未建立时，界面随后要求用户画框，不能据此误判为不支持。固定回归见 `IMG-030`，PhotoCraft 执行与原生源重开见 `IMG-028`、`IMG-029`。这仍是**已接入能力范围内**的自然语言入口，不等于任意生成式修图。

更新：2026-10-11。

## 执行路径

用户输入 → 常见句式规则或本机 Ollama 解析 → 严格限定的编辑计划 → 用户确认目标、画取样点/轮廓/作用框/保护框 → 本机 PhotoCraft CLI 创建蒙版调整层 → 预览 → 确认后保存可编辑 `.pcraft`。模型只翻译要求，不生成 CLI 命令或直接修改像素。PhotoCraft Web 画布可打开保存后的原生源；旧 ImageDocument 项目仍可使用。

目前计划支持局部换黑、红、蓝、绿、灰，局部或整图亮度、对比度、饱和度、曝光、自然饱和度、暗部和高光调整，画框裁切或居中方图裁切，以及点击一个污点后由 PhotoCraft 原生 `paint.spotHealing` 修复。整图调整不需要选区，使用 PhotoCraft 原生可编辑调整层；裁切调用 PhotoCraft `image.crop` 并保留框外源像素，不在平台重写裁切算法。污点修复复制像素层后再调用原生工具，不修改下方原图。明确的复合指令现在可拆成 2～4 步，要求用户确认完整计划后顺序执行；目前一次只允许一个局部选区步骤，裁切须为最后一步，污点修复仍须单独执行。中途失败时原项目不应用半成品。未知步骤、泛化移除物体、生成、换材质及其他颜色会明确拒绝，不会静默只做其中一部分。局部编辑涉及保留标签/商标/文字时必须画保护框。用户须检查预览，尤其是目标边缘、品牌文字、背景和纹理。

本机模型配置：执行 `scripts/photocraft/start-instruction-model.ps1`，然后以 `PHOTOCRAFT_INSTRUCTION_PROVIDER=llama.cpp` 启动 Web 生产服务。本机端口 `127.0.0.1:11435` 的 `llama-server` 直接读取已下载的 Qwen3 4B GGUF，结构化补全返回受限 JSON。模型文件可用 `PHOTOCRAFT_INSTRUCTION_GGUF` 指定；未指定时启动脚本从 `OLLAMA_MODELS` 的旧版 Qwen3 4B 清单定位。原有 `ollama` 提供者仍可选，模型由 `PHOTOCRAFT_INSTRUCTION_OLLAMA_MODEL` 指定。明确句式由规则解析，不依赖模型；其他句式经本机模型和白名单校验。模型能力会影响对象、参数、保护要求的识别率，但不会扩大 PhotoCraft 支持的操作范围。模型输出仍可能误解复杂要求，因此计划可见，且必须预览确认。最终像素质量还取决于选区、PhotoCraft 能力和 QA。

## 验证与未完成项

- 规则计划、非法模型输出、错误目标和遗漏保护要求的单元测试通过。API 对“把帽沿改成红色，保留标签”返回有效计划；对“改红再去掉标签”返回 422。
- 本机桥接回归通过：帽沿套索换红、帽子采样换绿并保护标签、矩形亮度调整、遗漏保护框拒绝。命令产物为带蒙版的 PhotoCraft 调整层。
- PhotoCraft 0.6.0 原生命令实测：`image.crop` 的 `deleteCroppedPixels=false` 可保留框外源像素；整图亮度、对比度、饱和度由 PhotoCraft 调整层执行。`IMG-011` 覆盖可编辑源、预览尺寸和不完整计划拒绝；`UI-017` 覆盖自然语言入口与保存重开。
- 浏览器实测：导入自制帽子图，解析“把帽沿改成红色，保留标签”，手画轮廓并两次点击画标签框，预览、应用、保存为两层 `.pcraft`，刷新后重开成功。当前手绘轮廓样片在帽沿外缘留下可见的青色细边，需要继续改进选区和边缘 QA；不能作为精品商品图质量证明。
- 已接入 PhotoCraft 原生补选/剔除套索、边缘扩展/收缩、羽化和可选面料颜色交集。单张自制帽图的边缘残留显著减少，但下沿仍有暗红溢色；交互与量化结果见 `docs/PHOTOCRAFT_SELECTION_REFINEMENT.md`。
- PhotoCraft Web 画布现可放大进入蒙版精修，画布保存后重新从原生 `.pcraft` 生成工作台预览。调整层蒙版点击、黑色画笔修改、保存重开已实测；Web 白色补画尚需排查。CC0 毛绒边界换色出现明显矩形背景污染，质量失败，见 `qa/UI-015-2026-10-11.md`。
- 工作台预览现可 1×/2×/4× 放大并直接用 PhotoCraft 原生黑/白蒙版笔触剔除溢色或补回漏选；每笔可撤销，应用后保存可编辑 `.pcraft`。帽沿样图的 CLI 像素回归与浏览器黑白笔触、撤销、保存重开已验证。毛绒猫耳的原生智能选区仍有硬截断，不能将人工精修入口视为自动复杂边缘已达标；见 `docs/PHOTOCRAFT_SELECTION_REFINEMENT.md`。
- `IMG-013` 验证原生单点污点修复恢复测试标记像素，且保留未修改的下层；曝光、自然饱和度均创建可编辑调整层。它只证明受限局部修复路径，不代表大物体移除、纹理复杂区的质量。
- 工作台通过 PhotoCraft 原生读取尺寸、图层与 ICC 配置。`IMG-014` 验证 Display P3 输入经 PNG、JPEG、WebP、TIFF、PSD 导出仍有 P3 ICC；选择 sRGB 时由 PhotoCraft 转换。PSD 重开仍有调整层及蒙版。详见 `docs/PHOTOCRAFT_COLOR_EXPORT.md`。
- 本机 Ollama 的 `qwen3:8b` 在现有 RAM/GPU 压力下加载失败；新拉取的 `qwen3:4b` 清单链接无法遍历。修复模型目录的尝试被自动审批拒绝。改用本机随 Ollama 安装的 `llama-server` 直接读取完整 GGUF 权重后，非规则句式实时解析已通过 API 和浏览器验证：蓝色帽沿且保留标签、稍微提高饱和度、增加帽沿对比度；白色换色返回 422。`llama-server` 当前在 CPU 上推理，速度和复杂指令准确率还需更大样本评估。
- 这是版本锁定的本机开发桥接，不是多租户生产渲染服务，也不支持任意自然语言修图。对 PhotoCraft 版本升级需要重跑原生保存重开和图片 QA。

回归项见 `qa/registry.json` 的 IMG-005～IMG-024、UI-012～UI-023。复合编辑可运行 `node scripts/photocraft/test_instruction_rules.mjs` 和 `node scripts/photocraft/test_instruction_sequence.mjs`；后者需要本机 PhotoCraft 桥接服务。精细帽沿样片见 `qa/IMG-023-2026-10-12.md`。

2026-10-11 补充“暗部”“高光”中英文计划解析，映射到 PhotoCraft 原生 Curves 调整层；错误对象/无效参数仍被拒绝。`instruction.test.ts` 与 `IMG-013` 覆盖计划和可编辑源。毛绒边缘可选 Provider 蒙版再进入 PhotoCraft 原生编辑，见 `IMG-015`、`UI-020`；这扩展的是选区来源，没有把模型输出当作未经确认的像素命令。

2026-10-12 增加三步指令「把帽沿改红、保留标签、整体稍微提亮并裁成方图」：计划展示与确认、手动画帽沿轮廓及标签保护框、按顺序使用 PhotoCraft 原生调整层和裁切。现先预览局部换色并允许原生蒙版修边，用户确认后才执行后续步骤；全部完成后需逐项检查目标覆盖、背景保护、文字细节和边缘过渡，才能应用保存 `.pcraft`。桥接回归验证连续原生源、可编辑图层、逐步预览变化和方图尺寸。原先 5 点粗套索为质量失败样本；现可按住拖动描绘最多 512 点的精细轮廓，383 点样片达到 `IMG-023` 的固定图片阈值。`IMG-024` 固定粗样本失败、精细样本通过。任意用户图片仍需人眼检查，勾选质量项不等同于自动商业精修认证。

接口回归发现本机模型曾把“把高光降低15”返回为正向 15，并把“先把帽子改红再提高亮度”只解析出换色。现在明确的暗部/高光数值句式由规则解析；模型计划还必须与原文的效果数、方向和数字幅度一致。复测三句依次返回暗部 +20、高光 -15、复合要求 422。此校验降低静默误执行风险，但没有让任意口语都可解析。

2026-10-12 命令适配重构：现有换色、调整、裁切和污点修复编译出的 PhotoCraft 原生命令统一经固定版本命令目录验证和执行；桥接提供 /v1/capabilities。新增单条文字的明确句式，例如「在图片上添加文字『SALE』字号72，红色」，点击位置后使用 PhotoCraft 原生 type.create 生成可编辑 Type 图层。中文文字「新品上市」已通过 CLI 显示检查。文字暂不支持复合指令、任意字体和多段排版；其他命令目录项未自动开放。详见 docs/PHOTOCRAFT_COMMAND_ADAPTER.md 和 IMG-025、IMG-026、UI-024。

2026-10-15 通用语言指令方案 M1（主体/背景目标 + IR/缺口分拣 + 评测集 v0）：

- **新目标**：目标字典新增 主体/前景/商品/产品 → `subject`、背景 → `background`。两者对任何图片可用：选区由已验证的 rembg 主体蒙版 Provider 直接生成（`select.loadSelection`），背景在蒙版后追加 PhotoCraft 原生 `select.inverse` 反选。**不需要用户画框**；画框/轮廓退化为可选的“进一步收窄”（蒙版 ∩ 框，`select.rect`/`select.lasso` intersect）。界面解析到这两类目标时自动切到 Provider 选区来源并清空旧画框；预览不再因缺画框而拦截。其他选区来源（object/manual/existing）对这两类目标会被桥接以 400 拒绝：「主体或背景编辑需要 AI 主体蒙版选区来源」。
- **防静默扩大**：调色句式的整图词（整张图片/照片…）作为 主体/背景 的定语时（如“整张图片的背景提亮”），快车道不再解析成整图调整——负向前瞻使整图词让位，交给模型通道并把校验豁免限定在“整图词+的+主体词”结构上；模型仍把范围搞错时按原校验拒绝。
- **L1 IR**：新增 `instruction-ir.ts`。`buildNLIntent` 把已验证计划转成开放意图（保留用户原话目标词、目标种类 named/subject/background/selection/whole-image、保护词、参数、来源与置信度），成功响应附带 `intent`/`intents` 字段（additive，不改变既有 UI 合同）。
- **L2 缺口分拣**：`analyzeNLInstructionGaps` 在快车道未命中时按 target/param/ambiguity/capacity 分型（颜色超范围、幅度缺失/超限、多操作、不可支持动词等），所有失败响应附带 `gaps` 与一句人话摘要，引导用户改写而不是笼统报错。
- **评测集 v0**：`instruction-eval.test.ts` 固定 53 条真实中文要求，每条标注应命中的通道：express（18，含 12 条主体/背景）、sequence（8）、model（4，快车道不猜但模型计划过独立法官）、model-reject（8，貌似合理的计划必须被否决）、gap（15，含“整张图片的背景”已知缺口）。`node scripts/photocraft/test_instruction_rules.mjs`（IMG-018）离线跑全部；IMG-005 经 tsx 跑同套文件。
- **桥接回归 IMG-044**：`scripts/photocraft/test_subject_background_targets.py` 用 CC0 猫图实测：无画框主体换灰（背景像素不变）、无画框背景压暗 -20（主体像素不变）、画框收窄只改框内主体、错误选区来源 400、产物为可编辑蒙版调整层且关闭后恢复原图。
- **边界不变**：一次复合编辑仍只允许一个局部选区步骤（subject/background 计入局部）；Provider 选区仍仅本机桥接执行，云端任务维持原提示；换色仍限局部（整图换色继续拒绝）。M2（serve 传输、连续滑杆、SAM+CLIP 接地）未开始；PhotoCraft 原生 `select.subject` 属引擎 AI，质量未验证，未接入，记录于 `../AI_Creative_Suite_Dev_Pack_v3/docs/photocraft-capabilities.md` 观察项。

2026-10-15～16 通用语言指令方案 M2+M3+M4（v2 修订 §12；2026-10-16 codex 交叉审核后按分层口径修订交付表述，见文末审核整改节）：

- **M2 serve 常驻会话**（`scripts/photocraft/serve-session.mjs`）：桥接从每请求冷启动 CLI 改为常驻 `serve` 会话（stdio JSON lines）。`runCli` 兼容面（`info/convert/run` 三种 argv 形状）保持现有 handler 不改；所有调用仍过同一串行队列（等价原 maxActiveRequests=1）；会话挂掉下一次调用自动重启。实测中发现并消化两个 serve 陷阱：其一，LayerId 空间不一致——serve 给每次 `doc.open` 从会话级递增计数器分配 LayerId（随打开次数增长），而冷进程每次分配确定的新 id；`layer.select/setProps/duplicate`、`paint.spotHealing` 等全部图层变更命令在 serve 里本就被禁用（这些计划恒走冷启动执行），所以 `info` 也固定走冷进程取 inspect，让计划里烘焙的 LayerId 与真正执行它的冷进程同 id 空间（曾试过「同路径文档 LRU 保活」方案，既治不了冷执行 id 失配，还会污染允许表缓存，已撤销）；其二，`engine.commands` 的 `enabled` 标志在任何文档打开时会把菜单命令翻成 `true`（UI 态），而 `engine.execute` 仍拒绝——允许表现在从无文档的 pristine 会话一次性读取缓存，ambient 命令（`file.placeEmbedded` 等 714 个）继续自动回退单次冷启动执行。
- **M2 滑杆交接**：默认值直接生成 PhotoCraft 原生调整层，`/v1/live/*` 会话（open/inspect/adjust/render/save/close）内滑杆改 `layer.setAdjustment` 原生参数、预览来自引擎全尺寸渲染。补充C 专项（IMG-050，`preview-consistency.mjs`，2026-10-16）实测：整图亮度、主体蒙版亮度（各含一次滑杆修改 12→37）与 sRGB ICC 嵌入输入三格中，滑杆预览、保存重开渲染、冷 CLI 导出**逐字节一致**；重开后调整层参数可编辑、蒙版保持；蒙版外 >6px 像素零改动，边界 2px 内 100/1,006,277 像素有 1/255 舍入差（预定义容差内，已解释）。覆盖范围限定：亮度调整 + PNG 输入 + 单次滑杆修改——对比度/色阶等其他调整类型、JPEG 输入、多次滑杆序列、非 sRGB ICC 未测；`live-adjustments.mjs` 的数值范围表从锁定 0.6.0 注册表抄录（Curves/按通道 Levels 不进滑杆面）。rembg 蒙版按源字节 sha256 缓存（`mask-cache.mjs`），重复预览不再每次付 ~25s 推理。
- **M2 云 LLM 解析道 + 默认策略表**：`plan-provider.ts` 经 Provider 抽象请求云端模型解析，应用前用同一 Provider 做 round-trip 蕴含核对，不蕴含则降级「解释确认」；密钥只经头部发送、错误文本过滤 `sk-` 串。真模型实测（2026-10-16，qwen-plus，IMG-052）定下信封契约：解析道 `response_format` 用 `json_object`（`json_schema` 对 25 字段 plannerSchema 实测输出劣化——漏 adjustment/amount、填无关默认值），模型精确计划会省略信封字段 `unsupported`，由 `reconcilePhotoCraftModelPlan` 对具体能力操作补空信封；`operation=unsupported` 不补，缺失的拒绝理由原样报错不得洗白。`default-strategy.ts`（L3b）实现「绝不向用户追问数字」：参数缺口按领域默认表补全直接出预览并聚焦对应滑杆，语义必需槽（文字内容、色阶黑/白场、画布/图片宽高，补充B 后另含换色目标颜色）例外；`route.ts` 响应携带 `defaults` 溯源与 `provider`（rules / rules-defaults / 云模型名），见 `route.test.ts`。
- **M3 SAM+CLIP 开放词汇候选**（`scripts/photocraft/parts-candidates.py`，loopback :4104，桥接唯一调用方）：SAM vit_b 量化 ONNX（编码器缓存）+ 网格解码去重 + Chinese-CLIP rn50 对中文名词排序，返回 top-K 候选（bounds/保守套索轮廓/softmax 分数）。解析到未知目标名词（屋顶/花瓣/左耳…）即进提议-确认环：补充A 整改后自动选中默认关闭（`TAU_AUTO_ENABLED=false`，决策抽到纯函数模块 `candidate-ring.ts` 并有单测）——候选分数是本批候选内的 CLIP 相对排名（softmax 归一），不是正确率，跨题材标注集校准完成前所有候选统一走一次人工确认（界面文案用「匹配分数」，遥测仍记 topScore 供校准）；保护名词同走候选环且任何分数都不自动。grounding 级联：文档上下文 → Provider 主体蒙版 → 开放词汇候选 → 手画框兜底，永远在。
- **M3 约束表重构**（`operation-constraints.ts`）：手写复合步骤顺序约束改为操作元数据表驱动的小引擎（每个操作声明 invalidates/requires，如 crop 作废选区坐标 → 只能放最后）。当前 19 种操作与旧手写约束逐字等价（错误文案保留，评测快照钉死）；新增操作先登记元数据。
- **M4 评测扩容**：金标准评测集 53 → 212 条（express 115 / gap 50 / sequence 17 / model 13 / model-reject 10 / sequence-reject 7），含 paraphrase、口语、英文混合、越界数值、保护清单、非商品域目标维度断言；数据抽到 `instruction-eval-cases.ts` 数据模块，解析器钉死测试与真引擎评测共用同一份。
- **M4 τ 校准回流 + 双轨遥测**：dev-bridge 新增 `POST /v1/telemetry` sink（JSONL 落盘+轮转）；`calibrate-tau.mjs` 按解析器分桶汇总确认环点击/撤销/应用率（本地快轨 vs 模型轨对比）、τ_auto 自动选中被人工推翻的比率按 top-1 置信度分桶、滑杆交接参数修改幅度分布，产出 `TAU_AUTO` 调整建议——阈值本身仍是常量，按 §10 月度人工评审后调整（换模型/调阈值必跑钉死评测）。单测 `test_calibrate_tau.mjs`（IMG-045）。
- **M4 批量配方线**（§12.3，P2-2 整改后补齐来源确认闭环）：`POST /workspaces/:id/photocraft-batch-recipes`（幂等 `requestKey`）把单图确认过的动作列表一键套整个目录（≤200 项目）：仅 13 种整图操作、1–4 步、画布类（旋转/翻转）必须最后；整批额度预检不足则整批拒绝，成功按张 reserve/commit、失败 refund 入 `workspace_credit_ledger`；重放比对迁移 0014 `photocraft_batch_requests` 落库的完整规范化内容（排序去重后的 project_ids + params）与首次 skipped 清单——含跳过项目的批次重放返回同一结果、不再扣费，只有同键不同内容才 409（隔离回归已覆盖）。Worker 逐步展平执行并做结构校验（旋转奇偶交换宽高、层数=前+调整数、参数多重集匹配），再按确定性 20% 抽样（排序后等步长取 id，状态端点返回同一份 `sampledJobIds`）做像素复检。原生侧 `batch --actions` 目录回放 QA：拒绝 out==in、原图字节不变、输出几何=镜像+旋转、亮度可见提升（IMG-046）。**界面确认工作流已交付（P2-2 闭环；R1/R3/R4 二轮复审后加固）**：「确认一次，套全目录」的确认以**服务端不可变快照**为准（迁移 0016 `photocraft_batch_confirmations`：源项目/版本、规范化步骤 + steps_digest、确认人取登录上下文、时间取服务端时钟、status active/revoked）——工作台勾选确认编辑计划时经 `POST /photocraft-batch-confirmations` 登记快照（登记失败回退勾选），批量入队只收 `requestKey/projectIds/confirmationId`（携带 steps/source 即 400），入队校验快照存在、未撤销、digest 复核通过、批次记录回指 `confirmation_id`，GET 状态带同一配方摘要与**原始单图确认时间**；单步计划同样必须勾选确认才能应用或开批量。R3：浏览器侧 `requestKey` 由确认引用+目标清单+批次序号经 FNV-1a 确定性派生（`batch-recipe.ts` `deriveBatchRequestKey`，8 条单测），丢响应重试/刷新恢复同键重放不重复扣费，确认勾选随配方或目标清单变化自动失效。R4：单图计费与批量入队统一「先锁账户行、再锁项目行」（批量内目标项目按 id 升序），并发同工作区+同项目不再有 40P01 死锁路径（集成并发断言）。工作台「批量配方」面板从单图已确认计划生成配方（`batch-recipe.ts` 纯转换：整图调整/色阶/画布最后一步、与单图绑定的操作给可读拒绝原因），展示配方来源、步骤清单、目标多选（≤200）、按张计费预估与跳过语义，勾选明确确认后一次性提交，随后轮询整批状态（排队/执行中/成功/失败计数、抽样复检清单、失败明细与积分退回说明如实展示）。迁移 0013/0014/0015/0016、隔离 HTTP/Worker 回归全绿；浏览器端到端点击回归未录（见未完成项第 1 条）。
- **M4 `commands --json` 注册表同步**（`sync-command-registry.mjs`，IMG-047/048）：导出锁定 0.6.0 的 851 命令，与 bridge/适配器/任务/Worker 的在用命令 diff——在用命令缺失或被禁用即 exit 1（纳入 pin+回归纪律），另产出按菜单分组的候选扩容清单（每个新命令仍须自建 validate/commands/verify 三段契约后才进 IR）。当前在用 40 个命令全部在位。
- **M4 评测接真引擎**（`live-eval.mjs`，IMG-049；P1-3 整改后按覆盖分层计数）：**引擎层** 145 条（express 115 + model 13 以评测集预置计划 + sequence 17 解析后逐步链式）逐条经 dev bridge 打真实 PhotoCraft 引擎：provider 目标走 4101 主体蒙版/4104 开放词汇，文字样式与投影走固定 Type 层探针源，sequence 逐步把上一步 `.pcraft` 作为下一步输入；执行矩阵按 plan 形状给选区几何（provider∩作用框/手画框/无选区/点击点位），执行前按默认策略表补槽（与生产链路一致）。**解析层** 67 条（gap 50 / model-reject 10 / sequence-reject 7）的断言与 `instruction-eval.test.ts` 相同，但在脚本内实际运行后才计数（此前版本读表即计通过，P1-3 已改）。model 通道执行的是预置计划、**未走运行时云解析+judge round-trip**（该链路由 `cloud-roundtrip.mjs`（IMG-052）单独接真实模型覆盖，本脚本不重复计费）——它验证的是「该计划引擎可执行」，不是「自然语言端到端」。计划含中文时走 `x-acs-plan-b64`（HTTP 头只收 latin1，与候选词 b64 同约定；工作台 `page.tsx` 同步修复了中文文案/保护名词计划的同一隐患）。报告落 `.tools/photocraft-serve-qa/live-eval-report.json`，`coverage.notRun` 显式列出不在本脚本范围的项（云道 round-trip 由 IMG-052 专项覆盖、跨题材真图 grounding、预览/导出逐像素一致性由 IMG-050 专项覆盖、§7 指标），任一失败 exit 1。2026-10-16 整改后全量结果：引擎层 145/145、解析层 67/67（分层口径，共 212 条）。

2026-10-16 codex 交叉审核整改（`docs/PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 8 条逐条结论；代码修复均带回归测试）：

- **P1-1 自动选中的 React 闭包旧值 bug（确认，已修）**：`setPartCandidates` 后同一异步 tick 里调 `choosePartCandidate(0, true)`，闭包里读到的还是旧 state，自动选中实际从不生效。修复：`choosePartCandidate` 增加 `parts` 必传参数，所有调用点传入刚构建的候选数据；决策逻辑抽到纯函数模块 `candidate-ring.ts`（新增 7 条单测覆盖低于/等于/高于阈值、protect 永不自动、默认关闭、空候选、auto/override/confirm 出口）。
- **P1-2 无「把/将/让」引导词的目标缺口是死路（确认，已修）**：`extractTargetPhrase` 增加主语开头回退（「屋顶提亮一点」→屋顶），属性名词（亮度/对比度…）与客套前缀（帮我/请…）不算目标；短语缺失时界面给出改写建议与手画框/套索路径，遥测记 `gap-no-phrase`。`instruction-ir.test.ts` 新增 5 个断言、`route.test.ts` 新增主语式 422 带 phrase 的钉死。
- **P1-3 评测宣称超出实际运行内容（确认为交付口径问题，已分层整改）**：原「212/212」把 67 条解析器钉死通道按「读表即通过」计数。整改：`live-eval.mjs` 重构为分层报告——解析层 67 条的断言在脚本内实际运行（与单测相同断言，失败照实入清单）；引擎层 145 条如实标注为「预置计划 → 引擎执行」，model 通道未走运行时云解析+judge（该链路 2026-10-16 起由 `cloud-roundtrip.mjs`（IMG-052）在真实 qwen-plus 上覆盖）；报告新增 `coverage`（engineExecuted / parserPinnedInScript / notRun）字段显式列出未运行项。2026-10-16 整改后：引擎层 145/145、解析层 67/67。
- **P2-1 含跳过项目的批量重放误判冲突且丢 skipped（确认，已修）**：重放原只比对已建作业行的 project_id 集合，跳过项缺失使子集看起来像「同键不同内容」。迁移 0014 新增 `photocraft_batch_requests` 落库完整规范化内容（排序去重 project_ids + params）与首次 skipped；重放在账户行锁内按 canonicalJson 比对——同键同内容返回原作业与 skipped、不再扣费，同键不同内容 409。隔离回归新增 batch-with-skip 场景（首入含跳过 → 1 作业 + skipped + 按未跳过张数扣费；重放同结果同余额；换 steps / 换 projectIds 均 409），跑在真实 VM Postgres+S3 上通过。
- **P2-2 批量线宣称「一键套目录」但无界面（确认为交付口径问题，先降级表述、后补闭环）**：整改时先把文档降级为「API 基础设施，界面确认工作流未完成」；随后按整改要求补齐来源确认闭环——服务端强制 `source:{projectId,version}`（单图确认环的源项目+不可变版本），入队校验其仍有效、确认人/时间落库（迁移 0015）、配方快照与 skipped 随批次记录，GET 状态带来源；Web 入口从单图确认结果发起（`batch-recipe.ts` 转换 + 工作台批量面板），展示目标数量/预计积分/跳过项，勾选明确确认后一次提交，进度/失败明细如实展示。积分仍按张走既有账本，授权不变。见上文 M4 批量配方线条目。
- **补充A 候选分数≠正确率（确认，已修）**：`TAU_AUTO_ENABLED=false` 成为显式常量与默认（跨题材标注集校准前不自动选中），界面「置信度」改「匹配分数」并注明是本批候选的相对排名；τ 校准遥测字段保留。
- **补充B 换色缺目标色静默默认灰色（确认，已修）**：目标颜色进语义必需槽（默认策略表 recolor 行 `defaults:{}` `required:["color"]`，删除灰色补全与溯源）；route 在云道之前对 color 缺口 422（缺色与超出色板两种）；云解析提示词同步改为「换色未说明目标颜色 → unsupported，不得代选」；界面弹选色行（黑/红/蓝/绿/灰），点选后原话拼接「，改成X色」重解析。`default-strategy.test.ts` 的灰色默认用例改为 required 槽用例，`route.test.ts` 新增两条。
- **补充C 预览=最终宣称无逐像素验证（确认，先降级后补实测）**：整改时先把文档降级为「预览来自真实引擎渲染，逐像素一致性未验证」；随后落地专项 `preview-consistency.mjs`（IMG-050）补实测——整图亮度、主体蒙版亮度、sRGB ICC 嵌入三格（各含滑杆 12→37 修改）的滑杆预览/保存重开渲染/冷导出**逐字节一致**，重开后参数可编辑、蒙版保持、蒙版外 >6px 零改动（边界 2px 内 100 像素 1/255 舍入差，容差预定义）。宣称升级为「实测矩阵内 preview=save-reopen=export 逐字节一致」；未覆盖的调整类型/输入格式如实列出（见上文 M2 滑杆条目）。

2026-10-17 第六轮整改 C 项（候选环从「框找对」到「实际选区正确」，全量见 `PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 第六轮）：

- **候选响应带真实像素 mask**：`parts-candidates.py` 每候选必填 `mask_png_b64`（8bit 灰度 PNG，分辨率=服务空间 width/height，与 bounds/outline 同坐标系；实测 36 候选 1.3–12.9KB）；`grounding-contract.mjs` 严格校验（base64+PNG 魔数+IHDR 尺寸==响应+bit8+灰度）。
- **确认候选后走原生 mask 选区**：新桥路由 `POST /v1/selection-mask`（raw PNG 校验落盘→maskId）+ `/v1/instruction` mask 法头；`selection-adapter` 复用 provider 蒙版同款 `loadMaskSelection`（placeEmbedded→select.loadSelection(red)→layer.delete+探针）。**轮廓套索保留为自动降级**：解码/上传/尺寸校验/探针任一失败即退回 outline+提示，lasso 永不删除（ADR-0012：不造平行像素引擎）。
- **坐标契约**（五条，代码注释+文档双记录）：mask/bounds/outline 同处服务空间（exif_transpose+≤1024 LANCZOS）；EXIF 两端归一；浏览器 createImageBitmap→sampleSize 平滑缩放→≥128 二值；桥端强校验 mask 尺寸==文档尺寸（失配 400→降级套索）；评测侧 bilinear 近似+端到端实测钉真路径。
- **像素级 GT 评测 IMG-054**：12 个单实例代表目标的人工复核像素 GT（`qa/fixtures/photocraft-grounding/masks/`，方法与非独立性声明在 manifest.json——SAM 家族起草+两轮 VLM 叠加图复核+人工笔刷+开发者终审，不声称与被测服务独立）；top-3 逐候选 IoU/漏选/越界 + `boxHitMaskFail`。实测 best maskIoU mean 0.471、≥0.5 5/12（花朵 0.986/帽沿 0.953 好；屋顶 0.000/花蕊 0.011 差）；**l-beck 窗框 IoU 0.529 而 mask IoU 仅 0.296**——框级命中绝不等于精修就绪的实证。端到端真桥：.pcraft 保存重开 hasSelection=true、mask 外改动 0/1412664。**TAU_AUTO_ENABLED=false 不变**；候选环浏览器点击回归未录（第 1 条）。

2026-10-17 第七轮整改 D 项（候选召回与自然语言入口——仅入口改进，不引入新模型，全量见 `PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 第七轮）：

- **画框限定候选（box 提示模式）**：`:4104` 收 `X-Acs-Prompt-Box`（归一化框，exif 同侧归一）时以框+中心+四分位点提示替代 8×8 盲网格（同一 `vit_b.quant` SAM + 中文 CLIP，过滤/去重/top-3 不变，框引导不裁剪）；无头时与旧版逐字节一致。工作台候选环在确认前/后都有「点击/画框限定重新圈选」，目标缺口面板有「点击/画框限定后智能找」——用户拖画（任意工具、等待态）→ `normalizePromptBox`（<画面 2% 不猜不缩放，提示重画）→ 带框重请求 → 环标题标「（已按画框限定重圈）」。
- **歧义与固定词不再默默猜**：方位词/数量词/部件歧义（`classifyTargetPhrase`）与前两候选位置分散（`topCandidatesSpread`）会在环消息里追加「点准编号或画框重圈」消歧提示；旧「耳朵启发式」静默切 provider 删除，固定 `selected-area` 词无现成选区/轮廓/作用框时改落目标缺口面板（三入口 + 「目标位置不替你猜」消息），有原生选区则照旧直接执行。入口判定纯函数 `target-entry.ts` + 7 单测。
- **IMG-055 对照评测（63→64 自动化）**：12 个 IMG-054 GT 目标，标注框当「用户画框」模拟（±5%，报告声明）：grid top1 IoU mean 0.3072（≥0.5 3/12）vs **box 0.6877（9/12）**，Δtop1 改善 8/持平 3/回退 1（门 −0.154 如实），mean +0.3805，耗时 12.7s→4.4s；花朵 grid「正确 mask 被 CLIP 排后」(top1 0.000/best 0.986) 在框模式下 top1 0.985。**网格仍是默认，框模式仅用户画框时触发；不据此切默认服务、不开自动选中**。

2026-10-17 第七轮整改 E 项（真实浏览器全链路验收 + 生成模型同图 A/B，全量见 `PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 第七轮·续；产物 `artifacts/photocraft-e1|e2-2026-10-17/`）：

- **E-1 第七轮浏览器记录（已由复审修订）**：headless Chromium 当时四案例 `failures=0` 只证明交互和预览生成成功，未验证花瓣保留花蕊或左耳仅覆盖耳朵。文中原称“IMG-056 浏览器验收”有误：IMG-056 实际登记 E-2 生成 A/B；原 rig 在 gitignored `.tools` 中。目标缺口消息覆盖缺陷已由 `parseStatusMessage` 修复；复审后的可复跑 IMG-057、花蕊 PhotoCraft 蒙版笔刷精修、左耳人工语义验收见下方补录及 `PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 文末。
- **E-2 生成 A/B（仅记录，不改默认）**：同图 1254² 帽子，remove/background × qwen-image-2.0-pro/3.0-pro 四臂全成功（2.0 快 3-4.5×；3.0 局部纹理略优但 2048² 全局重渲染致非目标区漂移更大）；mask 接口 `qwen-image-edit` 探针 404 如实记录；**两模型 background 的帽子区漂移 13.8-18.0/255（VLM 判「帽子被改」定量坐实）→ 生成模型做不到主体逐像素保持，印证「原生调整层优先」架构**（同图原生路径帽子区外精确 0）。输出尺寸均 ≠ 源图（1024²/2048²），逐像素组合评测须在生产 compose 后做。`IMAGE_LOCAL_EDIT_MODEL` 与候选服务默认不动。

2026-10-17 Codex 复审修复（详见 `PHOTOCRAFT_E1_REVIEW_FIXES_2026-10-17.md`）：画框模式现在将候选蒙版裁到框内，并剔除原蒙版框外溢出 >25% 的截断候选；IMG-055 重跑 box top-1 mask IoU mean 0.6916。仓库内新增可复跑浏览器 IMG-057 与区域差分 IMG-058；花瓣首次预览误染花蕊，PhotoCraft 蒙版笔刷人工接力后花蕊平均变化 0.261/255；左耳框外隔离达到 0.021/255，主要耳面完成换色，但**耳根仍有硬边，UI-038 原尺寸视觉验收未通过**，需继续精修。IMG-056 A/B 现在要求四个计划臂全部成功才算完整比较。`qa:validate` 67 automated / 42 manual；不改任何生产默认。

未完成项清单（此前文档未显式列出，现统一口径；第 2、3、4 条已完成，第 1 条剩浏览器端到端补录，第 5 条未测量）：

1. ~~批量配方的界面确认工作流（入口 UI、整批预览、进度/结果界面）——P2-2~~ **已完成（2026-10-16；R1/R3/R4 二轮复审后加固为服务端确认快照口径）**：服务端不可变确认快照（0016，入队只认 confirmationId 并复核 digest）+ 确定性 requestKey + 统一锁序 + 工作台批量面板（配方来源/步骤/目标多选/积分预估/明确确认/轮询进度与失败明细）；浏览器端到端点击路径待 UI-xxx 浏览器回归补录，接口与转换逻辑已有隔离回归。
2. ~~运行时云解析 + judge round-trip 的真模型链路验证（dev 无云密钥，仅 Provider 抽象的注入单测与预置计划引擎执行）——P1-3~~ **已完成（IMG-052，2026-10-16）**：DASHSCOPE qwen-plus 真实链路（`.env` 密钥）——新脚本 `cloud-roundtrip.mjs` 把 23 条（model 13 + model-reject 10）全部走生产路由分拣，17 条真实调用云端完成 parse→reconcile→硬校验→judge 蕴含核对：cloud-entailed 1、降级解释确认 12、云道拒绝 4（全部为 model-reject，无一越界），验收 `p1_3CloudRoundTrip`/`modelRejectNeverEntailed` 双通过，exit 0。顺带修复一处生产缺陷：云通道此前从未把 plannerSchema 传给端点（只传 json_object），qwen-plus 精确计划省略信封字段 `unsupported` 导致云道全量报「模型未返回完整的编辑计划」；实测 json_schema 对 25 字段大 schema 输出劣化，最终维持 json_object + reconcile 补信封（operation=unsupported 不补，拒绝理由不得洗白）。12 条降级解释确认为安全侧行为，一次确认率仍不在本轮推出（见第 5 条）。
3. ~~跨题材（房子/花/家具等非商品域）真图与开放词汇 grounding 质量评估，及 τ_auto 校准标注集——补充A~~ **已完成（IMG-053，2026-10-16；第五轮按 codex 复审修正门槛与响应契约）**：`qa/fixtures/photocraft-grounding/`（11 真图 5 题材 36 目标，来源/许可入 `provenance.json`，标注方法与两轮复核过程记录在 annotations.json `method`）+ `grounding-eval.mjs`（tier `live-grounding`，`pnpm qa:grounding`）打真实 :4104 服务。实测：top-1 31%、top-3 42%、无正确候选 58%（flower 0% top-1 最弱，product 67% 最好）；τ 扫描显示候选分数普遍 0.35–0.46，产品 τ=0.75 下无一自动选中；预先写死的启用门槛（各题材**目标 ≥30、该 τ 下实际自动选中 ≥30 且误自动选中率 ≤10%** 三条件同时满足——零/少自动选中按证据不足处理，不得当作安全凑 enable）未达 → **TAU_AUTO_ENABLED 维持 false**，全部编辑经确认环完成。指标口径 `grounding-metrics.mjs` 纯函数 + `grounding-contract.mjs` 响应/fixture 契约，共 30 条单测钉死（含模拟服务注入缺高度/负宽框/非法轮廓/no-regions/429/非 2xx）。要启用自动选中需先把各题材样本扩到 ≥30 并累积 ≥30 次实际 auto 事件再评估；显著大物体（整房/整猫/帽子）命中 0.77–0.96、部件级（屋顶/花蕊/猫脸）普遍失败的结构性发现见 `PHOTOCRAFT_M2_M4_CODE_REVIEW_FIXES_2026-10-16.md` 第四、五轮。
4. ~~滑杆预览 vs 保存重开 vs 导出文件的逐像素一致性专项对比~~ **已完成（IMG-050，2026-10-16）**：亮度矩阵内逐字节一致；剩余子项（对比度/色阶等调整类型、JPEG 输入、非 sRGB ICC）可按同一脚本扩格。
5. 方案 §7 量化指标（主体级自动率 ≥90%、一次确认率、越界拦截率 95% 等）未测量，不作为已验证结论。
