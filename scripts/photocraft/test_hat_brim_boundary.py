"""PhotoCraft golden sample: recolor the hat brim without tinting its shadow.

The RGB scan locates the original teal silhouette; PhotoCraft owns the actual
editable selection, adjustment layer, native document, and rendered preview.
"""

from io import BytesIO
from json import dumps, loads
from subprocess import run

from PIL import Image

from test_selection_refinement import ROOT, SOURCE, brim_coverage


CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
OUTPUT = ROOT / ".tools/photocraft-selection-qa"

# The top of the bill is partly hidden by the crown. These points follow that
# seam, while the visible lower edge is measured from the original pixels.
TOP_SEAM = [
    [277, 791], [335, 789], [390, 779], [450, 770], [510, 763],
    [570, 754], [630, 747], [690, 741], [750, 735], [810, 730],
    [870, 725], [930, 723], [989, 724],
]


def teal(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return blue - red > 17 and green - red > 13


def outer_right_edge(source: Image.Image) -> list[list[int]]:
    pixels = source.load()
    points = []
    for y in range(730, 941, 3):
        columns = [x for x in range(970, 1200) if teal(pixels[x, y])]
        assert columns, f"missing right boundary at y={y}"
        points.append([columns[-1] + 1, y])
    return points


def visible_edge(source: Image.Image) -> list[list[int]]:
    pixels = source.load()
    points = []
    for x in range(1170, 274, -3):
        rows = [y for y in range(780, 1060) if teal(pixels[x, y])]
        assert rows, f"missing teal boundary at x={x}"
        points.append([x, rows[-1]])
    return points


def render(outline: list[list[int]], stem: str) -> Image.Image:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = ROOT / "qa/fixtures/photocraft-hat-teal.png"
    document = OUTPUT / f"{stem}.pcraft"
    preview = OUTPUT / f"{stem}.png"
    selection = {"points": outline, "mode": "replace", "feather": 0}
    adjustment = {"colorize": True, "hue": 0, "saturation": 65, "lightness": 0}
    commands = [
        str(CLI), "run", str(source),
        "--cmd", "select.lasso", "--params", dumps(selection),
    ]
    commands += [
        "--cmd", "layer.newAdjustmentLayer.hueSaturation", "--params", dumps(adjustment),
        "--out", str(document),
    ]
    process = run(commands, capture_output=True, text=True, timeout=120)
    assert process.returncode == 0, process.stderr
    info = run([str(CLI), "info", str(document), "--compact"],
               capture_output=True, text=True, check=True, timeout=120)
    layers = loads(info.stdout)["layers"]
    assert len(layers) == 2 and layers[0]["hasMask"]
    run([str(CLI), "convert", str(document), str(preview)],
        capture_output=True, text=True, check=True, timeout=120)
    return Image.open(preview).convert("RGB")


def main() -> None:
    original = Image.open(BytesIO(SOURCE)).convert("RGB")
    outline = TOP_SEAM + outer_right_edge(original) + visible_edge(original)
    corrected = render(outline, "brim-boundary-corrected")
    sample, recolored, neutral_damage = brim_coverage(original, corrected)
    # The earlier result had a large cyan patch at the left tip and 77 changed
    # neutral/shadow sample pixels.
    assert recolored > 8200, (recolored, sample)
    assert neutral_damage == 0, neutral_damage
    def still_teal(pixel: tuple[int, int, int]) -> bool:
        red, green, blue = pixel
        return blue > red * 1.15 and green > red * 1.1 and max(pixel) > 60
    left_fabric = [
        (x, y) for x in range(350, 651, 2) for y in range(900, 1051, 2)
        if still_teal(original.getpixel((x, y)))
    ]
    new_residue = sum(still_teal(corrected.getpixel(point)) for point in left_fabric)
    assert new_residue <= 20, new_residue
    pixels = original.load()
    for x in range(600, 1150, 5):
        edge = max(y for y in range(780, 1060) if teal(pixels[x, y]))
        for y in range(edge + 5, min(edge + 101, original.height), 5):
            assert corrected.getpixel((x, y)) == pixels[x, y], (x, y)
    assert corrected.getpixel((700, 560)) == original.getpixel((700, 560))
    assert corrected.getpixel((600, 400)) == original.getpixel((600, 400))
    print(f"PASS: red brim {recolored}/{sample} teal fabric samples; "
          f"left residue {new_residue}/{len(left_fabric)}; "
          f"neutral/shadow changed samples {neutral_damage}; {len(outline)} contour points")


if __name__ == "__main__":
    main()
