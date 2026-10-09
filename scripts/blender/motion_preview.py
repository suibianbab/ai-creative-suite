"""Animate the synthetic bottle to verify headless OptiX frame rendering.

The supplied .blend is created by gpu_spike.py. This is a low-resolution pipeline
preview, not a product-fidelity or premium-advertising quality sample.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("Usage: blender -b SCENE.blend --python motion_preview.py -- OUTPUT_DIR")
    output = Path(args[0]).resolve()
    frames = output / "frames"
    frames.mkdir(parents=True, exist_ok=True)

    bottle = bpy.data.objects.get("Synthetic bottle — geometry smoke test")
    camera = bpy.data.objects.get("Product camera")
    if bottle is None or camera is None:
        raise RuntimeError("Expected synthetic smoke scene is missing")

    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    optix = [device for device in prefs.devices if device.type == "OPTIX"]
    if not optix:
        raise RuntimeError("No OptiX device found")
    for device in prefs.devices:
        device.use = device.type == "OPTIX"

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 48
    scene.camera = camera
    camera.data.lens = 48
    camera.data.dof.aperture_fstop = 11
    target = Vector((0, 0, 1.55))

    for frame, position in [
        (1, Vector((4.3, -6.8, 3.9))),
        (48, Vector((2.7, -7.3, 3.5))),
    ]:
        camera.location = position
        camera.rotation_euler = (target - position).to_track_quat("-Z", "Y").to_euler()
        camera.data.dof.focus_distance = (target - position).length
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
        camera.data.keyframe_insert(data_path="dof.focus_distance", frame=frame)

    scene.frame_set(1)
    scene.render.filepath = str(frames / "frame_")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "motion_preview.blend"))
    started = time.perf_counter()
    bpy.ops.render.render(animation=True)
    elapsed = round(time.perf_counter() - started, 3)
    report = {
        "purpose": "Synthetic GPU animation pipeline preview; not product quality evidence",
        "blender": bpy.app.version_string,
        "engine": "CYCLES",
        "backend": "OPTIX",
        "device": optix[0].name,
        "resolution": [640, 360],
        "fps": 24,
        "frame_count": 48,
        "samples": 16,
        "render_seconds": elapsed,
    }
    (output / "render-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MOTION_PREVIEW_COMPLETE=" + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
