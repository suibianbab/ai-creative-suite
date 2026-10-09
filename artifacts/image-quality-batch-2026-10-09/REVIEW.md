# 20-image mask exception review — 2026-10-09

## Scope

This is a **proxy batch**, not the modern ecommerce acceptance set. It combines the earlier five museum-object photos with 15 further object photos from [The Met Open Access Collection API](https://metmuseum.github.io/). Every selected API record reported `isPublicDomain=true` and a primary image. [`manifest.json`](./manifest.json) freezes object pages, image URLs, original dimensions, bytes, and SHA-256 values. The downloaded originals are unchanged in `originals/`. Two originals (handbag and ceramic plate) have a long side below 1200 pixels and cannot validate delivery-resolution edges.

Reproduce the collection and run with the local Python environment:

```powershell
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/collect_met_batch.py
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/run_mask_spike.py --root artifacts/image-quality-batch-2026-10-09 --skip-layouts
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/make_batch_sheets.py
```

The BiRefNet general-lite model receives a resized image with long side at most 1600 pixels and returns alpha only. The cutout combines that alpha with the decoded original RGB at its original resolution. The script verifies source hashes and exact RGB equality in every output. All 20 cutouts passed this invariant (`rgb_changed_pixels=0`). Files include full-size masks, transparent cutouts, and white-background PNGs. The four QA sheets compare source, white composite, and a deliberately contrasting magenta composite: [01–05](./qa/batch-01-05.jpg), [06–10](./qa/batch-06-10.jpg), [11–15](./qa/batch-11-15.jpg), [16–20](./qa/batch-16-20.jpg).

The 20 **model inference** times sum to 104.38 seconds, median 5.10 seconds, range 5.00–6.41 seconds on the local CPU. These figures exclude image download, model startup, PNG encoding, review, and manual correction, so they are not end-to-end throughput. Raw measurements are in [`measurements.json`](./measurements.json).

The subsequent reusable QA workflow records this sheet-scale triage in [`review.json`](./review.json), shows the same sources in a [local review page](./review.html), and derives an [exception summary](./review-summary.md). It deliberately leaves full-size checklist items and manual correction times unmeasured. The review is bound to the manifest and original hashes; its edit history is stored separately under `review-history/`.

## Visual exception review

This is a sheet-scale human visual review. “Preview pass” means no conspicuous defect at the sheet's display size; it is not approval for publication or proof of clean edges at 100% zoom. “Correction” needs human mask work. “Fail” needs a different matting approach or a fundamentally different segmentation result for the intended standalone product.

| # | Case | Result | Observed exception |
| --- | --- | --- | --- |
| 1 | Porcelain vase | Correction | Upper-rim open slits retain photographed gray background. |
| 2 | Reflective silver teapot | Preview pass | Major silhouette and handle retained; small metal openings need delivery-size review. |
| 3 | Embroidered shoe | Fail | Photographic display stand remains attached to the isolated shoe. |
| 4 | Ancient glass jar | Fail | Transparent body and spaces among applied loops appear opaque. |
| 5 | Patterned book cover | Fail | Lattice openings retain source background instead of becoming transparent. |
| 6 | Wood chair | Correction | Gray photographed floor/shadow remains near thin legs and under the seat. |
| 7 | Jewelled brooch | Preview pass | Main open spaces and small gems read clearly at sheet scale. |
| 8 | Brass clock | Preview pass | Silhouette and top railing read clearly at sheet scale. |
| 9 | Frosted-glass lamp | Fail | Frosted body is pasted as opaque photographed white on the magenta scene. |
| 10 | Painted metal lamp | Preview pass | Thin arms and lampshades retained at sheet scale. |
| 11 | Pressed-glass lamp | Fail | Transparent glass is treated as opaque photographed white. |
| 12 | Figured glass bottle | Fail | Bottle interior remains a white-background photo instead of transmitting the new scene. |
| 13 | Ceramic bottle | Preview pass | Main silhouette and surface decoration retained at sheet scale. |
| 14 | Gold necklace | Correction | Fine gaps generally separate, but a bright source-background remnant near the cord needs cleanup. |
| 15 | Woven handbag | Correction | Main silhouette works at sheet scale; 925×551 source blocks delivery-resolution validation. |
| 16 | Steel helmet | Preview pass | Main silhouette and visor openings retained at sheet scale. |
| 17 | Ceramic plate | Correction | Basic contour works; 800×589 source blocks delivery-resolution validation. |
| 18 | Earthenware plate | Preview pass | Circular contour and original pattern retained at sheet scale. |
| 19 | Silk textile | Correction | Irregular edge needs a close manual inspection and cleanup. |
| 20 | Garnet brooch | Preview pass | Interior hole and fine pin read clearly on the contrasting scene. |

At this review scale: **8 preview passes, 6 manual-correction cases, 6 failures**. The recurring failure classes are transparent/translucent transmission (4, 9, 11, 12), interior holes (1, 5), unwanted supports/shadows (3, 6), and fine-edge or source-resolution limits (14, 15, 17, 19). The numerical split is a review triage, not a calibrated accuracy score; there are no ground-truth masks.

## Decision

The batch proves that the pipeline can preserve product RGB and produce reviewable exceptions across 20 sources. It does **not** satisfy the ecommerce quality gate. Museum object photos do not cover reflective electronics, modern transparent packaging, or dense commercial text/labels. No reviewer timed full manual correction, and the 20 images have not all been approved at 100% zoom or in two finished layouts. An alpha-only mask cannot physically reconstruct background transmission through clear glass; that class requires a material-aware matting/compositing path and human signoff.

Next quality gate: use approved modern product images in the five specified classes; run the editor's non-destructive mask correction; time each correction; verify unchanged labels/colors, white and branded scenes, and 1:1/4:5 delivery exports at full size. Use this batch's failures as regression cases when evaluating a replacement or specialized provider.
