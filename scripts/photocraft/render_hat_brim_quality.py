"""Render the reviewable hat sample with PhotoCraft native selection and layers."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

from test_selection_refinement import brim_coverage


ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:4112"
OUTPUT = ROOT / "artifacts/photocraft-hat-brim-quality-2026-10-12"
ORIGINAL = ROOT / "qa/fixtures/photocraft-hat-teal.png"


def execute(source: bytes, content_type: str, plan: dict, *, rect=None,
            protect_rect=None, outline=None,
            selection_method="manual") -> tuple[dict, bytes, bytes]:
    headers = {
        "Content-Type": content_type,
        "X-Acs-Plan": dumps(plan),
        "X-Acs-Points": "[]",
        "X-Acs-Rect": dumps(rect),
        "X-Acs-Outline": dumps(outline or []),
        "X-Acs-Patches": "[]",
        "X-Acs-Edge-Shift": "0",
        "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": dumps(protect_rect),
        "X-Acs-Selection-Method": selection_method,
    }
    with urlopen(Request(f"{BASE}/v1/instruction", data=source,
                         headers=headers, method="POST"), timeout=120) as response:
        result = loads(response.read())
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        native = response.read()
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        preview = response.read()
    return result, native, preview


def main() -> None:
    source = ORIGINAL.read_bytes()
    original_image = Image.open(BytesIO(source)).convert("RGB")
    recolor, native, recolor_preview = execute(
        source, "image/png",
        {"operation": "recolor", "color": "red", "target": "brim", "protectLabel": True},
        rect=[270, 720, 920, 330], protect_rect=[620, 480, 270, 180],
        selection_method="object",
    )
    red_image = Image.open(BytesIO(recolor_preview)).convert("RGB")
    fabric, red, neutral_damage = brim_coverage(original_image, red_image)
    assert red >= 8200, (red, fabric)
    assert neutral_damage <= 20, neutral_damage
    assert red_image.getpixel((700, 560)) == original_image.getpixel((700, 560))
    assert red_image.getpixel((600, 400)) == original_image.getpixel((600, 400))

    adjust, native, _ = execute(
        native, "application/x-photocraft",
        {"operation": "adjust", "adjustment": "brightness", "amount": 10,
         "target": "whole-image", "protectLabel": False},
    )
    assert adjust["selectionBounds"] is None, "whole-image adjustment inherited local selection"

    crop, native, preview = execute(
        native, "application/x-photocraft",
        {"operation": "crop", "target": "selected-area", "protectLabel": False,
         "square": True}, rect=[27, 27, 1200, 1200],
    )
    assert (crop["width"], crop["height"], crop["layers"]) == (1200, 1200, 3)
    final_image = Image.open(BytesIO(preview)).convert("RGB")
    label_gray = final_image.convert("L").crop((600, 450, 830, 600))
    low, high = label_gray.getextrema()
    assert low < 90 and high > 190, "label contrast was lost"

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "hat-brim-red-bright-square.pcraft").write_bytes(native)
    (OUTPUT / "hat-brim-red-bright-square.png").write_bytes(preview)
    print(f"PhotoCraft quality sample: {red}/{fabric} brim pixels recolored, "
          f"neutral damage {neutral_damage}, 3 editable layers, 1200x1200")
    print(OUTPUT)


if __name__ == "__main__":
    main()
