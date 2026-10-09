"""Build and render an original fictional fragrance product ad in Blender.

The product is a design study, not a reconstruction of any real product.
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2 or values[1] not in {"draft", "final", "portrait-draft", "portrait-final"}:
        raise ValueError("Expected output directory and draft/final/portrait-draft/portrait-final quality")
    output = Path(values[0]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    return output, values[1]


def material(name, color, metallic=0, roughness=0.4):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def bevel(obj, width, segments=6):
    mod = obj.modifiers.new("machined soft edges", "BEVEL")
    mod.width = width
    mod.segments = segments
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def cube(name, location, dimensions, mat, bevel_width=0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel_width:
        bevel(obj, bevel_width)
    obj.data.materials.append(mat)
    return obj


def cylinder(name, location, radius, depth, mat, bevel_width=0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if bevel_width:
        bevel(obj, bevel_width)
    obj.data.materials.append(mat)
    return obj


def cyclorama(mat):
    """A continuous floor-to-wall curve avoids a visible studio horizon."""
    path = [(-100.0, -0.03), (1.0, -0.03)]
    path.extend((1.0 + index * 0.2, -0.03 + 0.04 * (index * 0.2) ** 3) for index in range(1, 36))
    vertices = [(x, y, z) for y, z in path for x in (-100.0, 100.0)]
    faces = [(2 * index, 2 * index + 1, 2 * index + 3, 2 * index + 2) for index in range(len(path) - 1)]
    mesh = bpy.data.meshes.new("seamless cyclorama mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("seamless dark cyclorama", mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area(name, location, target, energy, color, width, height):
    lamp = bpy.data.lights.new(name, "AREA")
    lamp.shape = "RECTANGLE"
    lamp.size = width
    lamp.size_y = height
    lamp.energy = energy
    lamp.color = color
    obj = bpy.data.objects.new(name, lamp)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)


def text(name, body, location, size, mat, font, spacing=1.0):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.space_character = spacing
    curve.extrude = 0.00035
    if font:
        curve.font = font
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.data.materials.append(mat)


def font(path):
    return bpy.data.fonts.load(path) if Path(path).is_file() else None


def build_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    floor = material("deep evergreen floor", (0.012, 0.024, 0.021), roughness=0.72)
    plinth = material("satin charcoal plinth", (0.055, 0.074, 0.070), metallic=0.28, roughness=0.38)
    glass = material("opaque deep green enamel design study", (0.012, 0.092, 0.073), metallic=0.22, roughness=0.21)
    brass = material("brushed champagne brass", (0.56, 0.36, 0.15), metallic=0.90, roughness=0.26)
    paper = material("warm ivory label", (0.75, 0.71, 0.59), roughness=0.86)
    ink = material("near black label ink", (0.025, 0.035, 0.029), roughness=0.8)

    cyclorama(floor)
    cylinder("low display plinth", (0, 0, 0.11), 1.52, 0.22, plinth, 0.042)
    cylinder("brass plinth accent", (0, 0, 0.224), 1.46, 0.018, brass, 0.005)
    cylinder("upper plinth", (0, 0, 0.29), 1.43, 0.12, plinth, 0.025)

    cube("FORM 01 original bottle", (0, 0, 1.345), (1.22, 0.68, 2.0), glass, 0.17)
    cylinder("neck flange", (0, 0, 2.365), 0.33, 0.10, brass, 0.018)
    cylinder("cap dark seam", (0, 0, 2.42), 0.292, 0.025, ink, 0.005)
    cylinder("brass cap", (0, 0, 2.66), 0.30, 0.43, brass, 0.029)
    cylinder("cap top ring", (0, 0, 2.885), 0.267, 0.012, brass, 0.003)

    cube("label ivory paper", (0, -0.350, 1.43), (0.88, 0.017, 0.95), paper, 0.018)
    serif = font("C:/Windows/Fonts/georgia.ttf")
    sans = font("C:/Windows/Fonts/arial.ttf")
    text("brand lettering", "FORM 01", (0, -0.362, 1.66), 0.145, ink, serif, 1.16)
    text("middle mark", "—  S T U D Y  —", (0, -0.362, 1.43), 0.055, ink, sans)
    text("product category", "BOTANICAL PERFUME", (0, -0.362, 1.27), 0.068, ink, sans, 1.08)
    text("volume", "50 ML", (0, -0.362, 1.10), 0.057, ink, sans, 1.08)

    world = bpy.data.worlds.new("low key evergreen studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.025, 0.045, 0.038, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.18
    bpy.context.scene.world = world
    target = (0, 0, 1.35)
    area("warm large softbox", (-3.6, -4.0, 5.3), target, 560, (1.0, 0.84, 0.67), 3.1, 4.2)
    area("cool right rim", (2.9, 1.0, 4.1), target, 520, (0.57, 0.86, 0.86), 1.0, 3.0)
    area("front label fill", (0.7, -4.0, 2.8), target, 160, (1.0, 0.97, 0.87), 2.0, 2.7)
    area("gold cap glint", (-0.3, -1.7, 5.0), (0, 0, 2.65), 140, (1.0, 0.83, 0.6), 0.8, 1.5)

    camera_data = bpy.data.cameras.new("product camera")
    camera = bpy.data.objects.new("product camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.clip_start = 0.01
    camera_data.clip_end = 300
    return camera


def configure_render(quality):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    devices = [{"name": device.name, "type": device.type} for device in prefs.devices]
    if not any(device.type == "OPTIX" for device in prefs.devices):
        raise RuntimeError(f"No OptiX GPU: {devices}")
    for device in prefs.devices:
        device.use = device.type == "OPTIX"
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    draft = quality.endswith("draft")
    portrait = quality.startswith("portrait")
    scene.cycles.samples = 16 if draft else 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = (450 if draft else 720) if portrait else (800 if draft else 1280)
    scene.render.resolution_y = (800 if draft else 1280) if portrait else (450 if draft else 720)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 72
    return devices


def camera_pose(camera, frame, position, target, lens):
    camera.location = Vector(position)
    look_at(camera, target)
    camera.data.lens = lens
    camera.keyframe_insert(data_path="location", frame=frame)
    camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    camera.data.keyframe_insert(data_path="lens", frame=frame)


def main():
    output, quality = args()
    portrait = quality.startswith("portrait")
    draft = quality.endswith("draft")
    camera = build_scene()
    devices = configure_render(quality)
    if portrait:
        camera_pose(camera, 1, (2.8, -8.2, 3.45), (0, 0, 1.72), 43)
        camera_pose(camera, 48, (2.3, -7.9, 3.25), (0, 0, 1.72), 43)
        camera_pose(camera, 49, (1.15, -4.1, 2.85), (0, -0.10, 2.08), 46)
        camera_pose(camera, 72, (0.8, -3.75, 2.65), (0, -0.10, 2.08), 46)
    else:
        camera_pose(camera, 1, (3.65, -7.15, 3.25), (0, 0, 1.47), 51)
        camera_pose(camera, 48, (3.25, -6.9, 3.20), (0, 0, 1.47), 49)
        camera_pose(camera, 49, (1.6, -4.0, 2.8), (0, -0.10, 2.0), 60)
        camera_pose(camera, 72, (1.0, -3.6, 2.6), (0, -0.10, 2.0), 60)
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "form01_scene.blend"))
    animation_resolution = [scene.render.resolution_x, scene.render.resolution_y]
    animation_samples = scene.cycles.samples
    started = time.perf_counter()
    if draft:
        for frame in (1, 24, 48, 49, 72):
            scene.frame_set(frame)
            scene.render.filepath = str(output / f"draft_{frame:04d}.png")
            bpy.ops.render.render(write_still=True)
    else:
        frames = output / "frames"
        frames.mkdir(exist_ok=True)
        scene.render.filepath = str(frames / "frame_")
        bpy.ops.render.render(animation=True)
    scene.frame_set(1)
    camera.animation_data_clear()
    camera.data.animation_data_clear()
    camera.location = (2.55, -8.4, 3.45) if portrait else (3.5, -7.3, 3.25)
    look_at(camera, (0, 0, 2.17) if portrait else (-0.95, 0, 1.47))
    camera.data.lens = 41 if portrait else 48
    if not draft:
        scene.cycles.samples = 64
        scene.render.resolution_x = 900 if portrait else 1600
        scene.render.resolution_y = 1600 if portrait else 900
        bpy.ops.wm.save_as_mainfile(filepath=str(output / "form01_endcard_scene.blend"))
    scene.render.filepath = str(output / "endcard_product.png")
    bpy.ops.render.render(write_still=True)
    report = {
        "purpose": "Original fictional product design and creative workflow sample",
        "blender": bpy.app.version_string,
        "backend": "OPTIX",
        "devices": devices,
        "quality": quality,
        "aspect": "9:16" if portrait else "16:9",
        "resolution": animation_resolution,
        "samples": animation_samples,
        "render_seconds": round(time.perf_counter() - started, 3),
        "frame_count": 5 if draft else 72,
        "endcard_resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "endcard_samples": scene.cycles.samples,
    }
    (output / "render-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("FORM01_REPORT=" + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
