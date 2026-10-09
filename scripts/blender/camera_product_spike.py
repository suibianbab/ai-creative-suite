"""Studio-light the licensed Poly Haven camera model without editing its geometry."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise ValueError("Expected output directory, GPU backend, and draft/final quality")
    output = Path(values[0]).resolve()
    backend = values[1]
    quality = values[2]
    if backend not in {"OPTIX", "CUDA"} or quality not in {"draft", "final"}:
        raise ValueError("Unsupported backend or quality")
    output.mkdir(parents=True, exist_ok=True)
    return output, backend, quality


def point_at(obj, point):
    direction = Vector(point) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area(name, location, target, energy, color, size, size_y=None):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "RECTANGLE" if size_y else "DISK"
    data.size = size
    if size_y:
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)
    return obj


def build_studio():
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    ground = bpy.data.materials.new("deep blue charcoal stage")
    ground.diffuse_color = (0.010, 0.016, 0.025, 1)
    ground.use_nodes = True
    bsdf = ground.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = ground.diffuse_color
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.08
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -0.002))
    stage = bpy.context.object
    stage.name = "studio floor"
    stage.data.materials.append(ground)

    world = bpy.data.worlds.new("dark studio ambience")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.025, 0.035, 0.055, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12
    bpy.context.scene.world = world

    target = (0.0, -0.035, 0.045)
    area("large warm key", (-0.18, -0.16, 0.27), target, 6, (1.0, 0.85, 0.70), 0.22, 0.28)
    area("cool front strip", (0.16, -0.23, 0.13), target, 2.6, (0.65, 0.80, 1.0), 0.06, 0.26)
    area("rear gold rim", (0.02, 0.17, 0.22), target, 7, (1.0, 0.76, 0.46), 0.22, 0.06)
    area("lens glint", (0.08, -0.23, 0.18), (0.015, -0.07, 0.04), 1.2, (0.85, 0.94, 1.0), 0.035, 0.11)

    camera_data = bpy.data.cameras.new("product camera")
    camera = bpy.data.objects.new("product camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera.data.clip_start = 0.001
    camera.data.clip_end = 20
    return camera


def configure_gpu(backend, quality):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = backend
    prefs.get_devices()
    devices = [{"name": item.name, "type": item.type} for item in prefs.devices]
    if not any(item.type == backend for item in prefs.devices):
        raise RuntimeError(f"No {backend} device found: {devices}")
    for item in prefs.devices:
        item.use = item.type == backend
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 16 if quality == "draft" else 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 800 if quality == "draft" else 1600
    scene.render.resolution_y = 450 if quality == "draft" else 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.render.film_transparent = False
    return devices


def render(camera, output, name, location, target, lens):
    camera.location = location
    point_at(camera, target)
    camera.data.lens = lens
    bpy.context.scene.render.filepath = str(output / f"{name}.png")
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return {"name": name, "seconds": round(time.perf_counter() - started, 3), "camera": list(location), "target": list(target), "lens_mm": lens}


def main():
    output, backend, quality = arguments()
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if {obj.name for obj in meshes} != {"Camera_01", "Camera_01_strap"}:
        raise RuntimeError("Unexpected source model contents")
    camera = build_studio()
    devices = configure_gpu(backend, quality)
    if quality == "final":
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(output / "camera_product_scene.blend"))
    shots = [
        render(camera, output, "hero", (0.23, -0.40, 0.18), (-0.03, -0.07, 0.04), 48),
        render(camera, output, "lens_detail", (0.075, -0.18, 0.105), (0.006, -0.063, 0.037), 90),
    ]
    report = {
        "purpose": "Licensed model product visual Golden Spike; not a specific advertiser's product",
        "source_model": "Poly Haven Camera_01 2k",
        "blender": bpy.app.version_string,
        "backend": backend,
        "devices": devices,
        "quality": quality,
        "resolution": [bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y],
        "samples": bpy.context.scene.cycles.samples,
        "shots": shots,
    }
    (output / "render-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PRODUCT_SPIKE_REPORT=" + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
