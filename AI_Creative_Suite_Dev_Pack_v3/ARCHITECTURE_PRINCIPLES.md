# Architecture Principles v2

1. 一个代码库支持 Cloud / Enterprise / AirGap。
2. Image Studio 与 Motion Studio 共用 SaaS Core、Assets、Brand、AI Gateway。
3. ImageDocument / MotionDocument 是编辑源文件。
4. 原始 Asset 永远不覆盖。
5. 真实产品默认 Product Identity Lock。
6. HyperFrames 是默认 Motion Scene Engine。
7. ArtCraft-like 引擎必须 Adapter 化。
8. Octop 只是 AgentRuntime Adapter 候选。
9. Credits 使用不可变 Ledger + Reserve/Commit/Refund。
10. Generated code 仅在 Sandbox Worker 执行。
11. Motion 复杂项目必须 Storyboard-first。
12. Visual QA 是功能要求，不是后期美化。
13. 第三方 Provider 全部抽象。
14. Enterprise/AirGap 不依赖公网 CDN/模型。
15. 核心异步与财务操作必须幂等。

16. Native Image Editor must remain thin and must not become a Photoshop clone.
17. Traditional advanced image editing should prefer PhotoCraft Adapter or WAIT.
18. Generative image editing belongs to AI Image Providers.
19. UI and ImageDocument must never directly bind to PhotoCraft APIs.
20. Every image capability must route through ImageCapabilityRouter.
21. PhotoCraft upgrades must be pinned, regression-tested and manually approved.
22. Do not maintain two full long-term implementations of the same advanced image capability.
