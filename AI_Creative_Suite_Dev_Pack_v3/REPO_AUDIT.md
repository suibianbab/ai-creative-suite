# Repository Audit — 2026-10-08

## Scope and finding

Inspected `D:\codex\animate` and this development pack, including hidden files, the full file list, and Git status. The workspace contains this documentation pack and its ZIP archive only. Neither directory is a Git repository. There is no application source, package manifest, database schema, test suite, CI configuration, or deployable environment to audit or run. This is a pre-implementation baseline, not an assessment of an existing product.

## Existing reusable material

- `PROJECT_SPEC.md`: product scope, target users, architecture, stack, quality gates, and phases 0–15. Its PhotoCraft v3 update supersedes the earlier image-editor wording.
- `PRODUCT_CONTEXT.md`, `ARCHITECTURE_PRINCIPLES.md`, `DECISIONS.md`: durable product and architecture decisions.
- `docs/photocraft-capabilities.md` and ADR-0011: initial capability classification and router policy.
- `AGENTS.md`, `TASK_RISK_POLICY.md`, `FIRST_CODEX_PROMPT.md`: development process and risk gates.

No reusable implementation code was found.

## Product and architecture understanding

The product has two first-class lines: Image Studio for frequent ecommerce creation and Motion Studio for editable animation/video/3D. Assets, Brand, AI Gateway, credits, organizations, and enterprise deployment are shared. Image projects must preserve originals and use an owned `ImageDocument`; image operations flow through an operation layer and `ImageCapabilityRouter` to thin native editing, optional PhotoCraft advanced editing, or AI providers. PhotoCraft cannot block core ecommerce workflows. Motion projects use Storyboard-first planning, an owned `MotionDocument`, HyperFrames for scenes, and Remotion for final composition. `Turn into Motion` connects the products. Cloud, Enterprise, and AirGap share one codebase.

## Missing modules and infrastructure

All planned implementation is absent. The first dependency chain is:

1. Git repository, monorepo workspace, package management, formatting/linting/type checks, test runner, CI, local development instructions.
2. Local PostgreSQL, Redis, object storage and configuration; database schema and migrations.
3. Shared contracts, API and web shells, design system, deployment profile and provider interfaces.
4. SaaS Core: auth, organization/workspace model, tenant enforcement, entitlements, idempotency, credit ledger and audit.
5. Asset ingestion, immutable originals, derivatives, provenance and storage processing.
6. ImageDocument, operation layer, capability registry/router, thin editor, AI provider adapters and ecommerce workflows.
7. Storyboard, MotionDocument, HyperFrames pipeline, render isolation and visual QA.

## Specification conflicts or unresolved decisions

- Naming/version drift: the folder says v3, while `README.md`, several headings, and `CURRENT_STATE.md` still say v2. The v3 PhotoCraft section and ADR-0011 should be treated as the current image architecture.
- `PROJECT_SPEC.md` section 16 uses the broad `ImageEditorAdapter` label, whereas its later v3 section defines the more specific operation layer and capability router. The later decision should govern implementation.
- Phase 0 lists tools but does not choose package manager/workspace orchestration, exact versions, local storage adapter, CI provider, or initial deployment target.
- The spec names Cloud, Enterprise, and AirGap, but their configuration boundaries, offline dependency packaging, and acceptance tests are not yet defined.
- The document schemas, tenant key model, asset lifecycle, job/event contracts, credit transaction semantics, and provider failure behavior need short ADRs before dependent modules are built.
- Some features appear in the full product scope without MVP priority or measurable acceptance criteria. Phase 3A–3E gives a useful Image Studio sequence; use that sequence when breaking down Phase 3/4 work.

## Technical debt

There is no existing code debt. The current preparation debt is specification precision: version labels, phase overlap, missing contracts, and unchosen infrastructure. No code should be deleted or refactored to address it.

## Security and reliability risks to design for

These are prospective risks, not discovered vulnerabilities in code:

- Cross-tenant access through project, asset, storage key, job, or provider callback paths.
- Double charges or lost refunds from retries and concurrent job completion unless reservation/commit/refund is atomic and idempotent.
- AI-generated HTML/SVG/code, image metadata, and remote URLs enabling script execution, SSRF, path traversal, or resource exhaustion unless processed in constrained workers.
- Public CDN or external model dependencies leaking into Enterprise/AirGap deployments.
- Provider output overwriting originals or bypassing ImageDocument provenance and product identity checks.
- PhotoCraft format/API coupling or unpinned upgrades breaking saved documents.

## Recommended Phase 0 work

1. Establish Git and the TypeScript monorepo in the intended source directory. Use the documented stack, while recording exact dependency versions and a reproducible lockfile.
2. Add minimal `apps/web`, `apps/api`, and shared contracts; set up lint, type check, unit test, and CI smoke gates.
3. Start local PostgreSQL, Redis, and S3-compatible storage with a documented development configuration. Keep secrets outside version control.
4. Define deployment profiles and provider interfaces early so Cloud-specific services do not leak into shared code.
5. Write the first schema/contract ADRs for tenant ownership, immutable assets, idempotent jobs, and credit ledger boundaries. Review critical designs independently before implementing them.
6. Add one vertical smoke path (health endpoint, web shell, database/queue/storage connectivity) before expanding into product features.
7. Update `CURRENT_STATE.md` once the foundation is actually running; do not mark Phase 0 complete based on scaffolding alone.

## Risk classification and model recommendation

This audit and documentation update are **LOW** risk; the pack recommends GPT-5.6 Sol / Low. Phase 0 foundation is **NORMAL** overall, with **CRITICAL** reviews for auth, tenant isolation, credits, sandbox, and AirGap boundaries. The pack recommends GPT-6 Astra / High for those critical modules and an independent fresh-context review. `ImageDocument`, `MotionDocument`, editor state, rendering, and complex migrations are **HIGH** risk.

## Ready-to-start gate

The next concrete task is Phase 0 foundation. Before writing it, choose the intended source directory and confirm whether this document pack is the only project input. The audit found no existing code to preserve or integrate.
