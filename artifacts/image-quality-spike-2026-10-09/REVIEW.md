# Image cutout quality baseline — 2026-10-09

## Scope and provenance

Five original museum-object photographs were downloaded through [The Met Open Access Collection API](https://metmuseum.github.io/). Each selected object record reported `isPublicDomain=true`; object page, image URL, dimensions and SHA-256 are in [`manifest.json`](./manifest.json). This is a material and edge baseline, **not** the required five-image modern ecommerce set: it has no reflective electronics, truly transparent packaging, or dense commercial logo and label text. Originals are retained unchanged in `originals/`.

Run locally with Python 3.11–3.13 and `rembg[cpu]==2.0.85`:

```powershell
& '.tools\venv-rembg\Scripts\python.exe' 'scripts\image_quality\run_mask_spike.py'
```

The script uses rembg's `birefnet-general-lite` ONNX session. The model receives an image capped at 1600 pixels on its long side and returns **alpha only**. The original decoded RGB is combined with the upsampled alpha at original resolution. The script rejects source hash changes and checks every exported cutout's RGB against the original, pixel by pixel. Results and inference times are in [`measurements.json`](./measurements.json). White background and 1600×1600 / 1600×2000 neutral layout examples are saved separately. These layouts are composition probes, not approved brand designs.

An earlier built-in generative image edit on the porcelain vase is retained in `rejected/generative-cutout-matte-porcelain.png`. It removed the background but redrew fine decoration and reduced dimensions to 1121×1403. It fails the product identity rule and was excluded from the main pipeline.

## Visual review

| Case | Cutout / white background | Colored layout | Decision |
| --- | --- | --- | --- |
| Matte porcelain vase | Main silhouette, birds and handles preserved. Open slits around the upper rim remain filled with photographed gray background in the mask. | Gray slits stand out on beige. | **Fail** pending manual internal-hole correction. |
| Reflective silver teapot | Outer form, handle and major metal features look plausible. Very small chain openings and reflective edge require close inspection. | Plausible neutral placement. | **Conditional**; needs edge review at delivery zoom. |
| Embroidered shoe | Embroidery and color preserved; accession label removed. White support/sole is retained as part of the photographed object. | Mild white fringe around support on beige; long horizontal object leaves excess vertical space in portrait. | **Conditional**; edge cleanup and layout art direction. |
| Ancient glass jar | Outer form retained, but inner glass transmittance is essentially treated as opaque; several spaces between applied loops are filled. | Opaque-looking jar is visibly wrong on beige. | **Fail** for transparent-product quality. |
| Patterned book cover | Outer contour and clasps preserved; original pattern remains exactly from source RGB. | Pattern itself is not a logo/text fidelity test. | **Conditional**; use a real labeled package for the intended gate. |

The `rgb_changed_pixels=0` invariant protects photographed color and detail where alpha remains visible. It does **not** prove the mask is correct: an opaque mask can preserve unwanted original backdrop inside holes and transparent material. No ground-truth masks or measured manual correction times exist yet, so no IoU/edge score or throughput claim is made. All five files were opened for visual inspection; the porcelain, glass and shoe layouts were inspected on a contrasting background.

## Gate result and next work

**The ecommerce quality gate is still open.** This run proves a reproducible local mask-only route, preserved source files, valid exports and a useful QA failure path. It does not demonstrate publishable cutouts across the required product classes. The later [20-image proxy exception batch](../image-quality-batch-2026-10-09/REVIEW.md) and browser mask brush address workflow validation, while the modern product set, timed corrections, 100% edge review, and final 1:1/4:5 layouts remain. Transparent materials may require a specialized matting provider or a manually prepared alpha/transmission layer.

For production, review the separate license of the selected model weights as well as the rembg package. The [rembg model list](https://github.com/danielgatis/rembg) explicitly distinguishes library and model licenses; the [BiRefNet_lite model card](https://huggingface.co/ZhengPeng7/BiRefNet_lite) lists MIT, but the exact ONNX weight provenance and deployment terms still require verification before commercial use.

## Browser editor correction check — 2026-10-09

Image Studio now accepts a same-size PNG alpha/grayscale mask for an image layer. The original photo and mask are stored as separate browser-local assets; source-coordinate erase/restore brush strokes live in `ImageDocument` and use its undo/redo history. The preview uses a checkerboard; white or transparent PNG exports use the same rendered mask.

The porcelain original and its baseline mask were imported in the local browser. A brush stroke in an upper rim slit changed the counter from 0 to 1; undo restored 0 and redo restored 1. The project was saved, the page refreshed, and reopened with the same 1-stroke mask. The downloaded white PNG and transparent PNG are retained under [`browser-qa/`](./browser-qa/). Both decoded at 1080×1080; the transparent file's four corner alpha values were all zero, while the center alpha was 254. This is an interaction and export check, **not** a claim that all rim slots are now corrected or that the vase is publishable.

Limitations at this point in the spike: the simple brush has no edge-aware matting or translucent-material reconstruction. Browser projects remain local to one browser profile and are not synchronized with the API/VM. The subsequent local provider integration is recorded below.

## Local provider integration check — 2026-10-09

The editor now routes `remove-bg` to a replaceable provider interface in `apps/web/src/app/image-studio/capabilities.ts`. The first adapter calls `scripts/image_quality/local_mask_provider.py` on `127.0.0.1:4101`. That service accepts the original image in memory, runs the same BiRefNet general-lite model, returns a full-size grayscale PNG mask, and retains no upload. It is intentionally separate from the unauthenticated Nest API while tenant and job isolation are not implemented.

Browser QA opened the saved porcelain project, clicked **自动抠图（本机）**, saw a new 0-stroke mask in the checkerboard editor, applied one erase stroke, saved, refreshed and reopened the project with 1 stroke present. The provider health endpoint returned HTTP 200. A disallowed browser origin returned 403 and an unsupported input type returned 415. This confirms the development workflow and guardrails; it does not improve the existing missed rim slots or make the cutout publishable.

The resulting [transparent PNG](./browser-qa/matte-porcelain-auto-mask-transparent.png) was downloaded and decoded at 1080×1080. Its four corner alpha values were all zero. This confirms the browser export contains actual transparency rather than a white background.
