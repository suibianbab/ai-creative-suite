"""Compose the Qwen hat spike with PhotoCraft's native masked layer."""

import json
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image
from test_hat_brim_boundary import TOP_SEAM, outer_right_edge, visible_edge
from test_selection_refinement import brim_coverage


ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:4112"
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
GENERATED = ROOT / "artifacts/qwen-local-edit-spike-2026-10-13.png"


def post(path: str, data: bytes, headers: dict[str, str]) -> dict:
    with urlopen(Request(BASE + path, data=data, headers=headers, method="POST"), timeout=120) as response:
        return json.load(response)


native = post("/v1/normalize", SOURCE.read_bytes(), {"Content-Type": "image/png"})
original = Image.open(SOURCE).convert("RGB")
outline = TOP_SEAM + outer_right_edge(original) + visible_edge(original)
result = post(
    "/v1/compose-generated",
    GENERATED.read_bytes(),
    {
        "Content-Type": "image/png",
        "x-acs-source-job": native["id"],
        "x-acs-generation-rect": "[250,720,920,350]",
        "x-acs-generation-outline": json.dumps(outline),
    },
)
with urlopen(BASE + result["previewUrl"], timeout=30) as response:
    preview = response.read()
with urlopen(BASE + result["sourceUrl"], timeout=30) as response:
    editable = response.read()
preview_path = ROOT / "artifacts/qwen-local-edit-photocraft-preview-2026-10-13.png"
source_path = ROOT / "artifacts/qwen-local-edit-photocraft-source-2026-10-13.pcraft"
preview_path.write_bytes(preview)
source_path.write_bytes(editable)
composed = Image.open(preview_path).convert("RGB")
assert original.size == composed.size
assert original.getpixel((100, 100)) == composed.getpixel((100, 100))
assert composed.getpixel((800, 850))[0] > composed.getpixel((800, 850))[1]
assert composed.getpixel((1168, 936))[0] > composed.getpixel((1168, 936))[1]
fabric, recolored, neutral_damage = brim_coverage(original, composed)
assert recolored >= fabric - 2, (fabric, recolored)
assert neutral_damage <= 30, neutral_damage
inspection = post("/v1/inspect", editable, {"Content-Type": "application/x-photocraft"})
assert any(layer["hasMask"] for layer in inspection["layerDetails"])
print(json.dumps({"preview": str(preview_path), "editable": str(source_path), "layers": result["layers"], "fabric": fabric, "recolored": recolored, "neutral_damage": neutral_damage}))
