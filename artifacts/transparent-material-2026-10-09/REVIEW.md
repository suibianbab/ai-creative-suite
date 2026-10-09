# Transparent-material source comparison

Date: 2026-10-09. Purpose: test whether choosing a light studio source photograph makes a clear bottle portable across backgrounds. This is an internal quality test, not an authorized advertisement for the depicted brand.

## Source and method

The unchanged [Farina cologne photograph](https://commons.wikimedia.org/wiki/File:Farina1709-Eau-de-Cologne.jpg) is 2835×4252 CMYK JPEG. Its Commons file page records a VRT-confirmed **copyrighted free use** declaration permitting use and modification of the photograph. This is not a CC0 claim. The visible brand, label, and packaging design need separate clearance for advertising. [manifest.json](./manifest.json) records the source SHA-256 and permission basis.

`scripts/image_quality/run_mask_spike.py` decoded the source to RGB, inferred Alpha with `birefnet-general-lite` at 1067×1600, and upscaled the mask to source size. The model changed zero pixels of the decoded source RGB; inference took 5.82 seconds. [measurements.json](./measurements.json) records the mask bounds and coverage. The source and first mask remain unchanged.

Image Studio imported the source and same-size mask, automatically framed the subject, and actually exported two 1080×1080 PNGs with identical placement: [white background](./browser/farina-white-1080.png) and [dark background](./browser/farina-dark-1080.png). The background pixels are respectively opaque white and RGB (36,59,68). Output SHA-256 values are `b4a2cbc7b61a49932ca5807c231683246b1536449200bd11817a066375240d7d` and `193eda92de04a8c7f56a09ffd8d9653250fd954822624c008ae6df00cab98223`.
The source and mask project was then saved to the browser's local project store with its white-background canvas state for future manual inspection.

## Result

| Target | Preview judgment | Evidence |
| --- | --- | --- |
| White background similar to the source | Plausible technical preview; full-size edge and label review still open | Green glass contours and label survive; photographed white transmission blends into the white canvas |
| Dark replacement background | Fail | The clear glass shoulder and base retain the source's pale interior instead of transmitting the dark canvas. Sample interior mask Alpha is 254/255 at source coordinates (900,1800), (1400,1800), and (1950,1800). |

The earlier [dark-scene clear water bottle](../image-ecommerce-commons-2026-10-09/white/transparent-bottle.png) fails in the opposite direction: the dark landscape photographed through it remains visible when moved to white. Together these samples show that a silhouette mask can isolate the outer contour but cannot recover what a different background would look like through the product. A suitable original background improves a same-background white listing image; credible scene replacement still needs a material-aware method or an appropriately photographed/3D source. Do not classify either transparent-bottle sample as a general cross-background pass.
