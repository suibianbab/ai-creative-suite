# ADR 0001: Core data boundaries

Status: proposed, 2026-10-08. This records implementation constraints before Phase 1 and Phase 2 schema work. It is not a claim that the constraints are enforced by the current foundation code.

## Context

Image Studio and Motion Studio share organizations, workspaces, assets, jobs, and credits. The product requires immutable originals, tenant isolation, idempotent expensive work, and an immutable credit ledger. These rules must survive retries, concurrent requests, worker callbacks, and all Cloud, Enterprise, and AirGap deployments.

## Tenant ownership

- An organization is the billing and isolation boundary. A workspace belongs to exactly one organization. Projects, assets, jobs, wallets, and audit events carry `organization_id`; workspace-scoped records also carry `workspace_id`.
- API authorization resolves the user's organization membership and workspace role before reading or mutating a resource. A client-supplied `organization_id` is never authority.
- Queries always scope by the authenticated organization. Database foreign keys for tenant-owned relationships include `organization_id` to prevent cross-tenant links, and uniqueness constraints include it unless a value is intentionally global.
- Workers and provider callbacks resolve tenant context from their persisted job record, never from callback payloads. Object-store keys are allocated server-side under an organization prefix, but the prefix is defense in depth rather than authorization.
- PostgreSQL row-level security is a second enforcement layer to evaluate in the schema spike. The application must remain safe even when administrative migration and worker connections bypass it.

## Asset and provenance

- An asset is a logical catalog record. Every uploaded or generated binary has a distinct immutable blob record with its hash, size, media type, storage key, and source. The original blob reference on an asset is assigned once and never changed.
- An edit, resize, mask, thumbnail, AI result, or Blender render creates a new derivative blob or asset version. No operation overwrites the original object key. Object-store writes use a new key and fail on an existing key.
- Asset provenance stores the parent asset/version, producing job, provider or engine, model or template version where applicable, and any human approval. Deleting a catalog record requires a retention policy and must not silently remove a blob still referenced by a project, document, or audit record.
- The owned `ImageDocument` and `MotionDocument` reference asset versions, never third-party editor internal IDs as durable source data.

## Idempotent jobs

- A mutating request supplies a stable idempotency key scoped to organization, operation, and caller. The server stores a request hash and returns the same job/result for an exact replay; reuse with different input is rejected.
- A job has one persisted lifecycle with explicit terminal states. Claims and transitions use compare-and-set or row locking. Provider callbacks are deduplicated by provider event ID and linked to the existing job.
- Job creation and its initial credit reservation share one database transaction. An external provider call occurs only after that transaction commits, through an outbox or equivalent recoverable dispatch mechanism.
- Retries must reuse the same logical job and reservation. A new attempt may have its own attempt ID and provider request ID, but cannot create a second charge for the same job.

## Credit accounting

- Each organization has a wallet. Ledger entries are append-only: `GRANT`, `PURCHASE`, `RESERVE`, `COMMIT`, `REFUND`, `REVERSAL`, and `ADMIN_ADJUSTMENT`. Corrections add compensating entries rather than updating or deleting prior entries.
- Available and reserved balances are derived from ledger semantics or from transactionally maintained projections. A reservation atomically checks available balance and prevents concurrent overspend. Every ledger mutation has a unique idempotency key and a reference to its job or administrative cause.
- The expensive-job flow is estimate, reserve, run, commit actual usage, then refund any unused reservation. Failure or cancellation releases the eligible reservation exactly once. A late provider success cannot commit after a terminal refund without an explicit reconciled transition.
- The pricing engine records the versioned price rule and measured usage used for each commit. UI plan names never decide entitlements or prices directly.
- Database constraints and transaction tests must cover replay, concurrency, partial provider failure, timeout, cancellation, and out-of-order callback cases before billing is enabled.

## Next implementation gate

Create the schema and migrations for organization/workspace, asset/blob, job/outbox, and wallet/ledger separately. Auth, tenant isolation, and credits are critical modules under `TASK_RISK_POLICY.md`; each implementation requires an independent fresh-context review and adversarial integration tests before use beyond development. Confirm the asset version retention policy and the precise credit balance equations in follow-up ADRs before writing billing code.
