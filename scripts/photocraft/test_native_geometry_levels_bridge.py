"""Native image resampling and editable Levels through the shared bridge."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
ORIGINAL = ROOT / "qa/fixtures/photocraft-tiny.png"
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def edit(plan: dict) -> tuple[dict, Image.Image, dict]:
    request = Request(f"{BASE}/v1/instruction", data=ORIGINAL.read_bytes(), method="POST", headers={
        "Content-Type": "image/png", "X-Acs-Plan": dumps(plan),
        "X-Acs-Points": "[]", "X-Acs-Rect": "null", "X-Acs-Outline": "[]",
        "X-Acs-Patches": "[]", "X-Acs-Edge-Shift": "0", "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": "null", "X-Acs-Selection-Method": "manual",
    })
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        preview = Image.open(BytesIO(response.read())).convert("RGB")
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        source = response.read()
    with TemporaryDirectory() as folder:
        path = Path(folder) / "edited.pcraft"
        path.write_bytes(source)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
    return result, preview, info


def main() -> None:
    original_bytes = ORIGINAL.read_bytes()
    original = Image.open(ORIGINAL).convert("RGB")

    result, preview, info = edit({"operation": "image-size", "target": "whole-image",
                                  "protectLabel": False, "width": 16, "height": 16})
    assert (result["width"], result["height"]) == (16, 16)
    assert preview.size == (16, 16)
    assert (info["width"], info["height"]) == (16, 16)
    assert len(info["layers"]) == 1 and info["layers"][0]["kind"] == "Pixel"

    result, preview, info = edit({"operation": "levels", "target": "whole-image",
                                  "protectLabel": False, "inBlack": 20, "inWhite": 235,
                                  "gamma": 1.2})
    assert (result["width"], result["height"]) == original.size
    assert ImageChops.difference(original, preview).getbbox() is not None
    assert len(info["layers"]) == 2 and info["layers"][0]["kind"] == "Adjustment"
    assert info["layers"][0]["hasMask"]
    master = info["layers"][0]["adjustment"]["Levels"]["master"]
    assert abs(master["in_black"] * 255 - 20) < 0.02
    assert abs(master["in_white"] * 255 - 235) < 0.02
    assert abs(master["gamma"] - 1.2) < 0.001
    assert ORIGINAL.read_bytes() == original_bytes
    print("PASS: native PhotoCraft image size and editable Levels preview/reopen")


if __name__ == "__main__":
    main()
