# Windows RTX 4060 Blender smoke test

Date: 2026-10-09. Source: [`gpu_spike.py`](../../scripts/blender/gpu_spike.py), a locally generated synthetic bottle; no customer product model, photo, trademark, or licensed asset was used. Editable scene: [`synthetic_product.blend`](./synthetic_product.blend). Output: [`hero.png`](./hero.png) and [`detail.png`](./detail.png).

## Execution evidence

- Blender 5.2.2 LTS portable Windows build, official ZIP SHA-256 verified as `3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535`.
- Cycles GPU, OptiX backend, RTX 4060 selected; CPU device disabled by script.
- 1280 × 720 PNG, 48 samples, two shots. Hero: 5.504 s; close-up: 5.554 s; host process: 12.483 s.
- Whole-GPU `nvidia-smi` sampling: 2318 MiB memory used before run, 3092 MiB maximum sampled during run, 94% maximum sampled utilization. This is not a per-process VRAM peak.
- [`report.json`](./report.json) contains Blender/device/render data. [`host-run-report.json`](./host-run-report.json) contains host monitoring and exit code 0. Local `blender.log` records successful image saves.

## Visual review

The final hero frame shows the full cap and bottle, distinct metallic/paint/label materials, softbox highlights, soft shadow, and a clean studio background. The close-up keeps the label text readable at the chosen scale. The first hero attempt cropped the cap and had a focus mismatch; camera framing and focus distance were corrected before these final outputs.

The bottle shape and label are generic and simple. The close-up examines typography more than material microstructure. There is no animation, exact product geometry, texture fidelity assessment, or advertising storyboard. These frames pass the Windows GPU rendering path check only. They do **not** pass the product-quality Golden Spike or establish that the final system can match a premium product advertisement.

## Next quality gate

Use an accurate, rights-cleared product model with source textures and branding. Produce a moving hero shot and a material close-up, then review geometry fidelity, lettering, materials, lighting, camera motion, frame consistency, and render cost at delivery resolution.
