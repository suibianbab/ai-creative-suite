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

## PhotoCraft development rule
Before implementing any Photoshop-like image feature:
1. Read `docs/photocraft-capabilities.md`.
2. Classify it BUILD / WAIT / INTEGRATE / AI_PROVIDER.
3. Do not implement an advanced native duplicate if PhotoCraft is the intended long-term provider.
4. UI must call ImageDocument operations, never PhotoCraft APIs directly.
5. Any PhotoCraft upgrade requires compatibility tests and golden-image regression.
