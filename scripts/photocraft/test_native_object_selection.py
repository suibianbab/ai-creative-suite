"""Exercise PhotoCraft's own Object Selection and Refine Edge via the bridge."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

from test_selection_refinement import brim_coverage


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "qa/fixtures/photocraft-hat-teal.png").read_bytes()
BASE = f"http://127.0.0.1:{environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"


def request(rect: list[int] | None, color: str = "red") -> dict:
    operation = Request(
        f"{BASE}/v1/instruction",
        data=SOURCE,
        headers={
            "Content-Type": "image/png",
            "X-Acs-Plan": dumps({
                "operation": "recolor", "color": color, "target": "brim",
                "protectLabel": False,
            }),
            "X-Acs-Points": "[]",
            "X-Acs-Rect": dumps(rect),
            "X-Acs-Outline": "[]",
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": "object",
        },
        method="POST",
    )
    with urlopen(operation, timeout=120) as response:
        return loads(response.read())


def main() -> None:
    original = Image.open(BytesIO(SOURCE)).convert("RGB")
    result = request([270, 720, 920, 330])
    assert result["layers"] == 2
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        output = Image.open(BytesIO(response.read())).convert("RGB")
    fabric, red, neutral_damage = brim_coverage(original, output)
    assert red >= 8200, (red, fabric)
    assert neutral_damage <= 20, neutral_damage
    assert output.getpixel((700, 560)) == original.getpixel((700, 560))
    assert output.getpixel((600, 400)) == original.getpixel((600, 400))
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        assert response.read(4) == b"PK\x03\x04"  # native editable bundle
    black_result = request([270, 720, 920, 330], "black")
    with urlopen(f"{BASE}{black_result['previewUrl']}", timeout=120) as response:
        black_output = Image.open(BytesIO(response.read())).convert("RGB")
    before = original.getpixel((650, 890))
    after = black_output.getpixel((650, 890))
    assert sum(after) < sum(before) * 0.5, (before, after)
    assert black_output.getpixel((600, 400)) == original.getpixel((600, 400))
    try:
        request(None)
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("object selection without a box was accepted")
    try:
        request([0, 0, 10, 10])
    except HTTPError as error:
        message = loads(error.read())["error"]
        assert error.code == 400
        assert "未在画框中识别到物体" in message, message
        assert "no selection" not in message, message
    else:
        raise AssertionError("empty object selection was accepted")
    try:
        request([1060, 800, 25, 25])
    except HTTPError as error:
        message = loads(error.read())["error"]
        assert error.code == 400
        assert "只识别到很小的区域" in message, message
    else:
        raise AssertionError("tiny object selection was accepted as a visible edit")
    print(f"PASS: PhotoCraft object selection {red}/{fabric}, neutral damage {neutral_damage}")


if __name__ == "__main__":
    main()
