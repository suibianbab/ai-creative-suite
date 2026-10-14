"""Compare a PhotoCraft brim lasso with native selection refinements."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "qa/fixtures/photocraft-hat-teal.png").read_bytes()
BASE = "http://127.0.0.1:4112"
OUTLINE = [
    [280, 800], [450, 790], [700, 750], [990, 730], [1080, 820],
    [1180, 930], [1120, 955], [960, 950], [820, 990], [630, 1035],
    [520, 1040], [400, 960], [280, 820],
]
PLAN = {"operation": "recolor", "color": "red", "target": "brim", "protectLabel": True}
PROTECT = [620, 480, 270, 180]


def edit(patches: list, shift: int, feather: int, points: list | None = None) -> Image.Image:
    request = Request(
        f"{BASE}/v1/instruction",
        data=SOURCE,
        headers={
            "Content-Type": "image/png",
            "X-Acs-Plan": dumps(PLAN),
            "X-Acs-Points": dumps(points or []),
            "X-Acs-Rect": "null",
            "X-Acs-Outline": dumps(OUTLINE),
            "X-Acs-Patches": dumps(patches),
            "X-Acs-Edge-Shift": str(shift),
            "X-Acs-Edge-Feather": str(feather),
            "X-Acs-Protect-Rect": dumps(PROTECT),
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    assert result["layers"] == 2
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        return Image.open(BytesIO(response.read())).convert("RGB")


def brim_coverage(original: Image.Image, output: Image.Image) -> tuple[int, int, int]:
    sample = 0
    recolored = 0
    background_damage = 0
    for y in range(800, 1045, 4):
        for x in range(300, 1180, 4):
            r, g, b = original.getpixel((x, y))
            nr, ng, nb = output.getpixel((x, y))
            if b > r * 1.15 and g > r * 1.1 and max(r, g, b) > 60:
                sample += 1
                if nr > nb * 1.15 and nr > ng * 1.15:
                    recolored += 1
            elif max(r, g, b) - min(r, g, b) < 12:
                if max(abs(nr - r), abs(ng - g), abs(nb - b)) > 20:
                    background_damage += 1
    return sample, recolored, background_damage


def main() -> None:
    original = Image.open(BytesIO(SOURCE)).convert("RGB")
    base = edit([], 0, 2)
    refined = edit(
        [
            {"mode": "add", "points": [[300, 860], [400, 855], [450, 970], [380, 930]]},
            {"mode": "subtract", "points": [[1020, 980], [1200, 980], [1200, 1050], [1020, 1050]]},
        ],
        10,
        2,
    )
    sampled = edit(
        [
            {"mode": "add", "points": [[300, 860], [400, 855], [450, 970], [380, 930]]},
            {"mode": "subtract", "points": [[1020, 980], [1200, 980], [1200, 1050], [1020, 1050]]},
        ],
        10,
        2,
        [[400, 850], [700, 850], [900, 850], [1050, 880]],
    )
    sampled_without_patches = edit(
        [], 10, 2, [[400, 850], [700, 850], [900, 850], [1050, 880]]
    )
    output_dir = ROOT / ".tools/photocraft-selection-qa"
    output_dir.mkdir(parents=True, exist_ok=True)
    base.save(output_dir / "brim-base.png")
    refined.save(output_dir / "brim-refined.png")
    sampled.save(output_dir / "brim-sampled.png")
    sampled_without_patches.save(output_dir / "brim-sampled-unpatched.png")
    base_total, base_red, base_damage = brim_coverage(original, base)
    refined_total, refined_red, refined_damage = brim_coverage(original, refined)
    sampled_total, sampled_red, sampled_damage = brim_coverage(original, sampled)
    assert base_total == refined_total == sampled_total
    assert refined_red > base_red + 100, "edge expansion did not recover enough brim fabric"
    assert refined_damage > base_damage, "test lost its background-bleed contrast"
    assert sampled_red >= refined_red, "color intersection lost expanded brim coverage"
    assert sampled_damage < base_damage / 2, "color intersection did not suppress background spill"
    changed_by_patches = sum(
        1
        for y in range(780, 1060, 2)
        for x in range(250, 1210, 2)
        if sampled.getpixel((x, y)) != sampled_without_patches.getpixel((x, y))
    )
    assert changed_by_patches > 1000, "add/subtract patches had no material effect"
    print(
        "PASS: refined brim coverage",
        f"{base_red}/{base_total} -> {sampled_red}/{sampled_total};",
        f"neutral/background changed samples {base_damage} -> {sampled_damage}",
    )
    assert refined.getpixel((700, 560)) == original.getpixel((700, 560)), "label protection failed"
    assert refined.getpixel((60, 80)) == original.getpixel((60, 80)), "background changed"
    assert refined.getpixel((600, 400)) == original.getpixel((600, 400)), "crown changed"
    assert refined.getpixel((700, 880))[0] > refined.getpixel((700, 880))[2]

    try:
        edit([{"mode": "erase", "points": [[300, 800], [400, 800], [400, 900]]}], 0, 2)
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("invalid selection patch accepted")
    try:
        edit([], 21, 2)
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("out-of-range edge expansion accepted")


if __name__ == "__main__":
    main()
