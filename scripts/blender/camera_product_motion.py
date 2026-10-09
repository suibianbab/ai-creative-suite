"""Render a short, editable camera move through the licensed product scene."""

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
        raise SystemExit("Usage: blender -b SCENE.blend --python camera_product_motion.py -- OUTPUT_DIR")
    output = Path(args[0]).resolve()
    frames = output / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    camera = bpy.data.objects.get("product camera")
    if camera is None or bpy.data.objects.get("Camera_01") is None:
        raise RuntimeError("Expected licensed product scene is missing")

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
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 72
    scene.camera = camera
    camera.data.lens = 48

    target = Vector((-0.03, -0.07, 0.04))
    for frame, position in [(1, Vector((0.20, -0.43, 0.17))), (72, Vector((0.25, -0.38, 0.19)))]:
        camera.location = position
        camera.rotation_euler = (target - position).to_track_quat("-Z", "Y").to_euler()
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    scene.frame_set(1)
    scene.render.filepath = str(frames / "frame_")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "camera_product_motion.blend"))
    started = time.perf_counter()
    bpy.ops.render.render(animation=True)
    report = {
        "purpose": "Licensed model product motion quality preview",
        "blender": bpy.app.version_string,
        "engine": "CYCLES",
        "backend": "OPTIX",
        "device": optix[0].name,
        "resolution": [960, 540],
        "fps": 24,
        "frame_count": 72,
        "samples": 24,
        "render_seconds": round(time.perf_counter() - started, 3),
    }
    (output / "render-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("CAMERA_PRODUCT_MOTION=" + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
