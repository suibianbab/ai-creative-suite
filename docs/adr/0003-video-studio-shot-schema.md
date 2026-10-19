# ADR 0003: Video Studio shot schema core

Status: accepted, 2026-10-17 — the user confirmed all four open questions as proposed. Revised same day after independent review (Codex): content versions, approval events, and render records are now separate contracts; shot lineage and duration quantization are defined; a scene execution boundary was added. Implements decision point D1 of `docs/VIDEO_STUDIO_ALIGNMENT_REVIEW_2026-10-17.md`. This ADR does not change the scope or acceptance rules of `docs/VIDEO_STUDIO_ALIGNMENT_PROPOSAL.md`.

## Context

ADR-0012 made editor and engine choices reversible: the platform stores native sources as references and keeps workflow state itself. Almost every future decision in Video Studio (engine routing, final-assembly split, TTS choice, preview strategy) stays cheap to change only while the shot schema stays clean. The shot schema is the one new decision with data accretion from day one and the most consumers (routing, preview, per-shot redo, version diff, export, QA records), so it is the one decision worth heavy argument now.

The goal is not to design the perfect schema up front. The goal is to shrink the truly hard-to-change core to a minimum and keep every other field evolvable.

## Decision

### 1. Irreducible core

1. **Shot identity and lineage.** `shot_id` is stable across reorder (order lives in the project document, not the id). **Split**: the original `shot_id` is retired, each segment receives a new `shot_id`, and lineage records the parent. **Merge**: all source `shot_id`s are retired, one new `shot_id` is created, and lineage records every parent. Retired ids are never deleted and remain queryable for lineage. Safety property: because delivery records pin immutable content versions (below), lineage changes never affect a past delivery.
2. **Immutable content versions.** A shot **content version** is an append-only, never-rewritten record of content only: `scene_source` (programmatic spec or external-editor binding, with content digest), narration text, core descriptive fields, and duration. A content version carries **no status and no render outputs** — those are separate records.
3. **Approval and lock as event records.** Shot status (`draft` / `candidate` / `approved`) is derived from an append-only event log whose entries reference content versions: a `submitted` event makes a version a candidate; an `approved` event (human-only) approves it. AI regeneration always creates a new content version plus a `submitted` event; previously approved versions stay intact for diff and rollback. `locked` is a per-shot policy flag, set and cleared by humans only, with every change recorded as an event. AI-driven mutation paths must check derived status and lock before proposing or applying changes; a rogue adapter bypassing the check is a review finding, not a schema property. Human edits to a locked shot are allowed and produce a new content version plus an explicit audit event.
4. **Independent render records.** A render record is a separate append-only record: (content version digest, engine id, engine version, renderer and headless-browser version where applicable, parameter fingerprint including fps/size/codec preset and font/asset digests, frame count, output asset reference). Rendering appends records; it never mutates a version. Multiple sizes and frame rates of the same content version are sibling render records.
5. **Provenance.** Each content version records producing engine and model versions, seeds where applicable, parent content version for redo chains, and lineage parents for split/merge. Human approval lives in events, not provenance.
6. **Delivery records.** A delivery pins the exact content version set and render records it was produced from. `exported` is not a shot state.
7. **Version pointers.** Each shot in the current project document carries a `working_version` pointer: the storyboard UI and whole-piece previews render from it; AI regeneration points it at the new candidate version; human rollback points it at an earlier version (a document mutation recorded as a new document version — content history stays intact). `approved_version` is not stored; it is derived from the event log as the latest version carrying an approval event. Render requests that do not pin versions explicitly resolve to `working_version` at request time and record the resolved ids; delivery records always pin explicit content version ids. On a locked shot, `working_version` moves only through the human edit path.

### 2. Scene execution boundary

1. `scene_spec` is **declarative data**, consumed only by a versioned platform **component registry** (registered scene components such as text animation, line drawing, shape/flow primitives). The planner/LLM emits a spec against the registry's schema; it cannot emit executable code.
2. New visual capability means a new registered component and new spec fields under a schema version bump. `scene_spec` must not grow into a general keyframe/effect editor (ADR-0012 discipline).
3. **Deterministic rendering contract**: components are pure functions of frame time; wall clocks, `Date.now`, unseeded randomness, and network access are forbidden in the render context. Rendering seeks components by frame with an injected timeline clock.
4. **Resource limits**: spec size cap, element count cap, and per-frame render timeout, enforced before and during rendering.
5. **Fitness function and full determinism input set.** Frame-identical output requires more than the spec and component version: fonts (self-hosted and digest-pinned; no CDN or network at render time), referenced image assets (immutable digests per ADR 0001), renderer and headless-browser versions, and output parameters are all determinism inputs — fixed and recorded in the render record. The check compares **decoded frames** (per-frame pixel comparison), not container bytes: container metadata may differ between frame-identical renders. This is part of P0 acceptance and a CI regression.

### 3. Storage and evolution

1. **Document-versioned storage.** A `VideoProject` document (brief, style reference, ordered shots with their content versions, events, render and delivery records) is stored as immutable document versions, reusing the existing immutable project-version and optimistic-concurrency pattern (expected-version rejection) from ImageProject persistence. No per-shot relational tables in v1. The only normalized surface is tenant scoping, version listing, and (when routing needs it) a shot index derived from documents.
2. **Schema version and migration-on-read.** The document carries `schema_version`. Readers migrate old shapes on read; stored documents are never rewritten. Old projects must remain openable and exportable after every schema change.
3. **Engine reference discipline.** `target_engine` is a route key from a registry synced by a check that fails on unknown keys (same discipline as the PhotoCraft command registry). Engine-specific binding data lives inside the opaque engine binding payload and is never promoted to core fields, never parsed by platform code outside its adapter.
4. **Minimal core fields for v1.** Core shot fields are limited to what the first two content types (text/line-drawing motion, data/STEM explainer) provably need: identity, order, duration, description, narration text, asset references, `target_engine`, `scene_spec` reference, versions/events. Genre-specific parameters stay in `scene_spec`. Fields are promoted to core only after a delivered sample proves the need.
5. **Duration and frame quantization.** Duration is stored as integer `duration_ms`. At export time, quantize **cumulative boundaries, not per-shot frame counts**: with shots in export order, `B_0 = 0` and `B_i = round_half_up((Σ durations of shots 1..i) × fps / 1000)`; shot `i` renders `B_i − B_{i−1}` frames. Per-shot rounding is forbidden — it accumulates (thirty 1100 ms shots exported by per-shot rounding differ by 0.5 s between 24 and 30 fps). If `B_i = B_{i−1}`, the shot quantizes to **zero frames** at that fps; export **rejects** the project with an actionable error (lengthen the shot or merge it with a neighbor) — a zero-frame shot is an authoring error surfaced, never silently dropped or padded. Authoring warns early when a duration approaches the zero-frame threshold at the slowest planned fps; that warning is preventive and does not replace export validation. With boundary quantization, every kept cut point lands within half a frame of its ideal time and the total within one frame of the ideal total, regardless of shot count; the resulting frame map is recorded in the delivery record.
6. **Narration audio and subtitle timing are bindings, not core.** Narration text is core; TTS audio assets and subtitle timing overrides attach per content version as bindings (shape decided with TTS selection, decision D2).
7. **Style bible is an independent versioned record.** Style bible and brand constraints live in their own versioned records; the project document stores only references. This matches ADR-0012 (brand and style constraints are platform-owned data) and the alignment proposal ("brand constraints recorded separately").
8. **Event storage and derived index timing.** Approval/lock events live inside the project document (appended through new document versions); status is derived on read. A normalized or derived shot/event index for cross-project routing is deferred until the P1 multi-shot pipeline demonstrates the need.

### 4. Inherited constraints unchanged

Tenant scoping, immutable originals, idempotent jobs (requestKey replay), and credit accounting follow ADR 0001 exactly. AI regeneration and render jobs reserve and settle credits through the existing ledger flow.

## Consequences (accepted costs)

- Deriving status from an event log adds read-path complexity (projection or on-read derivation) in exchange for never rewriting history.
- Render records as a separate entity mean "what a version produced" is a query across records, not a field read.
- The component registry makes new visual types slower to add than free-form code generation — intentional: the generation surface is data against pinned components, not arbitrary code.
- Cross-project queries over shot attributes cannot run against documents alone; a derived shot index is added only when task routing needs it, not pre-built.
- Every reader carries migration-on-read code, and old schema shapes live indefinitely in stored versions.
- Opaque engine payloads mean the platform cannot query engine metadata (for example EffectCraft layer names) — accepted; that data belongs to the engine.
- Boundary quantization keeps every cut within half a frame of ideal, but a shot's frame count can differ between fps exports and between positions (a 1100 ms shot is 26 or 27 frames at 24 fps depending on where it sits); the delivery frame map makes this visible. Projects containing shots shorter than one frame at the target fps are rejected at export — extreme shot lengths are surfaced as authoring errors, not repaired.
- Lock enforcement lives at the platform planning/execution layer, not in storage constraints.

## Constraints and verification

- Contract tests: `schema_version` present on every stored document; a v0 document opens after a migration lands; content versions immutable; status derived from events matches expected transitions; render records append-only; unknown route keys fail the registry sync check.
- Determinism fitness function: double-render decoded-frame equality for registry components in CI, with the full determinism input set (spec, components, fonts, assets, renderer/browser versions, parameters) fixed and recorded; P0 sample includes one double-render check.
- Quantization tests: multi-shot (≥30 shots) dual-fps exports use cumulative boundary math; a project containing a zero-frame shot at the target fps is rejected with an actionable error; per-shot rounding is rejected by contract test.
- Pointer tests: `working_version` rollback keeps history; `approved_version` derives from events; deliveries stay pinned to explicit versions after later `working_version` moves.
- Lineage tests: split and merge retire and record lineage correctly; a delivery pinned to a pre-split content version still opens and re-renders.
- Golden round-trip: the P0 sample (one-sentence → single-scene animation) saves, reopens, re-renders from the recorded source digest, and re-exports both aspect ratios from the same content versions.
- Concurrent save uses expected-version rejection; replay of regeneration requests is idempotent per ADR 0001.
- Each subsequent content type integration must show which fields it promoted and why, in this ADR's change log.

## Open questions

None remaining. The four questions raised during drafting were confirmed by the user on 2026-10-17, all as proposed: locked shots remain human-editable with an audit event; the style bible is an independent versioned record; the derived shot index waits until P1; the event log lives inside the project document.

## Change log

- 2026-10-17 initial draft.
- 2026-10-17 review revision (Codex): split immutable content versions from approval events and render records; defined split/merge lineage and the delivery-pinning safety property; replaced float seconds with integer `duration_ms` plus a frame quantization rule; added the scene execution boundary (declarative spec, component registry, determinism contract, resource limits, fitness function); resolved the earlier open question on duration units.
- 2026-10-17 user confirmation: all four open questions resolved as proposed (locked semantics, style bible placement, index timing, event storage); status raised to accepted.
- 2026-10-17 second review revision (Codex round 2): cumulative-boundary frame quantization replaces per-shot rounding (which accumulated error across shots) with a one-frame-per-shot floor; version pointers defined (`working_version` stored, `approved_version` derived, renders resolve and record, deliveries pin); determinism input set extended to fonts/assets/renderer/browser versions with decoded-frame comparison; corresponding contract tests added.
- 2026-10-17 third review revision (Codex round 3): the one-frame floor conflicted with the half-frame cut accuracy bound (three 1 ms shots at 24 fps quantize to zero boundaries; flooring forces 125 ms). Zero-frame shots are now rejected at export with an actionable error instead of padded; authoring warning is preventive only.
- 2026-10-19 fourth revision (P2.5 media mixing, T1): promoted `SceneSource` union member `media-clip` (mediaAssetId / inMs / outMs / fit / focalX / audio — platform-parsed and platform-verified, unlike the opaque `editor-binding`), project-level append-only `mediaAssets` ledger (origin + license + ffprobe-verified original with content-addressed storeKey + optional regenerable proxy), and `RenderRecord.assetDigests` (renders pin actual asset digests). Determinism input set extended to media file sha256 (original; proxy when used) and ffmpeg version; cross-machine bit-equality is explicitly not promised for lossy transcode chains — same-machine decoded-frame equality remains the fitness function. Additive optional fields only; schemaVersion stays 1; historical pure-spec projects open, validate, and export unchanged.
