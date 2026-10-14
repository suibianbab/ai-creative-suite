# ADR-0012: Professional editor reuse and multi-format video scope

## Status
Accepted as product and architecture direction on 2026-10-10. Individual integrations remain subject to working bridge and quality evidence.

## Context
The previously accepted thin native Image Studio and complete owned ImageDocument risk duplicating PhotoCraft. A complete owned MotionDocument and default HyperFrames timeline risk duplicating EffectCraft and FilmCraft. The product scope includes many video types beyond ecommerce ads. The user confirmed the revised target in `docs/PRODUCT_ARCHITECTURE_ALIGNMENT.md`.

## Decision
1. Use PhotoCraft as the intended primary professional image canvas. Use AI image providers for generative edits. Do not expand the native prototype into a second full editor.
2. Evaluate VectorCraft for vector work, EffectCraft for conventional editable motion graphics, and FilmCraft for editable video finishing. Use one representative end-to-end sample per integration before committing it as the production editor.
3. Retain HTML/SVG/GSAP/D3/Three.js for programmatic, data and interactive scenes; Blender for photoreal offline 3D; Remotion for automated multi-format composition where it is suitable. Rive and Spline are specialist integration candidates for interactive delivery.
4. Keep product-owned project, asset, storyboard, version, identity, authorization, provider and delivery records. Preserve editor-native source files. Do not make a second full layer/keyframe/effect model merely to shadow editor internals. Adapters/bridges isolate business workflows from editor APIs.
5. New PhotoCraft projects may use a new format directly. Old ImageDocument development projects need no mandatory bulk migration. Preserve access to their originals and outputs; evaluate conversion only for a project that must remain editable in PhotoCraft.
6. Accept video capability by content category and editable samples, including typography, data/STEM, recorded video, 2.5D, 3D, AI narrative and interactivity. An ecommerce ad sample alone is insufficient.

## Supersedes
This ADR supersedes the architecture direction in ADR-0011 and decisions D005, D007, D013 and D014 where they require a full owned editor document, native image canvas as primary editor, PhotoCraft as optional provider, or HyperFrames as the default for every motion scene. Existing deployed data and security constraints remain in force until explicitly changed. Other PROJECT_SPEC sections describing creative workflow, storyboard, asset safety and quality remain applicable.

## Constraints and verification
No integration is considered delivered until the editor can open an asset, execute a real edit, save and reopen editable source, render/export, and pass a representative quality review. Pin versions and verify licensing and Cloud/Enterprise/AirGap compatibility. The existing asset immutability, tenant isolation, provider, credit, sandbox and visual QA boundaries continue to apply.
