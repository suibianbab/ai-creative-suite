# AGENTS.md

每次任务开始前：
1. Read PROJECT_SPEC.md
2. Read PRODUCT_CONTEXT.md
3. Read ARCHITECTURE_PRINCIPLES.md
4. Read CURRENT_STATE.md
5. Read TASK_RISK_POLICY.md
6. Read relevant ADR
7. Inspect code
8. Classify risk
9. Recommend model/reasoning
10. Plan
11. Implement
12. Run tests
13. Update docs

禁止绕过：
- Credit Ledger
- Provider abstractions
- Tenant isolation
- Creative Documents
- Storyboard
- Sandbox
- Visual QA

禁止覆盖原始 Asset。
禁止将业务模型绑定第三方编辑器内部格式。
禁止维护长期 Enterprise fork。

在 ADR-0012 下，Creative Documents 指平台项目/分镜/版本记录与编辑器原生源文件引用；不得据此重建完整的平行画布或时间线。

## Professional editor reuse rule (ADR-0012)
Before implementing any Photoshop-like image feature:
1. Read `docs/photocraft-capabilities.md`.
2. Classify it BUILD / WAIT / INTEGRATE / AI_PROVIDER.
3. Prefer the PhotoCraft bridge for professional editing; do not add a parallel native editor feature merely to compensate for a missing bridge.
4. Product UI/workflows use a versioned bridge/adapter. The embedded PhotoCraft editor owns its own canvas operations; business records retain asset/source references rather than PhotoCraft internals.
5. Pin editor versions and run focused save/reopen, compatibility and golden-image checks on upgrades.
6. For vector, motion and video editor features, assess VectorCraft, EffectCraft or FilmCraft before developing a duplicate. Preserve Storyboard and cross-format workflows.
