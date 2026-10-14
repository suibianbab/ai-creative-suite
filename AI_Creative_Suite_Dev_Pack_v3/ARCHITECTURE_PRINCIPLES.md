# Architecture Principles v2

1. 一个代码库支持 Cloud / Enterprise / AirGap。
2. Image Studio 与 Motion Studio 共用 SaaS Core、Assets、Brand、AI Gateway。
3. 平台自有项目/镜头/素材/版本记录，专业编辑源优先使用对应引擎的原生文件；不平行维护完整图层、关键帧和效果模型。旧 ImageDocument 项目保留兼容读取。
4. 原始 Asset 永远不覆盖。
5. 真实产品默认 Product Identity Lock。
6. 按内容类型选择场景引擎：EffectCraft 为传统动效候选；HTML/SVG/GSAP/D3/Three.js/HyperFrames 用于程序化和交互场景；Blender 用于写实离线 3D。
7. ArtCraft-like 引擎必须 Adapter 化。
8. Octop 只是 AgentRuntime Adapter 候选。
9. Credits 使用不可变 Ledger + Reserve/Commit/Refund。
10. Generated code 仅在 Sandbox Worker 执行。
11. Motion 复杂项目必须 Storyboard-first。
12. Visual QA 是功能要求，不是后期美化。
13. 第三方 Provider 全部抽象。
14. Enterprise/AirGap 不依赖公网 CDN/模型。
15. 核心异步与财务操作必须幂等。

16. Native Image Editor is a development prototype/legacy compatibility path, not the intended primary canvas.
17. PhotoCraft is the intended primary professional image canvas, subject to real bridge and save/reopen validation.
18. Generative image editing belongs to AI Image Providers.
19. Product workflows reach PhotoCraft through a versioned bridge/adapter; business records do not depend on PhotoCraft internal IDs or schema.
20. Route image work by capability across PhotoCraft, AI providers and narrowly scoped native utilities. Do not duplicate the professional editor.
21. PhotoCraft upgrades must be pinned, regression-tested and manually approved.
22. Do not maintain two full long-term implementations of the same advanced image capability.
