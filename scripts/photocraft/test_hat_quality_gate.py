"""Regression: reject the visibly damaged coarse brim selection."""

from io import BytesIO

from PIL import Image

from render_hat_brim_quality import ORIGINAL, execute
from test_hat_brim_boundary import TOP_SEAM, outer_right_edge, visible_edge
from test_selection_refinement import brim_coverage


def quality(image: Image.Image, edited: Image.Image) -> tuple[int, int]:
    fabric, red, neutral_damage = brim_coverage(image, edited)
    assert fabric > 8000
    return red, neutral_damage


def main() -> None:
    original = Image.open(ORIGINAL).convert("RGB")
    plan = {"operation": "recolor", "color": "red", "target": "brim", "protectLabel": True}
    common = {"protect_rect": [620, 480, 270, 180]}
    rough_outline = [[270, 790], [990, 714], [1180, 935], [870, 1000], [520, 1060]]
    fine_outline = TOP_SEAM + outer_right_edge(original) + visible_edge(original)
    results = []
    for outline in (rough_outline, fine_outline):
        _, _, preview = execute(ORIGINAL.read_bytes(), "image/png", plan,
                                outline=outline, **common)
        results.append(quality(original, Image.open(BytesIO(preview)).convert("RGB")))
    rough_red, rough_damage = results[0]
    fine_red, fine_damage = results[1]
    assert rough_red < 8200 or rough_damage > 20, "bad rough selection passed quality gate"
    assert fine_red >= 8250 and fine_damage <= 20, "approved fine selection failed quality gate"
    print(f"PASS: coarse rejected ({rough_red} red, {rough_damage} background damage); "
          f"fine accepted ({fine_red} red, {fine_damage} background damage)")


if __name__ == "__main__":
    main()
