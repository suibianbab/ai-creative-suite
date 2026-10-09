# Product Context v2

产品从 Motion-only 升级为 AI Creative Suite。

两条一级产品：
1. AI Image Studio：面向电商的高频图片生产、修图、批处理、详情页和广告图。
2. AI Motion Studio：面向动画、视频、交互和 3D 的高价值内容生产。

Image Studio 是重要获客入口；用户积累的商品图、Brand、Asset 可以一键 Turn into Motion。

ArtCraft 只通过 Adapter 借能力，不绑定内部格式。
Octop 只作为 AgentRuntime 候选，不作为 SaaS 主后端。
Sub2API 只借鉴账户/计费思想，最终使用自有 SaaS Core。
Cloud / Enterprise / AirGap 使用同一代码库。

## PhotoCraft strategy update
PhotoCraft is a fast-evolving optional advanced image capability provider, not the core Image Studio runtime. We explicitly avoid rebuilding Photoshop. Durable investment stays in ecommerce workflows, Asset/Brand, Product Identity Lock, batch, AI editing, Image→Motion and enterprise capabilities. Architecture: UI → ImageDocument → Operation Layer → Capability Router → Native / PhotoCraft / AI.
