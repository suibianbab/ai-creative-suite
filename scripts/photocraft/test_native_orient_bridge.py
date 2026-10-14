"""PhotoCraft native orientation commands through the editable bridge."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def edit(source: bytes, mode: str) -> tuple[Image.Image, dict]:
    plan = {"operation": "orient", "target": "whole-image", "protectLabel": False, "mode": mode}
    request = Request(f"{BASE}/v1/instruction", data=source, method="POST", headers={
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
        native = response.read()
    with TemporaryDirectory() as folder:
        path = Path(folder) / "edited.pcraft"
        path.write_bytes(native)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
    assert preview.size == (result["width"], result["height"])
    return preview, info


def main() -> None:
    original = Image.new("RGB", (5, 3))
    for y in range(3):
        for x in range(5):
            original.putpixel((x, y), (20 + x * 31, 30 + y * 68, 10 + x * 17 + y * 19))
    encoded = BytesIO()
    original.save(encoded, format="PNG")
    source = encoded.getvalue()
    cases = {
        "rotate-cw": Image.Transpose.ROTATE_270,
        "rotate-ccw": Image.Transpose.ROTATE_90,
        "rotate-180": Image.Transpose.ROTATE_180,
        "flip-horizontal": Image.Transpose.FLIP_LEFT_RIGHT,
        "flip-vertical": Image.Transpose.FLIP_TOP_BOTTOM,
    }
    for mode, transform in cases.items():
        preview, info = edit(source, mode)
        expected = original.transpose(transform)
        assert preview.size == expected.size, mode
        assert ImageChops.difference(preview, expected).getbbox() is None, mode
        assert (info["width"], info["height"]) == expected.size, mode
        assert len(info["layers"]) == 1 and info["layers"][0]["kind"] == "Pixel", mode
    assert source == encoded.getvalue()
    try:
        edit(source, "rotate-37")
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("Unsupported orientation was accepted")
    print("PASS: five native PhotoCraft orientations preview and reopen correctly")


if __name__ == "__main__":
    main()
