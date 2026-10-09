# Early quality validation

These spikes run independently of the product phase order. Each must produce a saved source project, rendered output, input provenance, and a short human review. Passing a render check alone is insufficient.

## Image ecommerce spike

Use a small, rights-cleared set covering a matte object, reflective electronics, fabric or hair-like edges, transparent packaging, and a product with dense logo/text detail.

For each: preserve the original; create cutout, white background, branded scene, and two layout sizes. Record mask quality, edge artifacts, product shape/color/text changes, export correctness, and manual correction time. Run a batch of at least 20 images to test exception review. Reject any output that changes a protected product detail without explicit approval.

The native editor supports source-referenced crop and manual browser-local project save. Browser checks now include downloaded white/transparent PNGs and saved mask correction. This is a functional check only. The rights-cleared modern ecommerce image set, correction timing, and final mask quality remain outstanding.

An initial [five-photo mask-only baseline](../artifacts/image-quality-spike-2026-10-09/REVIEW.md) uses public-domain museum-object photos and original-RGB-preserving alpha masks. It produced transparent cutouts, white-background exports, and two sample layouts for each case, with original-size and pixel-level RGB checks. Visual QA found uncut porcelain rim slots and incorrect glass transparency, so the ecommerce quality gate remains open. The museum set does not replace modern product packaging with dense label text, clear packaging, or reflective electronics; manual correction time is still outstanding.

The Image Studio browser prototype can now import an offline-generated same-size mask, save source-coordinate erase/restore brush strokes in `ImageDocument`, undo/redo them, reopen the saved project, and export both white and transparent PNGs. One porcelain correction stroke and its downloaded files were checked in the [browser review](../artifacts/image-quality-spike-2026-10-09/REVIEW.md). This verifies correction mechanics, not completion of the full mask or the publishability gate.

A loopback-only local AI provider is now connected to the editor's `remove-bg` capability. Browser QA generated a new mask from the saved porcelain original, corrected one slit, and reopened the saved project with that correction. The provider path and its API limits are documented in the [README](../README.md). This validates the end-to-end local path, but the same visual mask defects and missing modern ecommerce categories keep the quality gate open.

The follow-on [20-image exception review](../artifacts/image-quality-batch-2026-10-09/REVIEW.md) processed public-domain museum-object proxies with exact original-RGB preservation. At sheet scale it triaged 8 preview passes, 6 manual-correction cases, and 6 failures. Clear/frosted glass, lattice openings, and unwanted stands or shadows are concrete regression cases. This completes the proxy batch mechanics and exception review, but not the modern ecommerce acceptance gate or manual correction-time measurement.

The browser mask review now offers checkerboard, white, black, and magenta high-contrast backgrounds without changing the document or export. Zoom raises the preview canvas backing resolution up to the original pixels instead of merely stretching a 1000-pixel preview; the scroll viewport centers the magnified image. A browser check on the porcelain sample confirmed the magenta view exposes remaining gray in the rim slots, and 4× zoom rendered the 3200×4000 source at a 3200×4000 backing resolution while the saved one-stroke mask remained untouched. This improves human exception detection; it does not repair those slots automatically or solve transparent-material compositing.

A reusable [image acceptance workflow](./IMAGE_QUALITY_REVIEW.md) now generates a source-hash-bound `review.json`, side-by-side local review page, exception summary, and human correction timer. The existing 20-image proxy triage was recorded in this schema without inventing full-size checks or correction times. Browser review saves through a loopback-only endpoint that validates the review and retains the previous version. Intake refuses missing photo-rights evidence or any of the five required material classes; the report lists incomplete checks and missing cutout, white, branded-scene, and two-layout outputs.

Five modern product photographs from Wikimedia Commons are now ingested for [internal ecommerce validation](../artifacts/image-ecommerce-commons-2026-10-09/review-summary.md). Their file pages declare CC0 for the photographs, but visible third-party marks and packaging artwork are not cleared for publishing ads. Source provenance and hashes are in the manifest. BiRefNet produced cutouts, white composites and two neutral layouts for each. Visual preflight: one preview pass, three correction cases, one clear-bottle failure. The model included decor beside the shampoo, retained a lens reflection, and missed loose tablets; dark scenery also remained visible through the clear bottle. EXIF orientation was fixed for the backpack without overwriting its source. Publication-grade branded scenes, 100% review, and measured manual correction time remain open.

The shampoo and lens now have [source-bound corrected masks and browser-verified exports](../artifacts/image-ecommerce-commons-2026-10-09/CORRECTION_REVIEW.md). Original-size edge crops and 1080-square white/transparent exports were inspected; both local Image Studio projects reopened with their masks after refresh. The initial browser compositions were too small because they framed the entire source photograph, so both were non-destructively cropped and reframed before final export. These corrected variants are still internal previews; the original baseline triage is unchanged, and no manual brush time has been claimed.

## 2D motion spike

Create three 15–30 second pieces: kinetic typography, data/STEM explanation, and ecommerce product benefits. Save editable scene sources and a storyboard. Review information accuracy, hierarchy, visual consistency, motion timing, text fit, audio sync, and rendered frames against reference examples from SVGAnimate and Hera. Compare at 16:9 and 9:16.

## Blender product spike

Use one product with an accurate, licensed 3D model. Produce a short hero shot and a material close-up, plus an exploded-view shot only if the model includes verified internal parts. Evaluate geometry fidelity, materials, lighting, shadows, animation, render time, and final composition. This validates premium 3D capability early; it is not dependent on Phase 15 completion.

Environment check updated on 2026-10-09: portable Blender 5.2.2 LTS is installed on the Windows workstation, and a synthetic scene successfully rendered two stills on its RTX 4060 using Cycles OptiX. This confirms the host GPU path, not the quality target above; see [`GPU_RENDER_STRATEGY.md`](./GPU_RENDER_STRATEGY.md) and the [smoke test review](../artifacts/blender-gpu-spike-2026-10-09/REVIEW.md). The current Ubuntu VM runs in VMware Workstation 16.1.1 and sees only a VMware SVGA II adapter; it cannot access the RTX 4060's CUDA/OptiX device through this setup. Keep shared services in the VM and run Blender jobs on Windows.

The next pipeline check produced a [2-second synthetic motion preview](../artifacts/blender-motion-preview-2026-10-09/REVIEW.md): 48 OptiX-rendered frames were encoded into an H.264 MP4. This verifies frame rendering, basic camera animation, and video assembly, but remains below the actual product-quality gate because the model is synthetic and the preview is 640 × 360.

A [licensed camera model sample](../artifacts/blender-product-spike-2026-10-09/REVIEW.md) now covers a textured 3D source, editable studio scene, hero and lens close-up at 1600 × 900, and a 3-second 960 × 540 camera move. The source is Poly Haven CC0, with checksums and provenance preserved. The result demonstrates product-type materials, lighting, and frame rendering on RTX 4060. It is still a technical sample: the source has visible third-party marks, is not a customer-approved exact product model, and the short clip lacks graphics/audio/brand review. Continue the product-ad quality gate with an approved customer model and complete creative brief.

Without a customer-approved model, an [original fictional FORM 01 design study](../artifacts/fictional-product-ad-2026-10-09/REVIEW.md) now tests the complete local creative path: storyboard, procedural model, editable Blender scene, two animated product shots, typography, original synthesized audio, and a six-second 720p MP4. The video passes technical assembly and basic visual review. It validates creative workflow and a simple studio ad baseline, not real-product fidelity or a premium multi-shot commercial. The initial composition used Pillow/FFmpeg; the Remotion follow-up is recorded below.

The [aspect and Remotion follow-up](../artifacts/fictional-product-ad-2026-10-09/REMOTION_REVIEW.md) now renders separately framed 16:9 and 9:16 FORM 01 sources through pinned Remotion 4.0.534. Both six-second H.264/AAC outputs have 144 frames and passed decoded-media and key-frame QA. This validates local final composition, while the owned MotionDocument and production render-job integration remain open.

## Single-image boundary spike

Use the same product with only one approved photograph. Produce a 2.5D shot and a limited camera move. Record which surfaces are observed, inferred, or hallucinated. Do not present inferred rear/internal geometry as an accurate product depiction.

## Review gate

For each spike, keep the reference, input, source, export, and review together. A reviewer must decide whether it is publishable for the intended channel and describe concrete defects. Establish numerical quality thresholds only after the first baseline set is reviewed; the specification's aesthetic score of 85 is not yet a calibrated metric.
