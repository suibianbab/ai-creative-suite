# Key Decisions v2

D001 产品正式升级为 AI Creative Suite。
D002 AI Image Studio 为一级产品，不是 Motion 附属工具。
D003 Image/Motion 共用 Assets、Brand、Credits、Enterprise 基础设施。
D004 Turn into Motion 是图片用户升级到视频用户的关键桥梁。
D005 ImageDocument 使用非破坏式编辑和结构化 AI Patch。
D006 Product Identity Lock 对真实商品默认开启。
D007 HyperFrames 保持默认 Motion Scene Engine。
D008 ArtCraft-like 项目只能通过 Adapter 集成。
D009 Octop 只作为 AgentRuntime Adapter 候选。
D010 SaaS Core 服务 Image、Motion、Interior 和未来产品。
D011 Cloud / Enterprise / AirGap 共用代码库。
D012 Codex 每个任务先做 Risk Classification。

D013 PhotoCraft is an optional advanced capability provider, not the core image engine.
D014 Image Studio uses Thin Native Editor + Capability Router + PhotoCraft Adapter + AI Providers.
D015 Every Photoshop-like feature must be classified BUILD / WAIT / INTEGRATE / AI_PROVIDER.
D016 We build ecommerce creative workflows, not a Photoshop clone.
D017 PhotoCraft upgrades require compatibility and golden-image regression before production.

## 2026-10-10 alignment (supersedes D005, D007, D013, D014 where conflicting)

D018 PhotoCraft is the intended primary professional Image Studio canvas; AI providers handle generative edits. Bridge, save/reopen and quality must be validated before production use.
D019 Image/Video Studio own workflow, assets, storyboard, versions, permissions and editor-source references; avoid duplicate full image or motion editor models.
D020 VectorCraft, EffectCraft and FilmCraft are priority integration candidates for vector editing, conventional motion graphics and editable video finishing. Each requires an end-to-end sample before adoption.
D021 HTML/SVG/GSAP/D3/Three.js, Blender, Remotion and specialist interactive routes retain content-specific roles. HyperFrames is a candidate for code-driven scenes, not a default for every scene.
D022 Video/Motion Studio covers multiple content types; product ads are one use case. Category-specific samples and quality review determine delivered capability.
D023 Existing ImageDocument development projects require no mandatory bulk migration. Preserve originals and accessible exports; convert individual projects only when needed.

See `docs/adr/0012-reuse-professional-editors.md` and `../docs/PRODUCT_ARCHITECTURE_ALIGNMENT.md`.
