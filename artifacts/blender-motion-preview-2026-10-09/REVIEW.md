# Synthetic Blender motion preview

Date: 2026-10-09. This uses the procedural bottle from the [GPU smoke test](../blender-gpu-spike-2026-10-09/REVIEW.md). It is a render and composition pipeline check, not a verified product advertisement.

## Storyboard and source

- Frames 1–48, 24 fps: one continuous, restrained camera move from three-quarter to a slightly more frontal hero angle. The product stays fully in frame.
- Editable scene: [`motion_preview.blend`](./motion_preview.blend). Script: [`motion_preview.py`](../../scripts/blender/motion_preview.py). The source model is synthetic and has no customer branding.
- Master frames: `frames/frame_0001.png` through `frames/frame_0048.png`. Preview: [`motion_preview.mp4`](./motion_preview.mp4).

## Verification

- Blender 5.2.2 LTS, Cycles OptiX on NVIDIA GeForce RTX 4060, CPU device disabled. 640 × 360, 16 samples, 48 frames.
- Render time: 75.698 seconds. End-to-end render and FFmpeg encode: 82.896 seconds.
- `ffprobe` confirmed H.264, 640 × 360, 24 fps, 48 frames, exactly 2.000 seconds.
- `nvidia-smi` sampled whole-device memory use from 2421 MiB before the run to 3202 MiB maximum, with 70% maximum utilization. These values are not Blender-only VRAM measurements.
- Visually inspected first, middle, and final frames: the bottle remains visible, camera movement is continuous, and the label does not jump. This is a low-resolution preview; fine lettering is small and the bottle lacks verified geometry/material detail.

## Quality boundary

No accurate product model, advertising typography, edit rhythm, music, sound design, or material close-up is included. The next quality gate needs one rights-cleared, accurate product model and a 5–10 second storyboard with hero and material shots at delivery resolution.
