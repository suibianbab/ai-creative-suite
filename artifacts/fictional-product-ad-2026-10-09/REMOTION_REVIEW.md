# FORM 01 aspect and Remotion composition review — 2026-10-09

## Scope

This extends the [original fictional product ad](./REVIEW.md) into two delivery compositions. The creative brief and shot order remain in [STORYBOARD.md](./STORYBOARD.md). The 9:16 version uses separately framed Blender renders; it is not a center crop of the 16:9 MP4. The new portrait scene uses a continuous cyclorama to remove a hard floor/background horizon found in the first draft.

The local `@acs/remotion-engine` package implements final shot sequencing, typography, audio placement, and fade for this one design study. The owned `MotionDocument`, production job API, Asset records, tenant checks, credit handling, and Remotion worker dispatch are not implemented by this spike. Staging copies generated frames into a gitignored `public/form01/` directory without modifying the source renders.

## Outputs and measurements

| Aspect | Blender source | Remotion video | Result |
| --- | --- | --- | --- |
| 16:9 | Existing 72 frames at 1280 × 720 plus 1600 × 900 end-card still | `remotion/form01_landscape.mp4` | 144 H.264 frames, 1280 × 720, 24 fps, AAC, 6.016 s container duration; Remotion 20.267 s |
| 9:16 | New 72 frames at 720 × 1280, 24 Cycles samples; 900 × 1600 end-card still at 64 samples | `remotion/form01_portrait.mp4` | 144 H.264 frames, 720 × 1280, 24 fps, AAC, 6.016 s container duration; Remotion 19.463 s |

The portrait Blender source used Blender 5.2.2 LTS / Cycles OptiX on Windows RTX 4060. It took 384.674 s for frames and the still, 386.891 s end to end. `nvidia-smi` sampled 1,999 MiB baseline / 2,813 MiB whole-GPU peak and 96% peak utilization; those readings are not Blender-attributed VRAM. See `portrait/render/render-report.json`, `portrait/render/host-run-report.json`, and `remotion/render-report.json`.

## QA

- Inspected portrait Remotion frames 24, 60, and 100, and extracted final encoded frame 100 from both videos. Hero, cap/label close-up, and end-card layouts are legible at their respective dimensions. The portrait footer initially overlapped the plinth; it was moved below it and the videos were rerendered.
- `ffprobe` confirmed frame count, dimensions, codecs, audio track, and duration for both outputs. `ffmpeg` decoded both final videos with no reported errors. Remotion package typecheck and Biome checks passed.
- The portrait hero deliberately allocates more space to type, so the bottle is smaller than in the landscape version. This is a format-specific editorial choice; tiny physical label text still needs mobile-size review and a real brand's copy approval.
- The landscape source predates the portrait cyclorama fix and retains a subtle top background transition. This does not block the compositing proof, but a polish pass should rerender it with the same continuous backdrop.

## Decision and boundaries

**Pass** for a local 16:9/9:16 Blender → Remotion → H.264/AAC proof with aspect-specific camera framing and copy. It demonstrates final composition using Remotion rather than the earlier Pillow/FFmpeg prototype. It remains one sample, with simple bottle geometry and restrained editing; it does not establish premium brand-film quality, faithful real-product depiction, or a production MotionDocument/render-job architecture.

Remotion 4.0.534 is pinned across packages. Its [official license and pricing page](https://www.remotion.dev/docs/license/pricing) distinguishes free use for individuals and organizations of up to three people from company licensing for larger teams and automated products. Check the project's applicable license before commercial SaaS operation; this local technical trial does not determine that status. The [official render documentation](https://www.remotion.dev/docs/cli/render) and [Audio documentation](https://www.remotion.dev/docs/media/audio) informed this implementation.

## Reproduce

Run `python scripts/blender/run_fictional_product_ad.py --portrait` only when regenerating the 9:16 Blender frames. Then run `python scripts/remotion/render_form01.py` from the repository root to stage both aspect sources and render both Remotion compositions. The script uses an installed Windows Chrome and records commands and metadata under `remotion/`. The Blender source, storyboard, original audio, and original horizontal renders remain separate.
