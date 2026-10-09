"""Report loaded model contents before building a product render scene."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main() -> None:
    output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    bounds = {
        "min": [round(min(point[axis] for point in corners), 5) for axis in range(3)],
        "max": [round(max(point[axis] for point in corners), 5) for axis in range(3)],
    } if corners else None
    images = []
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        resolved = Path(bpy.path.abspath(image.filepath, library=image.library)).resolve()
        images.append({"name": image.name, "path": str(resolved), "exists": resolved.is_file()})
    report = {
        "blender": bpy.app.version_string,
        "source_file": bpy.data.filepath,
        "mesh_count": len(meshes),
        "mesh_names": [obj.name for obj in meshes],
        "mesh_bounds": {
            obj.name: {
                "min": [round(min((obj.matrix_world @ Vector(corner))[axis] for corner in obj.bound_box), 5) for axis in range(3)],
                "max": [round(max((obj.matrix_world @ Vector(corner))[axis] for corner in obj.bound_box), 5) for axis in range(3)],
            }
            for obj in meshes
        },
        "triangle_count": sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons) for obj in meshes),
        "material_names": [material.name for material in bpy.data.materials],
        "bounds_meters": bounds,
        "images": images,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("MODEL_INSPECTION=" + json.dumps(report), flush=True)
    if not meshes or any(not item["exists"] for item in images):
        raise RuntimeError("Model has no meshes or missing textures")


if __name__ == "__main__":
    main()
