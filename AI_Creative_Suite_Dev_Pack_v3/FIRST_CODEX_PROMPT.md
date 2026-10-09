# First Codex Prompt

先不要直接开发大型功能。

1. 阅读：
PROJECT_SPEC.md
PRODUCT_CONTEXT.md
ARCHITECTURE_PRINCIPLES.md
DECISIONS.md
CURRENT_STATE.md
AGENTS.md
TASK_RISK_POLICY.md

2. 审计仓库。

3. 创建 REPO_AUDIT.md，列出：
- existing reusable code
- missing modules
- conflicts with specification
- technical debt
- security risks
- recommended Phase 0 work

4. 给当前任务做风险分类并推荐 model/reasoning。

5. 审计完成前不要大规模删除或重构现有代码。

Before implementing any Image Studio editing feature, also read:
- docs/photocraft-capabilities.md
- docs/adr/0011-photocraft-capability-router.md
Do not implement Photoshop-like advanced features until the capability has been classified.
