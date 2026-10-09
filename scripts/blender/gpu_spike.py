"""Trusted, procedural Blender GPU smoke scene for the Windows host.

Run with Blender 5.2.2 LTS in background mode. This checks the rendering pipeline
and RTX device selection; the synthetic bottle is not a verified product model.
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, str]:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("Usage: blender -b -t 4 --python gpu_spike.py -- OUTPUT_DIR [OPTIX|CUDA]")
    output = Path(args[0]).resolve()
    backend = args[1].upper() if len(args) > 1 else "OPTIX"
    if backend not in {"OPTIX", "CUDA"}:
        raise SystemExit("Backend must be OPTIX or CUDA")
    output.mkdir(parents=True, exist_ok=True)
    return output, backend


def material(name: str, color: tuple[float, float, float, float], metallic=0.0, roughness=0.4, transmission=0.0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Transmission Weight"].default_value = transmission
    return result


def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj


def bevel(obj, width: float, segments: int = 5):
    modifier = obj.modifiers.new("Soft machined edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def look_at(obj, point):
    direction = Vector(point) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area_light(name, location, power, color, size, target=(0, 0, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)


def make_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    cream = material("warm stone", (0.56, 0.51, 0.43, 1), roughness=0.68)
    plinth_mat = material("satin graphite", (0.095, 0.12, 0.11, 1), metallic=0.35, roughness=0.27)
    bottle_mat = material("deep emerald enamel", (0.025, 0.14, 0.105, 1), metallic=0.25, roughness=0.15)
    bronze = material("brushed champagne bronze", (0.62, 0.40, 0.18, 1), metallic=0.88, roughness=0.25)
    label_mat = material("uncoated ivory label", (0.84, 0.77, 0.62, 1), roughness=0.76)
    ink = material("forest ink", (0.025, 0.08, 0.065, 1), roughness=0.7)

    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.02))
    assign(bpy.context.object, cream)

    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.6, depth=0.25, location=(0, 0, 0.125))
    assign(bevel(bpy.context.object, 0.07, 6), plinth_mat)

    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 1.42))
    bottle = bpy.context.object
    bottle.name = "Synthetic bottle — geometry smoke test"
    bottle.dimensions = (1.22, 0.74, 2.24)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(bevel(bottle, 0.19, 12), bottle_mat)

    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.32, depth=0.11, location=(0, 0, 2.61))
    assign(bevel(bpy.context.object, 0.025), bronze)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.29, depth=0.41, location=(0, 0, 2.87))
    cap = bpy.context.object
    cap.name = "Machined cap"
    assign(bevel(cap, 0.035), bronze)

    bpy.ops.mesh.primitive_cube_add(location=(0, -0.386, 1.43))
    label = bpy.context.object
    label.name = "Removable label plane"
    label.dimensions = (0.84, 0.02, 1.01)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(bevel(label, 0.025), label_mat)

    for body, size, z, spacing in [
        ("NOVA", 0.215, 1.61, 1.3),
        ("BOTANICAL ESSENCE", 0.075, 1.24, 1.08),
        ("50 ML  /  PARFUM", 0.058, 1.02, 1.15),
    ]:
        curve = bpy.data.curves.new(body, "FONT")
        curve.body = body
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.size = size
        curve.space_character = spacing
        curve.extrude = 0.0005
        text = bpy.data.objects.new(body, curve)
        bpy.context.collection.objects.link(text)
        text.location = (0, -0.406, z)
        text.rotation_euler = (math.pi / 2, 0, 0)
        assign(text, ink)

    area_light("large softbox", (-3.5, -4.3, 6.0), 780, (1.0, 0.85, 0.69), 4.0)
    area_light("cool edge strip", (3.1, 1.6, 4.1), 680, (0.54, 0.83, 0.98), 3.0)
    area_light("front label fill", (0.4, -3.0, 3.2), 180, (1.0, 0.98, 0.9), 2.0)

    camera_data = bpy.data.cameras.new("Product camera")
    camera = bpy.data.objects.new("Product camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.lens = 62
    camera_data.dof.use_dof = True
    camera_data.dof.aperture_fstop = 11.0

    world = bpy.data.worlds.new("studio atmosphere")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.27, 0.30, 0.27, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.3
    bpy.context.scene.world = world
    return camera


def configure_render(backend: str):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = backend
    prefs.get_devices()
    devices = [{"name": device.name, "type": device.type} for device in prefs.devices]
    gpu_devices = [device for device in prefs.devices if device.type == backend]
    if not gpu_devices:
        raise RuntimeError(f"No {backend} GPU device found: {devices}")
    for device in prefs.devices:
        device.use = device.type == backend

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    print("GPU_SPIKE_DEVICE=" + json.dumps({"backend": backend, "devices": devices}), flush=True)
    return devices


def render_shot(camera, output: Path, name: str, location, target, lens):
    camera.location = location
    look_at(camera, target)
    camera.data.lens = lens
    camera.data.dof.focus_distance = (Vector(target) - camera.location).length
    bpy.context.scene.render.filepath = str(output / f"{name}.png")
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    elapsed = round(time.perf_counter() - started, 3)
    print(f"GPU_SPIKE_RENDER={name} {elapsed}s", flush=True)
    return {"file": f"{name}.png", "seconds": elapsed}


def main():
    output, backend = arguments()
    camera = make_scene()
    devices = configure_render(backend)
    camera.location = (4.3, -6.8, 3.9)
    look_at(camera, (0, 0, 1.55))
    camera.data.lens = 48
    camera.data.dof.focus_distance = (Vector((0, 0, 1.55)) - camera.location).length
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "synthetic_product.blend"))
    shots = [
        render_shot(camera, output, "hero", (4.3, -6.8, 3.9), (0, 0, 1.55), 48),
        render_shot(camera, output, "detail", (1.6, -3.9, 2.0), (0, 0, 1.43), 92),
    ]
    report = {
        "purpose": "GPU pipeline smoke test; synthetic model, not product-fidelity evidence",
        "blender": bpy.app.version_string,
        "engine": "CYCLES",
        "backend": backend,
        "devices": devices,
        "resolution": [1280, 720],
        "samples": 48,
        "shots": shots,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("GPU_SPIKE_COMPLETE=" + str(output), flush=True)


if __name__ == "__main__":
    main()
