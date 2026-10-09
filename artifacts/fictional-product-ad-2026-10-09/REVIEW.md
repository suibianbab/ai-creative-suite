# FORM 01 fictional product ad — 2026-10-09

## Scope and sources

The product, set, label, copy, typography layout, camera animation and sound were created for this local design study. `FORM 01` is not a customer product, and the video makes no product efficacy or manufacturing claims. The local Windows Georgia and Arial fonts are used to render the lettering; font files are not redistributed. The output is a creative workflow sample, not a real-product identity or trademark approval.

The [storyboard](./STORYBOARD.md) was written before modeling and rendering. Source is retained as `scripts/blender/fictional_product_ad.py`, `scripts/blender/compose_fictional_product_ad.py`, `render/form01_scene.blend`, `render/form01_endcard_scene.blend`, and the rendered frames. The compositor is a local Pillow/FFmpeg prototype; it does not validate the future Remotion integration.

## Deliverables

| Item | Location / result |
| --- | --- |
| Final video | `final/form01_fictional_ad.mp4`, 6.000 s, 1280 × 720, 24 fps, H.264 + AAC |
| Original sound | `final/original_audio.wav`, stereo, 48 kHz, peak 0.322, RMS 0.089 |
| 3D product motion | `render/frames/frame_0001.png`–`frame_0072.png`, 1280 × 720, 24 Cycles samples, denoised |
| End-card source | `render/endcard_product.png`, 1600 × 900, 64 Cycles samples |
| Composed frames | `final/frames/frame_0001.png`–`frame_0144.png` |
| Editable scene | `render/form01_scene.blend` and `render/form01_endcard_scene.blend` |

Blender 5.2.2 LTS used Cycles OptiX on the Windows RTX 4060 with CPU rendering disabled. The Blender run took 379.975 s rendering and 381.463 s end to end, including scene setup and the still. Whole-device `nvidia-smi` memory measured 2,003 MiB at baseline and 2,852 MiB sampled peak, with 95% sampled peak GPU utilization. These are not Blender-attributed VRAM readings or production throughput guarantees.

## Visual and technical QA

- Inspected composed frames 1, 24, 48, 49, 60, 72, 73, 96, 120, 138, and 144. The whole bottle and cap remain visible in the hero shot; the close-up intentionally crops the top cap and lower label. Text in the close-up was moved into a dark empty area after initial QA found overlap with the label.
- The end card places the bottle on the right and copy on the left with readable margins. Text fades in and the entire image fades to black at the end. There are two intended visual cuts at frames 49 and 73.
- Automated small-frame difference scan found the largest changes at frames 49 and 73 (the intended cuts); the largest change elsewhere was 4.42 average 8-bit levels. The final frame is black. This is a continuity check, not a full-frame aesthetic review.
- `ffprobe` confirms 144 H.264 frames, 1280 × 720, 24 fps, 6.000 s, and an AAC audio track. Source frame count and output frame count were checked.

## Quality judgment

**Pass as a complete local storyboard → procedural model → GPU render → typography/audio composition → MP4 export sample.** It demonstrates a restrained, clean product teaser. The bottle geometry is deliberately simple, the camera moves and editing are modest, the second shot is only one second, and the video is 720p. This does not establish Hera-level motion graphics, a premium multi-shot brand film, photoreal transparent glass/liquid, or faithful depiction of a real product. The next quality pass should improve art direction and pacing, test 9:16, integrate the owned MotionDocument/Remotion path, and use a real approved model for product-fidelity acceptance.

## Reproduce

From the repository root, run `python scripts/blender/run_fictional_product_ad.py` and then `python scripts/blender/compose_fictional_product_ad.py`. The local portable Blender, RTX OptiX support, FFmpeg, Pillow, NumPy and Windows fonts are required. Re-running overwrites only this generated artifact directory, not imported originals.
