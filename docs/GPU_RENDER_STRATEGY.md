# GPU rendering on the development workstation

Checked on 2026-10-09:

- Windows host: NVIDIA GeForce RTX 4060, 8 GB VRAM, driver 595.95.
- Existing guest: Ubuntu 20.04 on VMware Workstation 16.1.1. `lspci` shows VMware SVGA II, not an NVIDIA device; `nvidia-smi` is unavailable. Docker has no NVIDIA runtime.
- The VMware guest already runs the isolated `acs` PostgreSQL, Redis and S3-compatible object storage stack.
- Portable Blender 5.2.2 LTS is installed under `.tools/blender-5.2.2-windows-x64` on Windows. The official ZIP SHA-256 was verified before extraction.

## Windows host GPU smoke test: passed

Run `python scripts/blender/run_gpu_spike.py --backend OPTIX` from the repository root. The runner uses the portable Blender build and writes images, an editable `.blend`, logs, and JSON reports under `artifacts/blender-gpu-spike-<date>/`. Its scene is procedural and synthetic, so this verifies the rendering path rather than product fidelity.

The 2026-10-09 run selected the RTX 4060 OptiX device in Cycles with CPU rendering disabled. It rendered two 1280 × 720 PNGs at 48 samples: hero in 5.504 s and close-up in 5.554 s; end-to-end runner time was 12.483 s. `nvidia-smi` sampled 94% peak GPU utilization and 3092 MiB whole-GPU memory use versus 2318 MiB before the run. These whole-device readings are not Blender-only VRAM measurements. Visual review and files are in `artifacts/blender-gpu-spike-2026-10-09/REVIEW.md`.

The animation smoke test runs with `python scripts/blender/run_motion_preview.py`. It produced a 2-second, 48-frame H.264 preview at 640 × 360. The editable scene, individual frames, video, and review are under `artifacts/blender-motion-preview-2026-10-09/`. This is a pipeline preview using the same synthetic bottle, not a reference-quality product advertisement.

## Decision for the early Blender spike

Keep the current VMware guest as the development service host. Run the first Blender/Cycles GPU jobs on the Windows host using OptiX or CUDA. A separate WSL 2 environment is an option for Linux GPU workloads after a workload-specific smoke test; do not assume Blender's headless rendering behavior there without testing. A GPU worker can consume a job, fetch the model and textures from object storage, render frames, then write outputs and metadata back to object storage. The API and final composer should reference those outputs through Asset records. Worker dispatch, retries, tenant authorization, and credit accounting must be implemented before this becomes a production pipeline.

For the product-quality sample, use one accurate, licensed product model and render a short hero shot plus a material close-up. Record Blender version, engine/device, VRAM peak, render time, model provenance, scene source, frames, and visual review. An 8 GB card may need texture/geometry budgets or tiled/offline rendering for complex scenes; measure the actual sample rather than promising throughput.

The first licensed model sample is recorded in [`artifacts/blender-product-spike-2026-10-09/REVIEW.md`](../artifacts/blender-product-spike-2026-10-09/REVIEW.md). A Poly Haven CC0 camera model with 2K PBR textures produced two 1600 × 900 stills and a 3-second 960 × 540 camera move on the Windows RTX 4060 via Cycles OptiX. The still renders took 9.047 s and 10.320 s; 72 animation frames took 228.720 s. Whole-GPU sampled memory peaked at 2,917 MiB for stills and 2,862 MiB for motion. This supports the local rendering path and material quality baseline, while the model's embedded markings and lack of customer product approval prevent external ad use.

## Why the existing VMware guest cannot use CUDA/OptiX

VMware Workstation's 3D acceleration presents a virtual graphics adapter to the guest. It is distinct from PCI GPU passthrough, which Workstation does not provide. Enabling the VM's 3D display setting can help some guest viewport graphics but does not make the host RTX 4060 available as an NVIDIA CUDA device. Installing a Linux NVIDIA driver or NVIDIA Container Toolkit inside this guest cannot create a missing PCI GPU.

If the requirement is specifically to run GPU code in a Linux virtualized environment on this Windows machine, use WSL 2 GPU paravirtualization and a GPU-capable container setup. Docker Desktop supports `--gpus` for Linux containers with its WSL 2 backend. Confirm `nvidia-smi` in WSL 2 and run an official CUDA container smoke test before moving workers. Do not replace or alter the existing VMware service VM solely for this check.

Sources: [VMware Workstation passthrough discussion](https://community.broadcom.com/vmware-cloud-foundation/communities/community-home/digestviewer/viewthread?CommunityKey=fb707ac3-9412-4fad-b7af-018f5da56d9f&MessageKey=c9a72dbf-f2c7-4882-a944-de035fdcee3c), [Docker Desktop GPU support](https://docs.docker.com/desktop/features/gpu/), [NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/), [Blender GPU rendering](https://docs.blender.org/manual/en/4.1/render/cycles/gpu_rendering.html).
