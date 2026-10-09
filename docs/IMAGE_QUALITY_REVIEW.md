# Image quality acceptance workflow

This is a local review tool for the early Image Studio quality gate. It keeps originals in `originals/`, binds every decision to the source SHA-256, and writes review data separately. It does not edit product pixels or publish assets. Review is a QA record, not a substitute for a human publication decision.

## New ecommerce set

Create a new directory under `artifacts/` with an `originals/` subdirectory. Place at least one approved source image for each category there: `matte`, `reflective_electronics`, `fabric_hair`, `transparent_packaging`, and `dense_text_logo`. Copy [the intake example](./image-ecommerce-intake.example.json) to `intake.json` in that directory. Match filenames, set `rights_confirmed` to `true` only after verifying usage rights, and explain each `rights_basis`. The template deliberately defaults to `false`.

From the repository root:

```powershell
$sampleRoot = 'artifacts/image-ecommerce-acceptance-YYYY-MM-DD'
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py ingest --root $sampleRoot
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py init --root $sampleRoot --kind ecommerce
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py render --root $sampleRoot
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py serve --root $sampleRoot --port 4102
```

`ingest` creates a manifest with exact original bytes, dimensions and SHA-256; it refuses missing rights evidence, unsafe filenames and an incomplete five-category set. It never replaces an existing manifest. `init` creates a separate `review.json` and refuses to overwrite one. The server binds to `127.0.0.1` only. Open `http://127.0.0.1:4102/review.html` in a browser on the same workstation.

Review original, white and high-contrast cutouts side by side. Record triage, specific checks, issue codes, reviewer and notes. Start/stop the correction timer only around actual manual correction; untouched times remain `null`, not zero. Edits first go to a browser-local draft; click **保存到项目** to validate and save `review.json` and refresh `review-summary.md`. The previous review is retained under `review-history/`. JSON download, copy, and import are portability options.

Required output names for each case key are `cutouts/<key>.png`, `white/<key>.png`, `scenes/<key>-branded.png`, `layouts/<key>-square.png`, and `layouts/<key>-portrait.png`. The report lists missing files and incomplete checks. A complete recorded review still needs a person to approve publication at delivery size. Transparent packaging also needs a material-aware compositing review, not only a silhouette mask.

Run integrity checks and regenerate the summary at any time:

```powershell
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py validate --root $sampleRoot
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/review_workflow.py report --root $sampleRoot
```

The existing [20-image proxy review](../artifacts/image-quality-batch-2026-10-09/review.html) exercises this workflow with museum-object photos. Its 8/6/6 sheet-scale triage remains a proxy result; full-size checklist fields and human correction times were not retrospectively filled in.

## Public product-photo validation set

The [five-photo Commons set](../artifacts/image-ecommerce-commons-2026-10-09/manifest.json) covers all five material classes. Each source page, photographer, CC0 declaration, unchanged downloaded file hash, and internal-only usage scope are recorded in the manifest. The photographs contain third-party product marks; the CC0 photograph declarations do not clear those marks or packaging designs for advertising. This set is useful for internal image-quality validation and does not replace brand-owned originals for final publication approval.

The [visual preflight](../artifacts/image-ecommerce-commons-2026-10-09/review-summary.md) found one preview pass, three cases requiring correction, and one transparent-material failure. It also exposed EXIF rotation on the backpack. Mask inference now applies EXIF orientation in memory while retaining the original file unchanged. All five cutouts retained the RGB pixels of their correctly oriented source images. Correction time and a final human review are still outstanding.

Two baseline defects now have [separate corrected variants](../artifacts/image-ecommerce-commons-2026-10-09/CORRECTION_REVIEW.md): the shampoo's extra petals and the lens's floor reflection. The corrected masks keep original RGB and were imported into the local editor. Saved projects survived refresh, and framed 1080-square transparent/white PNGs were downloaded and inspected. The baseline review still describes the uncorrected canonical outputs; script processing time is not counted as human correction time.

The [transparent-material comparison](../artifacts/transparent-material-2026-10-09/REVIEW.md) used a second, light studio source. Its clear glass bottle looks plausible on a matching white canvas but fails on a dark replacement canvas because the source's pale transmission remains inside an almost opaque silhouette mask. Review transparent products separately for same-background listing images and cross-background scenes. The latter remains a failed capability until a material-aware pipeline or suitable 3D/photo source is validated.
