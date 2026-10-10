# Regression case library

[`registry.json`](./registry.json) is the stable index for version-change checks. Each automated case has an ID, tier, executable command, prerequisites and observable assertions. Each manual case has a fixture, procedure and pass criteria. Keep IDs stable so reports from different commits can be compared; add a new ID when the acceptance contract changes substantially.

## Commands

From the repository root:

| Command | Purpose | Prerequisites |
| --- | --- | --- |
| `pnpm qa:validate` | Validate case IDs and registry structure | Node.js |
| `pnpm qa:smoke` | Lint, typecheck, ImageDocument tests, production build | Installed workspace dependencies |
| `pnpm qa:integration` | Isolated asset, project, auth, import and orphan tests | `.env`, VM tunnel to PostgreSQL and RustFS |
| `pnpm qa:oidc` | Real development Keycloak token and JWKS check | `.env`, `.env.auth.local`, VM tunnel to PostgreSQL and Keycloak |
| `pnpm qa:image` | Image quality intake and source-integrity tests | Python with Pillow |

The runner executes cases sequentially and exits nonzero if any case fails or is blocked. `PASS` means that case's command exited successfully. `FAIL` means its assertion or process failed while required services were responsive. `BLOCKED` means a required file or service was unavailable before or after the command; it is **not** a pass. The runner checks PostgreSQL protocol response, RustFS health and Keycloak discovery rather than only checking whether tunnel ports listen.

Every run writes an ignored JSON report under `qa/reports/` with case IDs, status, duration, Git commit, dirty-tree flag and environment version. Reports do not store credentials or raw test output. CI runs the smoke tier and uploads its report as an artifact. Integration and OIDC tiers use the development VM, create random database schemas and object prefixes, and are not represented as CI passes unless actually run.

## Version-change gates

1. Run `qa:smoke` for every change. A release candidate also needs `qa:integration`, `qa:oidc` and `qa:image` against the intended environment.
2. Run relevant manual cases in the registry for changed image, motion or 3D behavior. Record the source fixture, rights basis, output files, reviewer, defects and decision in the existing quality review format. Do not mark a manual case passed merely because its automated suite passed.
3. Auth, tenant isolation and deletion paths still need the independent fresh-context review required by the development pack. A green regression report does not replace that review.
4. A `BLOCKED` case must be rerun after its prerequisite is restored. Preserve the failed report and the successful rerun report for diagnosis.

Current gaps: manual cases are documented but not automated in a browser; no authorized customer product set or approved exact 3D model has completed final acceptance. The 20-image proxy and Commons sample reviews are development evidence, not a release pass.
The cloud project HTTP regression (`PRJ-003`), real Keycloak route check (`AUTH-003`), and second-account denial (`AUTH-004`) are automated. The browser PKCE, cloud version round trip, and second-account cloud denial were observed on 2026-10-10; see [`UI-003-2026-10-10.md`](./UI-003-2026-10-10.md). Clearing the cloud session also cleared the current canvas in [`UI-005-2026-10-10.md`](./UI-005-2026-10-10.md). Shared-browser local draft isolation (`UI-004`) failed and remains a release gate.
Basic image adjustments were verified with a synthetic color fixture, local and cloud reopen, numeric text instructions, and exported PNG pixel checks; see [`UI-006-2026-10-10.md`](./UI-006-2026-10-10.md).
Local Qwen3 natural-language planning was verified with a synthetic image, combined preview, single-step undo and whole-request rejection; see [`UI-007-2026-10-10.md`](./UI-007-2026-10-10.md).
The background plate spike verified a synthetic masked product, browser preview, one-step undo/redo, PNG export and local project reopen; see [`UI-008-2026-10-10.md`](./UI-008-2026-10-10.md). Its visual quality gate is still open because the composite lacks a convincing contact shadow; the live AI image provider was not exercised.
Native contact shadow and mask-base surface alignment were then verified on the same saved synthetic project; see [`UI-009-2026-10-10.md`](./UI-009-2026-10-10.md). This improves the contact cue but does not close the full advertisement quality gate for varied real products.
The scene-light inspection compares product and background luminance direction without changing pixels; explicit exposure trials preview through the existing ImageDocument transaction path. Browser and pure-function evidence is in [`UI-010-2026-10-10.md`](./UI-010-2026-10-10.md). It is an advisory check, not a physical lighting or professional color-management pass.
