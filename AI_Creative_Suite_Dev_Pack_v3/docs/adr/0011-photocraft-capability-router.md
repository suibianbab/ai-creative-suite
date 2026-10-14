# ADR-0011: PhotoCraft Capability Router Strategy

## Status
Superseded by ADR-0012 on 2026-10-10. Retained as history.

## Context
PhotoCraft is progressing quickly but is not yet a complete stable Photoshop replacement. Building all missing Photoshop features ourselves would create duplication and future migration conflict.

## Decision
Use:
- Thin Native Editor for essential UX primitives
- our own ImageDocument as source of truth
- Operation Layer
- ImageCapabilityRouter
- PhotoCraft Adapter for advanced traditional image editing
- AI Image Providers for generative editing
- BUILD / WAIT / INTEGRATE / AI_PROVIDER policy

## Rules
1. Never bind UI directly to PhotoCraft APIs.
2. Never use PhotoCraft document format as business source of truth.
3. Do not maintain two full long-term implementations of the same advanced capability.
4. PhotoCraft upgrades must be pinned and regression tested.
5. PhotoCraft must not block core ecommerce workflows.

## Consequences
We accept adapter complexity in exchange for lower duplicate-development risk and lower dependency risk.
