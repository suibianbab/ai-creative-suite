# PhotoCraft Capability Watchlist

2026-10-10: ADR-0012 supersedes the earlier native-first classification. `INTEGRATE` below is the target routing and still requires a working PhotoCraft bridge. The native implementations remain development/legacy utilities; they are not the long-term primary editor.

| Capability | Business Need | Decision | Preferred Provider | Fallback | Notes |
|---|---|---|---|---|---|
| Transform | High | INTEGRATE | PhotoCraft | legacy native preview | Core editor operation |
| Crop | High | INTEGRATE | PhotoCraft | legacy native preview | `image.crop` verified in local 0.6.0 bridge with editable source pixels retained |
| Basic Text | High | INTEGRATE | PhotoCraft | legacy native preview | Core editor operation |
| Basic Adjustments | High | INTEGRATE | PhotoCraft | legacy native preview | Brightness, contrast, saturation, exposure, vibrance, shadows and highlights use native editable adjustment layers |
| Masked Product Recolor | High | INTEGRATE | PhotoCraft | AI provider / legacy native preview | Verify preservation of labels, texture and shadows |
| Basic Shadow | High | INTEGRATE | PhotoCraft | legacy native preview | Verify editable source |
| Remove BG | High | AI_PROVIDER | AI | simple mask | Ecommerce critical |
| Generative Fill | High | AI_PROVIDER | AI | unavailable | Do not reimplement |
| Curves | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Levels | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Advanced Mask | Medium | INTEGRATE | PhotoCraft | simple native mask | Beta |
| Semantic fine-hair/fur segmentation | High | AI_PROVIDER | Existing BiRefNet mask into PhotoCraft selection | PhotoCraft native tools and mask brush | 0.6.0 and isolated 0.7.0 native selection failed cat-fur visual QA. Provider-to-native editable mask passed one browser case; premium fine-fur quality remains pending |
| Layer Effects | Medium | INTEGRATE | PhotoCraft | rasterized preview | Beta |
| PSD Import | Medium | INTEGRATE | PhotoCraft | flattened import | Beta |
| PSD Export | Low/Medium | INTEGRATE | PhotoCraft | none | Beta |
| Smart Objects | Low | WAIT | - | - | Do not build now |
| Advanced Channels | Low | WAIT | - | - | Not ecommerce MVP |
| Liquify | Low | WAIT | - | - | Not ecommerce MVP |
| Professional Color Management | High | INTEGRATE | PhotoCraft | WAIT | Display P3 ICC retention and sRGB conversion verified across PNG/JPEG/WebP/TIFF/PSD; CMYK/HDR/soft proof not verified |
| Advanced Brush Engine | Medium | INTEGRATE | PhotoCraft | WAIT | Use editor tools, do not duplicate |

Before adopting a new PhotoCraft release, add current upstream status, pinned version, compatibility results and migration notes.

2026-10-12 猫耳灰色样片：Pinned PhotoCraft 0.6.0 的原生 Hue/Saturation 调整层、主体蒙版与耳朵套索交集、`paint.stroke` 蒙版画笔构成可编辑精修链路。耳根下方指定检查框的最大通道平均改动由 6.79 降至 3.26，耳内采样点保持换色。本例证明 PhotoCraft 蒙版精修可减少溢色；更多毛发和不同背景样本尚未完成商业验收。见 `qa/IMG-019-2026-10-12.md`。

2026-10-12 点提示评估：PhotoCraft `select.quick`、SAM 1、SAM 2.1 的正负点（含范围框）在同一猫耳图上均未达到上述基线；该能力暂列 `AI_PROVIDER` 的候选研究，不接入默认桥接、不替代 PhotoCraft 原生蒙版精修。见 `qa/IMG-020-2026-10-12.md`。

2026-10-15 选区命令观察：`select.inverse` 已进入正式桥接（背景目标 = rembg 主体蒙版反选，IMG-044 回归）。PhotoCraft 0.6.0 原生另有 `select.subject`（引擎内 AI 主体选择），按 ADR-0011 纪律属未验证引擎 AI：未接入默认桥接，列为 INTEGRATE 候选，需先与已验证 rembg Provider 做同图质量对照，通过前不得替代现有主体蒙版链路。

2026-10-16 入口与纪律更新（通用语言指令方案 M2–M4；同日 codex 审核整改后口径）：桥接传输改为常驻 `serve` 会话（滑杆交接直接改原生调整层参数、预览来自引擎全尺寸渲染；IMG-050 专项实测整图/主体蒙版亮度含滑杆修改与 sRGB ICC 输入格的预览/保存重开/冷导出**逐字节一致**，重开后参数可编辑、蒙版保持——覆盖范围限亮度+PNG，其他调整类型/JPEG/非 sRGB ICC 未测），ambient 命令自动回退冷启动；实测发现 serve 两处行为——LayerId 由会话级计数器分配（与冷进程 id 空间不一致，`info` 固定走冷进程取 inspect 对齐）、`engine.commands` 的 `enabled` 标志随文档打开翻转（engine.execute 仍拒绝，允许表从无文档 pristine 会话读取缓存）——已分别在 serve-session.mjs 内消化，调用方无感。原生 `batch --actions` 已接批量配方线（按张入 Credit Ledger、确定性 20% 抽样像素复检，IMG-046；2026-10-16 P2-2 整改补齐来源确认闭环，同日 codex 二轮复审 R1/R3/R4 后加固为服务端确认快照口径——批量入队只认 `confirmationId`（迁移 0016 不可变快照：源项目/版本+步骤摘要+确认人/真实确认时间，digest 复核、撤销即拒），浏览器侧 requestKey 确定性派生（同键重放不重复扣费），单图与批量入队统一「先账户后项目」锁序；工作台批量面板从单图确认计划发起：配方来源/步骤/目标多选/积分预估/明确确认/进度与失败明细，接口与转换有隔离回归，浏览器端到端点击回归待补录）；云 LLM 解析道在真实 qwen-plus 上闭环（IMG-052 `cloud-roundtrip.mjs`，tier `live-model`）：23 条评测走生产路由分拣、17 条真实 parse+judge round-trip，拒绝案例无一被判蕴含；实测定下信封契约——解析道 `json_object` + `reconcilePhotoCraftModelPlan` 补缺失的 `unsupported` 信封（json_schema 对 25 字段 plannerSchema 实测输出劣化，弃用）；`commands --json` 注册表同步脚本纳入 pin+回归纪律（在用命令缺失/被禁用即 exit 1，IMG-047/048），候选扩容清单按菜单分组产出，新命令仍须先过 validate/commands/verify 三段契约。`select.subject` 维持上段观察结论不变。
