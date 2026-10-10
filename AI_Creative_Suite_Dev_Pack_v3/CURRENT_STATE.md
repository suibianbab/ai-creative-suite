# Current State v2

Current phase: Phase 0 Foundation plus early Image Studio editing and quality spikes, 2026-10-10. Baseline audit: `REPO_AUDIT.md`.

当前进展：
- `D:\codex\animate` 已建立 Git 和 pnpm monorepo
- Next.js Web shell、NestJS API `/health/live`、共享类型包、CI、Biome、TypeScript 检查已落地
- 本机未安装 Docker；提供的虚拟机 Docker 已运行独立的 `acs` 开发栈（PostgreSQL 17、Redis 7、RustFS S3），连接与对象读写均已验证，见根目录 `docs/VM_INFRASTRUCTURE.md`
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 已通过；Web 首页、API liveness 均返回 HTTP 200
- 本机到虚拟机的 SSH 开发隧道已跑通；API readiness 对 PostgreSQL、Redis、S3 bucket 实测均为 `ok` 并返回 HTTP 200，未配置依赖时返回 HTTP 503
- 早期质量验证见根目录 `docs/GOLDEN_SPIKES.md`
- 租户边界、原始素材不可变、幂等任务、积分账本的待实施数据约束见根目录 `docs/adr/0001-core-data-boundaries.md`
- 早期 Image Studio 本地原型已可导入 PNG/JPEG/WebP、放置图片和文字图层、拖动与数值变换、撤销重做、切换 1:1/4:5/16:9 画布并进行基础重排、导出 PNG；现含浏览器本地项目保存、非破坏裁切、自动抠图和可修正 Mask。尚无服务端项目持久化、生成式修图或产品级批处理，不能视为图片质量目标达成
- Blender GPU 管线验证：Windows 本机已部署便携版 Blender 5.2.2 LTS，安装包 SHA-256 与官方校验值一致。RTX 4060 的 Cycles OptiX 已渲染合成瓶体的 hero 与近景两张 1280×720 PNG，耗时分别约 5.5 秒；可编辑 `.blend`、图片、日志和报告在根目录 `artifacts/blender-gpu-spike-2026-10-09/`。这是 GPU 管线 smoke test，不代表真实商品广告质量已达标；仍需准确、授权的 3D 模型执行 Golden Spike。Ubuntu 虚拟机仅看到 VMware SVGA II，继续承载基础服务，见根目录 `docs/GPU_RENDER_STRATEGY.md`
- Blender 动态管线验证：同一合成瓶体已在本机 RTX 4060 上完成 48 帧 OptiX 动画渲染，并合成 2 秒、24 fps 的 H.264 MP4；源 `.blend`、逐帧 PNG、视频与 QA 记录位于根目录 `artifacts/blender-motion-preview-2026-10-09/`。这是 640×360 低分辨率管线预演，不代表商品广告质量达标
- Image Studio 本地项目保存：原图和 ImageDocument 分库存入此浏览器 IndexedDB；浏览器实测合成产品图与文字图层保存、刷新、重新打开后均恢复，画布截图核对通过。当前为手动保存，不会同步至 API / VM，也没有多租户授权；浏览器数据清除会删除本地项目
- Image Studio 非破坏裁切：新增 1:1、4:5、16:9 与原图像素坐标裁切，ImageDocument 保留原图引用与裁切矩形，支持撤销、重做、恢复原图。浏览器实测 1:1 裁切画面，保存刷新后裁切参数恢复；PNG 导出前会检查素材是否存在并校验编码结果尺寸。后续 Mask QA 已核对实际下载的白底与透明 PNG 文件
- 图片质量 Golden Spike 首轮：根目录 `artifacts/image-quality-spike-2026-10-09/` 保存 5 张有来源与哈希的公共领域博物馆实物原图、BiRefNet general-lite 蒙版、透明/白底导出、两种版式和视觉 QA。代码只用模型生成 Alpha，输出 RGB 逐像素保留原图；瓷器镂空与玻璃透光仍失败。该组不包含真实电商密集包装文字、透明包装或电子产品，不能视为电商质量目标达标。首轮生成式抠图会重绘细节，已剔除。详见根目录 `docs/GOLDEN_SPIKES.md`
- Image Studio 蒙版修正已形成浏览器本地闭环：选择图片图层可导入与原图同尺寸的 PNG 灰度/透明蒙版，用擦除/恢复笔刷修改 Alpha；修正作为 ImageDocument 操作，支持撤销重做，原图与蒙版分别保存在 IndexedDB。浏览器实测瓷器样本笔刷 1 笔、撤销/重做、保存刷新重新打开，白底与透明 PNG 均实际落盘，透明文件四角 Alpha 为 0。复杂玻璃透光和全部镂空尚未达到成片质量
- 本机自动抠图开发链路现已接通：`remove-bg` 经 Capability Router 和 Web Provider Adapter 调用 Windows 回环地址 `127.0.0.1:4101` 的 BiRefNet general-lite 服务；浏览器实测自动生成瓷器蒙版、补画一笔、保存刷新重开。服务限制来源、类型、体积和像素数，不保存上传原图。它不是正式多租户 API；原有瓷器镂空及玻璃透光质量问题仍未解决，见根目录 `artifacts/image-quality-spike-2026-10-09/REVIEW.md`
- 20 图异常复核已完成代理样本测试：公共领域博物馆对象原图均留有来源与 SHA-256，20 张导出的 RGB 与原图逐像素相同。预览尺度分流结果为 8 张无明显问题、6 张需人工修正、6 张失败；透明/半透明玻璃、内部镂空、随物体保留的展台与阴影是主要问题。仅为代理数据，不满足真实电商产品 Golden Spike；详见根目录 `artifacts/image-quality-batch-2026-10-09/REVIEW.md`
- 蒙版修正窗口新增棋盘、白、黑及高对比洋红背景预览，只用于 QA，不写入 ImageDocument 或导出。缩放时预览画布实际分辨率随之提高，最高为原图尺寸；浏览器实测 4× 对应瓷器原图 3200×4000 backing canvas，滚动区域居中且可检查真实细节。洋红底露出上沿灰色残留，切换背景不增加或改动蒙版笔数。它改善人工发现异常的效率，未自动修复镂空或透明材质
- 图片质量验收流程新增独立 `review.json`、原图 SHA-256 绑定、并排原图/白底/高对比预览、异常分类、检查项、人工修正计时与报告。浏览器本地审核页可通过回环服务验证后保存至项目并留前版备份；20 图代理样本已迁移，仍为 8/6/6，未把未计时修正记录为 0。真实电商素材接入要求五类样本和逐张使用权依据；缺项、原图变更或缺少品牌场景等输出会阻断验收结论。见根目录 `docs/IMAGE_QUALITY_REVIEW.md`
- 已从 Wikimedia Commons 收集五类真实商品照片，原图、来源页、CC0 照片许可说明与 SHA-256 位于根目录 `artifacts/image-ecommerce-commons-2026-10-09/`。此组含第三方商标，仅限内部质量验证，不能直接作为对外品牌广告素材。BiRefNet 已生成抠图、白底和双版式；预览分流 1 张通过、3 张需修正、1 张透明材质失败。背包照片的 EXIF 方向问题已在内存解码时修复，原图未改动。仍需品牌自有图、全尺寸人工复核、实际修正耗时与品牌场景，详见根目录 `docs/IMAGE_QUALITY_REVIEW.md`
- 洗发水花瓣与镜头地面倒影已形成独立修正版蒙版，附带输入/输出哈希与 Alpha 改动记录，原图和初版蒙版保持不变。两张蒙版在 Image Studio 导入、预览、保存、刷新重开均通过；重新裁切取景后下载透明与白底 1080 方图并检查角像素。修正版属于内部技术预览；脚本耗时不计作人工笔刷修正时间，透明瓶失败与品牌授权等发布门槛未解决。见根目录 `artifacts/image-ecommerce-commons-2026-10-09/CORRECTION_REVIEW.md`
- Image Studio 附加蒙版时现会按可见主体边界自动取景，裁切与图层变换作为单次 ImageDocument 操作保存，可一键撤销/重做；既有蒙版可用“按主体取景”重算。用两张 Commons 修正版蒙版浏览器实测，透明 1080 方图均已导出并检查主体边界与透明角像素；原图引用不变。该功能解决留白和商品过小问题，不修复蒙版本身的反光、透明或标签质量。见 `artifacts/image-ecommerce-commons-2026-10-09/CORRECTION_REVIEW.md`
- 透明材质对照：另取 Commons VRT 确认自由使用的白底玻璃香水瓶照片（非 CC0，且品牌权利未清），以相同 BiRefNet 模型生成蒙版并在 Image Studio 分别导出白底、深底 1080 方图。白底为可用的技术预览；深底中玻璃内部仍保留原图浅色透射，跨背景失败。原图和蒙版未覆盖，来源、哈希、测量和实际浏览器导出见根目录 `artifacts/transparent-material-2026-10-09/REVIEW.md`。此结果要求把“白底同背景可用”与“任意场景换背景可用”分别验收。
- Blender 实物类型模型 Golden Spike：下载并校验 Poly Haven CC0 复古相机 2K 模型（2 个网格、26,987 三角面、4 材质、12 张贴图），在 Windows RTX 4060 上以 Cycles OptiX 输出 1600×900 hero 和镜头特写、72 帧 3 秒 960×540 H.264 运动样片，保留可编辑 `.blend`、原始素材、哈希、逐帧文件与 QA。两张静帧渲染分别 9.047/10.320 秒，动画逐帧 228.720 秒。它证明真实贴图模型的材质、灯光、镜头与本机渲染可行；模型上有第三方标识，且不是客户确认的精确商品模型，仍不能作为可发布广告验收。详见根目录 `artifacts/blender-product-spike-2026-10-09/REVIEW.md`。
- 无客户模型时的广告流程验证：原创虚构 FORM 01 香氛瓶已按先分镜后制作的流程完成程序化建模、可编辑 Blender 场景、72 帧双镜头 Cycles OptiX 渲染、文字、原创合成音效和 6 秒 1280×720 H.264/AAC 视频，逐帧与关键帧 QA 已记录。Blender 执行约 381 秒；成果属于简洁影棚广告技术样片，不能证明真实商品还原或高端多镜头广告上限。首版合成采用 Pillow/FFmpeg，后续 Remotion 双尺寸样片见下一条。详见根目录 `artifacts/fictional-product-ad-2026-10-09/REVIEW.md`。
- FORM 01 适配与 Remotion 验证：9:16 镜头独立在 Blender 重新取景，弧形影棚背景消除预览中地面接缝；新增 `@acs/remotion-engine` 本地样片合成包，固定 Remotion 4.0.534，分别导出 1280×720 横版与 720×1280 竖版 6 秒、144 帧 H.264/AAC。两版关键帧、最终编码视频与音轨检查通过；竖版底部文案遮挡经调整重渲。素材以副本暂存，不改原渲染文件。当前仅为本地合成 Golden Spike，尚无自有 MotionDocument 到 Remotion 的生产适配、任务调度与用户资产授权。详见根目录 `artifacts/fictional-product-ad-2026-10-09/REMOTION_REVIEW.md`。
- Asset Foundation 开发基线：开发虚拟机 PostgreSQL 已执行首个迁移，建立组织、工作区、Asset 和不可变原件 Blob 的租户约束；内部服务向 RustFS 写入新对象键，并按租户范围读回和校验 SHA-256。一次性 schema + 真正 S3 对象的集成测试已覆盖跨租户拒绝、原件不可变、并发幂等、防覆盖。内部身份鉴权已有开发基线，但尚无正式浏览器登录、独立安全复核及 Asset HTTP 路由，也未连接浏览器 ImageDocument。见根目录 `docs/ASSET_FOUNDATION.md`。
- ImageDocument 服务端持久化开发基线：第二个迁移已应用到开发数据库；内部 `ImageProjectStore` 可将文档保存为不可变版本，并用预期版本号拒绝并发覆盖，素材引用通过组织/工作区组合外键约束。真实 PostgreSQL/RustFS 集成测试覆盖并发重试、跨组织/跨工作区拒绝、错误素材引用与历史版本不可变。浏览器仍只使用 IndexedDB；内部导入服务已有本地与服务端素材 ID 映射，但尚无正式浏览器登录和 HTTP 项目接口。见根目录 `docs/IMAGE_PROJECT_PERSISTENCE.md`。
- 身份与授权开发基线：第三个迁移已应用到开发数据库，建立用户、签发者/subject 映射、组织及工作区成员关系；内部 JWT AuthProvider 验证签名、签发者、API 受众和时效，AccessContextResolver 每次从当前数据库成员关系推导 TenantScope。随机 schema 与自签测试令牌的对抗测试覆盖伪造角色声明、无权跨组织访问、只读限制和即时撤销。正式浏览器登录与素材/项目 HTTP 路由尚未接入；对外启用前需要独立安全复核。见根目录 `docs/AUTH_BOUNDARY.md`。
- 本地项目导入开发基线：第四个迁移已应用到开发数据库，内部导入服务为 IndexedDB ImageDocument 引用的原图和蒙版创建服务端 Asset ID 映射，并保存新项目版本。随机 schema 与真实 RustFS 对象的集成测试模拟上传后项目保存失败，重试未重复建素材；跨组织导入隔离及映射不可变也通过。浏览器端尚未连接此服务。见根目录 `docs/LOCAL_IMAGE_IMPORT.md`。
- 开发 OIDC 联调：恢复 `info.txt` 后，在虚拟机独立 `acs-auth` Compose 项目启动 Keycloak 26.8.0，端口仅绑定虚拟机回环 8180；工作站 SSH 隧道已转发。官方 Quay 下载层在虚拟机超时，改由工作站导出官方镜像并流式加载到 VM；镜像代理与官方 manifest 比较一致。`acs-dev` realm 的真实访问令牌已通过远程 JWKS 验签、数据库工作区授权和成员撤销验证。凭据在本地 Git 忽略文件及 VM 受限文件中。仍是仅供开发的密码授权测试，没有浏览器正式登录或 HTTP 素材接口。见根目录 `docs/VM_INFRASTRUCTURE.md` 与 `docs/AUTH_BOUNDARY.md`。
- Image Studio 文字指令 MVP：本地 Qwen3 8B / Ollama 现能把部分口语要求翻译为画布、背景、商品位置、基础调色与标题操作；模型输出经规则和 ImageDocument 校验，先预览，再作为一个可撤销事务应用。混合不支持要求整体拒绝，原始商品 Asset 不变；模型不可用时保留明确句式的本地规则。尚无生成式局部修图、任意效果或专业色彩管理；云端正式 AI Gateway 仍未接入。见根目录 `docs/IMAGE_INSTRUCTION_MVP.md` 与 `qa/UI-007-2026-10-10.md`。
- Image Studio 基础调色闭环：图片图层现支持亮度、对比度、饱和度和近似曝光，参数写入 ImageDocument，支持撤销重做、规则式数值文字指令、浏览器本地和开发云端保存重开。自制四色图的浏览器导出像素已验证变化，原图引用不变；仍非专业色彩管理或任意自然语言修图，见根目录 `docs/IMAGE_BASIC_ADJUSTMENTS.md` 与 `qa/UI-006-2026-10-10.md`。
- Image Studio AI 换背景 Golden Spike：已加入独立背景图层的预览、取消、应用与单步撤销，原商品图和蒙版不被重绘；用合成泵瓶、蒙版和空影棚背景在浏览器完成 1080 方图导出及本地项目刷新重开。实际导出样片的接触阴影和光照匹配不足，未通过广告画质门槛。可选 OpenAI 图片 Provider 路由仅供开发环境使用，当前无密钥，真实生成调用未验证；正式 SaaS 还需认证、任务和积分链路。见根目录 `docs/IMAGE_BACKGROUND_REPLACEMENT.md` 与 `qa/UI-008-2026-10-10.md`。
- 后续补齐原生基础接触阴影：根据蒙版可见底边（而非留白图层框）对齐展台 Y 坐标，阴影颜色、浓度、宽度、柔和范围和偏移写入 ImageDocument；浏览器导出、单步撤销/重做、本地保存重开已验证。合成泵瓶展台接触区域较原导出平均暗约 35 RGB 级，视觉漂浮感减弱；仍非物理灯光匹配，也未通过真实商品广告画质验收。见 `qa/UI-009-2026-10-10.md`。
- 场景光照一致性辅助检查：对独立商品和背景图层采样，报告左右明暗方向、亮度差、商品高亮/暗部风险；在合成泵瓶浏览器项目实测双方均左亮，差值分别为 -23.1/-8.6。可选择 ±0.2 档曝光试调，先预览再应用，取消不改文档、单步撤销恢复原值。统计结果只作人工复核提示，不推断真实材质或色温，也不是专业色彩管理或广告画质通过。见 `qa/UI-010-2026-10-10.md`。
- Asset 孤儿对象清扫开发基线：新增按单个组织扫描的默认只报告命令；内部执行路径要求至少 7 天宽限、精确键格式、数据库引用复查及 S3 ETag 条件删除。随机 schema 与 RustFS 隔离测试验证只删除无引用测试对象，原件保持不变。自动生产清扫、正式保留策略和独立复核尚未完成，见根目录 `docs/ORPHAN_OBJECT_RETENTION.md`。
- 回归测试用例库：根目录 `qa/registry.json` 登记 15 个自动用例与 13 个手工验收场景；`qa:smoke` 接入 CI，VM 集成、真实 OIDC 和图片审核分组运行，输出含 Git 版本的本地 JSON 报告。基础回归 smoke 4/4、原有 integration 5/5、oidc 1/1、image-qa 1/1 已通过，新项目 HTTP 和真实 Keycloak 路由用例也单独通过；首次 integration 运行因旧 SSH 隧道失活为 3/5，报告保留，新隧道增加存活检测与重连。手工视觉验收与真实客户素材门槛尚未完成，见根目录 `qa/README.md`。
- Image Studio 云端项目开发闭环：新增 Keycloak 公开客户端 Authorization Code + PKCE 浏览器入口、受保护的项目/原件/导入 HTTP API、本地项目首次导入、云端列表/打开与增量素材和版本保存。开发工作区已配置；接口级真实 PostgreSQL/RustFS 回归覆盖匿名/跨租户拒绝、超大请求在缓冲前拒绝、重试幂等、原图字节、旧版本冲突和成员撤销，真实 Keycloak 令牌经 HTTP 项目列表验证通过。浏览器授权码登录、导入、增量图片上传、版本 2/3 保存以及刷新、重新登录后重开均已实测；第二个真实 Keycloak 账号已在 API 和浏览器中验证无法访问云端工作区；同浏览器资料的本地草稿与原图仍可跨账号打开，`UI-004` 失败，详见根目录 `docs/LOCAL_DRAFT_PRIVACY.md`。清除本页会话现同步关闭当前画布并释放内存原图引用，`UI-005` 浏览器验收通过；持久草稿方案见根目录 `docs/adr/0002-local-draft-privacy.md`，尚待选择和实施。Keycloak 自定义 `acs-api` 受众已修正，`AUTH-003` 新增实际示例令牌受众断言。独立新上下文安全复核和生产身份配置仍是对外开放门槛。见根目录 `docs/CLOUD_IMAGE_PROJECTS.md` 与 `docs/CLOUD_PROJECT_SECURITY_GATE.md`。

已完成产品与架构方向：
- AI Image Studio 一级产品
- AI Motion Studio
- 统一 SaaS Core
- Asset / Brand 共享
- ImageDocument / MotionDocument
- ArtCraft Adapter
- Octop AgentRuntime Adapter
- Cloud / Enterprise / AirGap
- Codex Risk Policy

下一步：
1. 解决共享浏览器资料的本地草稿隐私门槛 `UI-004`，完成独立新上下文授权安全复核、审计与密钥轮换演练；再设计正式成员管理与生产身份提供方，复核孤儿对象清扫和正式保留策略
2. 用获授权的真实商品样本运行 Image Studio Golden Spike，补充全尺寸边缘质量、标签/文字保真和人工修正耗时记录；对本轮透明材质及镂空失败类型建立专项回归
3. 以 FORM 01 双尺寸样片为基线，继续提升镜头/材质/节奏，并设计自有 MotionDocument 到 Remotion 合成的适配与渲染任务边界；真实商品还原另待准确模型或足够多角度素材及品牌方复核

## PhotoCraft integration status
- PhotoCraft is not a release blocker.
- Thin Native Editor owns essential basic editing only.
- AI providers own generative edits.
- PhotoCraft owns optional advanced traditional editing.
- Capability Registry / Router is required before deep integration.
