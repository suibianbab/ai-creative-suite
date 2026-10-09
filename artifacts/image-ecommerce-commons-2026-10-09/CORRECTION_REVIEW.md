# Two-sample correction review

Date: 2026-10-09. Scope: the matte shampoo bottle and reflective camera lens in the [five-photo internal validation set](./SOURCES.md). The original files and initial masks were not overwritten.

## Changes and evidence

| Case | Initial defect | Correction | Result |
| --- | --- | --- | --- |
| Matte shampoo | White decorative petals were selected beside the bottle | Keep the bottle's connected mask component, with its original soft edge | Petals removed in the [before/after sheet](./corrected/before-after.jpg); original-size [edge crop](./corrected/matte-shampoo-edge-100pct.png) checked on magenta |
| Reflective lens | Floor reflection remained attached below the product | Trim Alpha to the photographed dark bottom contour | Reflection removed in the [before/after sheet](./corrected/before-after.jpg); original-size [bottom edge crop](./corrected/reflective-lens-edge-100pct.png) checked on magenta |

The sample-specific correction steps, exact input/output hashes, changed Alpha pixel counts and script processing durations are in [provenance.json](./corrected/provenance.json). Both corrected cutouts retain the correctly oriented source RGB bytes at every pixel. Processing time is **not** manual correction time; that field remains `null` because no timed human brush session was performed.

Both corrected masks were imported into Image Studio with their original photos. Checkerboard editor previews showed the unwanted objects removed. Each project was saved to the browser's local project store, refreshed, reopened, and confirmed to retain its mask. The canvas was then cropped and reframed around the product, saved again, and transparent plus white 1080 × 1080 PNGs were actually downloaded. The [final export contact sheet](./corrected/browser/framed-contact.jpg) shows the two white versions. The transparent exports have Alpha 0 at the top-left corner; white exports have opaque white corners. Source originals remain separate from the browser projects.

## Automatic framing regression

Image Studio now estimates a subject bounding box from a downsampled mask, adds 5% padding, and fits the resulting non-destructive crop within 78% of the canvas. Attaching a mask and reframing commit as one undoable ImageDocument operation; an existing masked layer also has a reframe button. An empty mask leaves framing unchanged. The unchanged originals and corrected masks above were used for browser verification:

| Sample | Automatic source crop | Canvas layer | Exported visible Alpha bounds |
| --- | --- | --- | --- |
| Matte shampoo | x=1277, y=326, 1302×1818 | 603×842 at (239,119) | (263,156)–(819,925) |
| Reflective lens | x=1661, y=519, 1134×1715 | 557×842 at (262,119) | (282,155)–(800,925) |

The [shampoo transparent export](./corrected/browser/matte-shampoo-auto-frame-transparent-1080.png), [shampoo white export](./corrected/browser/matte-shampoo-auto-frame-white-1080.png), and [lens transparent export](./corrected/browser/reflective-lens-auto-frame-transparent-1080.png) are actual 1080×1080 browser downloads. Both transparent versions have transparent corner pixels; the white version has an opaque white corner. The shampoo's mask attachment and framing were verified to undo together and redo together. These are internal technical previews with visible third-party brands, not authorized ads or publication-ready quality approval.

## Remaining gate

This is a technical preview pass for these **corrected variants**, not publication approval. Inspecting at full resolution still shows the photographed light edge on the lens, and the photos contain third-party brands. The baseline [review.json](./review.json) keeps its original triage because its canonical output paths still point to the uncorrected baseline. The transparent bottle remains a material failure; the medicine carton still needs subject selection; no branded scene or measured human correction time has been completed. Use advertiser-owned photos for the final quality gate.
