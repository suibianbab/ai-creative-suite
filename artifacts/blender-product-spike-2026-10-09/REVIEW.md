# Licensed camera model Blender product spike — 2026-10-09

## Source and scope

- Model: [Poly Haven Camera 01](https://polyhaven.com/a/Camera_01), credited there to Rajil Jose Macatangay and marked CC0. Downloaded from Poly Haven's public asset API at 2K texture resolution. `source/source-manifest.json` records download URLs, supplied MD5 values, local SHA-256 values, and file sizes for the `.blend` and twelve PNG textures.
- The scene is a vintage camera model with visible maker/lens markings. The asset license is not evidence that third-party trademarks are cleared for advertising. This is a local technical quality sample, not a published product advertisement or proof of fidelity to a particular camera sold by a customer.
- Original model and textures remain under `source/`. `final/camera_product_scene.blend` is the editable studio scene; `motion/camera_product_motion.blend` is the editable animated scene. No exploded view was attempted because the source model does not include verified internal mechanical parts.

## Input and output

| Check | Result |
| --- | --- |
| Source geometry | 2 meshes, 26,987 triangles, 4 materials; all 12 texture paths valid (`model-inspection.json`) |
| Renderer | Blender 5.2.2 LTS, Cycles OptiX on Windows RTX 4060; CPU rendering disabled |
| Stills | `final/hero.png` and `final/lens_detail.png`, 1600 × 900, 64 samples |
| Still render time | Hero 9.047 s; detail 10.320 s; 20.461 s end-to-end host runner |
| Motion | `motion/camera_product_preview.mp4`, H.264, 960 × 540, 24 fps, 72 frames / 3 seconds, 24 samples |
| Motion time | 228.720 s frame rendering; 230.064 s end-to-end including encode |
| Whole-GPU memory | Stills 1,931 MiB baseline / 2,917 MiB sampled peak; motion 1,932 / 2,862 MiB |
| Whole-GPU utilization | 95% sampled peak for both runs |

GPU values are `nvidia-smi` whole-device samples, not memory attributed solely to Blender. They cannot be used as a production VRAM guarantee.

## Visual review

- Hero: complete body and strap remain inside the frame. Leather texture, metal wear, lens geometry, edge highlights, and contact shadow are visible. The model's pronounced worn gold edges and printed labels are asset-specific styling, not an outcome that would fit every brand.
- Detail: lens glass shows layered reflections and curved surfaces; the lens lettering and metal finish stay legible at 1600 × 900. Reflection design is adequate for a material study but would need art direction against a customer's actual approved product.
- Motion: inspected frames 1, 36, and 72. The camera move has continuous composition and visible parallax, with no obvious missing texture, cut, jump, or clipping in those sampled frames. It is a restrained three-second hero move rather than a complete advertisement with typography, sound, editing, or benefit storytelling.
- Publish decision: suitable as **internal 3D rendering quality evidence**. Not approved as an external product ad: third-party markings, absence of a customer-approved geometry/brand reference, and missing creative/audio/compositing review remain open.

## Reproduce

From the repository root, run `python scripts/blender/fetch_polyhaven_model.py --asset-id Camera_01 --resolution 2k --dest artifacts/blender-product-spike-2026-10-09/source`, then `python scripts/blender/run_camera_product_spike.py`, then `python scripts/blender/run_camera_product_motion.py`. The scripts expect the local portable Blender installation and `ffmpeg` on `PATH`.

## Decision

The Windows RTX 4060 path now supports a textured, editable 3D product-type scene and short local video with measurable render cost. This establishes a stronger baseline than the earlier synthetic bottle. The premium product-ad target still requires a customer-approved exact product model, reference matching, a longer edit, audio/graphics, and visual QA across all frames and delivery sizes.
