"""Reproduce the approved hat preview with PhotoCraft native lasso and layers."""

from io import BytesIO

from PIL import Image

from render_hat_brim_quality import ORIGINAL, OUTPUT, execute
from test_hat_brim_boundary import (
    TOP_SEAM,
    outer_right_edge,
    visible_edge,
)
from test_selection_refinement import brim_coverage


def main() -> None:
    original = Image.open(ORIGINAL).convert("RGB")
    contour = TOP_SEAM + outer_right_edge(original) + visible_edge(original)
    recolor, native, recolor_preview = execute(
        ORIGINAL.read_bytes(), "image/png",
        {"operation": "recolor", "color": "red", "target": "brim", "protectLabel": True},
        outline=contour, protect_rect=[620, 480, 270, 180],
    )
    red_image = Image.open(BytesIO(recolor_preview)).convert("RGB")
    fabric, red, neutral_damage = brim_coverage(original, red_image)
    assert red >= 8250 and neutral_damage == 0, (red, fabric, neutral_damage)
    assert red_image.getpixel((700, 560)) == original.getpixel((700, 560))
    assert red_image.getpixel((600, 400)) == original.getpixel((600, 400))

    adjusted, native, _ = execute(
        native, "application/x-photocraft",
        {"operation": "adjust", "adjustment": "brightness", "amount": 10,
         "target": "whole-image", "protectLabel": False},
    )
    assert adjusted["selectionBounds"] is None
    cropped, native, preview = execute(
        native, "application/x-photocraft",
        {"operation": "crop", "target": "selected-area", "protectLabel": False,
         "square": True}, rect=[27, 27, 1200, 1200],
    )
    assert (cropped["width"], cropped["height"], cropped["layers"]) == (1200, 1200, 3)
    final = Image.open(BytesIO(preview)).convert("RGB")
    low, high = final.convert("L").crop((600, 450, 830, 600)).getextrema()
    assert low < 90 and high > 190, "label contrast was lost"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "hat-brim-red-bright-square-fine.pcraft").write_bytes(native)
    (OUTPUT / "hat-brim-red-bright-square-fine.png").write_bytes(preview)
    print(f"PhotoCraft fine sample: {red}/{fabric} brim fabric pixels red, "
          f"neutral/shadow changes {neutral_damage}; {len(contour)} native lasso points; "
          "3 editable layers, 1200x1200")


if __name__ == "__main__":
    main()
