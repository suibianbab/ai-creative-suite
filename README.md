# AI Creative Suite

This is the Phase 0 foundation for Image Studio and Motion Studio. The product specification and architecture decisions are in [`AI_Creative_Suite_Dev_Pack_v3`](./AI_Creative_Suite_Dev_Pack_v3/README.md).

## Requirements

- Node.js 22+
- pnpm 11
- Docker Compose for PostgreSQL, Redis, and S3-compatible object storage

## Local start

```bash
pnpm install
docker compose up -d
cp .env.example .env
pnpm dev
```

Open `http://localhost:3000` for the web shell and `http://localhost:3000/image-studio` for the image editor prototype. It imports PNG/JPEG/WebP, supports image and text layers, drag/transform, undo/redo, canvas presets, non-destructive crop, manual local project save/open, imported or locally generated PNG masks with simple brush correction, and white or transparent PNG export. AI retouching beyond background removal, batch work, and production asset storage remain unimplemented.

The editor now has a limited Chinese text-instruction workflow: preview and apply canvas preset, background color, product placement, and headline changes as validated `ImageDocument` operations. Multiple clauses separated by semicolons form one undo step. This local planner uses explicit rules, not a language model; generative retouching, arbitrary natural-language requests, and product-scene generation are still unavailable. See [`docs/IMAGE_INSTRUCTION_MVP.md`](./docs/IMAGE_INSTRUCTION_MVP.md). Generated media and downloaded evaluation samples under `artifacts/` stay local; Git tracks their lightweight review and manifest files.

The API exposes `/health/live` for process liveness and `/health/ready` for PostgreSQL, Redis, and S3 bucket connectivity. Readiness returns HTTP 503 when a dependency is missing or unavailable. Run the API with the root environment file when checking readiness:

```bash
node --env-file=.env apps/api/dist/main.js
```

Build first with `pnpm build`. The generic local Compose file uses MinIO. For the supplied Docker VM, use the tested SSH tunnel and RustFS instructions in [`docs/VM_INFRASTRUCTURE.md`](./docs/VM_INFRASTRUCTURE.md).

## Checks

```bash
pnpm qa:smoke
pnpm qa:integration
pnpm qa:oidc
pnpm qa:image
```

The [regression case library](./qa/README.md) records stable case IDs, prerequisites, manual visual cases and per-run JSON reports. CI runs the smoke tier; VM and visual acceptance tiers are separate gates.

The development [Image Studio cloud project workflow](./docs/CLOUD_IMAGE_PROJECTS.md) adds OIDC login, protected project routes and browser import/open/save. It requires explicit local provisioning and is not a production auth release.

The local Compose credentials are development-only. The supplied Docker VM uses [`deploy/compose.vm.yaml`](./deploy/compose.vm.yaml), which runs the cached S3-compatible RustFS image because the pinned MinIO image could not be pulled there. All VM ports bind to loopback and require SSH forwarding from this workstation.

The Asset Foundation has a dry-run orphan-object audit for an explicit organization: from `apps/api`, run `pnpm orphan:audit <organization-uuid>` with the development `.env` and VM tunnel available. See [`docs/ORPHAN_OBJECT_RETENTION.md`](./docs/ORPHAN_OBJECT_RETENTION.md); automatic deletion is not enabled.

## Windows Blender GPU smoke test

The Windows host has a portable Blender 5.2.2 LTS build in `.tools/blender-5.2.2-windows-x64`. To rerun the synthetic Cycles/OptiX scene on its RTX 4060:

```powershell
python scripts/blender/run_gpu_spike.py --backend OPTIX
```

The output includes a `.blend`, two PNGs, and device/timing reports under `artifacts/blender-gpu-spike-<date>/`. See [`docs/GPU_RENDER_STRATEGY.md`](./docs/GPU_RENDER_STRATEGY.md). This verifies the GPU path; product-quality validation still needs an accurate, licensed model.

To run the short synthetic animation preview after the still scene exists:

```powershell
python scripts/blender/run_motion_preview.py
```

It writes an editable `.blend`, 48 PNG frames, and a 2-second MP4 under `artifacts/blender-motion-preview-<date>/`. FFmpeg must be on `PATH`.

Image Studio now has a manual **保存项目** action that stores the `ImageDocument` and each original image separately in this browser's IndexedDB. **打开** restores saved projects after a page reload. This is a local prototype: clearing browser data removes these projects, and they are not synced to the API or VM object storage.

Image layers support non-destructive crop presets (1:1, 4:5, 16:9), editable source-pixel crop coordinates, and restore-to-original. The crop rectangle lives in `ImageDocument`; original pixels remain unchanged. PNG export checks that every referenced image is loaded and verifies the encoded PNG dimensions before download.

For a mask quality sample, import an original photo, select its image layer, then import a same-size PNG mask in the inspector. White retains the image and black becomes transparent. **笔刷修正** supports erase/restore strokes, checkerboard/white/black/high-contrast preview backgrounds, zoom with backing resolution up to the original pixels, undo/redo, and local save/reopen. Preview backgrounds are QA aids and do not alter the document or export. A transparent PNG can be exported from the top bar. The mask is a separate asset and brush strokes are `ImageDocument` operations; neither overwrites the original photo. See the [five-photo baseline and browser review](./artifacts/image-quality-spike-2026-10-09/REVIEW.md). This simple brush cannot solve physically accurate translucent material; those assets still need specialized matting and human QA.

### Local automatic background removal

The **自动抠图（本机）** button uses a development-only provider on this Windows workstation. It returns a grayscale mask for manual inspection and adjustment; the editor applies it to original photo pixels. Start it before clicking the button:

```powershell
# Python 3.11–3.13; the existing local environment is .tools/venv-rembg.
py -3.12 -m venv .tools/venv-rembg
& '.tools/venv-rembg/Scripts/python.exe' -m pip install 'rembg[cpu]==2.0.85'
& '.tools/venv-rembg/Scripts/python.exe' scripts/image_quality/local_mask_provider.py
```

The service binds only to `127.0.0.1:4101`, accepts PNG/JPEG/WebP up to 25 MB and 25 megapixels, checks the browser origin, and keeps neither uploaded originals nor outputs. Its BiRefNet general-lite model file is stored under `.tools/rembg-models/`. The app currently points to this loopback endpoint, so automatic removal works only when the browser and provider run on the same workstation. This is a local quality spike, not the authenticated multi-tenant production API. Model-weight provenance and commercial deployment terms still need review.

The [20-image proxy batch review](./artifacts/image-quality-batch-2026-10-09/REVIEW.md) records source hashes, masks, exports, inference timing, and a per-image visual decision. It exposed recurring glass-transparency, interior-hole, and unwanted-support defects. The modern ecommerce acceptance set and timed human corrections are still required.

The [local image quality review workflow](./docs/IMAGE_QUALITY_REVIEW.md) adds a source-bound review record, side-by-side reviewer, exception codes, correction timer, and a loopback-only save endpoint. It has been exercised with the 20 proxy images. Its ecommerce intake template requires all five material classes and explicit usage-rights evidence before a real acceptance set can be initialized.

Schema migrations, auth, persistent assets, and Motion Studio features are subsequent work. The image editor is an early local prototype; its visual quality is not evidence that AI retouching or generated scene quality goals have been met.
