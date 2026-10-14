"""Verify whole-image adjustments and non-destructive crop through PhotoCraft."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "qa/fixtures/photocraft-hat-teal.png").read_bytes()
BASE = "http://127.0.0.1:4112"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"


def request(plan: dict, rect: list[int] | None = None) -> dict:
    operation = Request(
        f"{BASE}/v1/instruction",
        data=SOURCE,
        headers={
            "Content-Type": "image/png",
            "X-Acs-Plan": dumps(plan),
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


def preview(result: dict) -> Image.Image:
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        return Image.open(BytesIO(response.read())).convert("RGB")


def main() -> None:
    original = Image.open(BytesIO(SOURCE)).convert("RGB")
    crop = request({"operation": "crop", "target": "selected-area", "protectLabel": False}, [200, 200, 800, 800])
    cropped = preview(crop)
    assert cropped.size == (800, 800)
    assert cropped.getpixel((0, 0)) == original.getpixel((200, 200))
    assert crop["layers"] == 1
    with urlopen(f"{BASE}{crop['sourceUrl']}", timeout=120) as response:
        source = response.read()
    assert source[:4] == b"PK\x03\x04"
    with TemporaryDirectory() as folder:
        path = Path(folder) / "crop.pcraft"
        path.write_bytes(source)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
        assert info["layers"][0]["bounds"] == [-200, -200, 1254, 1254]

    for adjustment, amount in [("brightness", 25), ("contrast", 25), ("saturation", -50)]:
        result = request({
            "operation": "adjust", "target": "whole-image",
            "adjustment": adjustment, "amount": amount,
            "protectLabel": False,
        })
        edited = preview(result)
        assert edited.size == original.size
        assert result["layers"] == 2
        assert edited.getpixel((500, 450)) != original.getpixel((500, 450)), adjustment

    for plan, rect in [
        ({"operation": "crop", "target": "selected-area", "protectLabel": False}, None),
        ({"operation": "adjust", "target": "whole-image", "adjustment": "brightness", "amount": 25, "protectLabel": True}, None),
    ]:
        try:
            request(plan, rect)
        except HTTPError as error:
            assert error.code == 400
        else:
            raise AssertionError(f"invalid plan accepted: {plan}")
    print("PASS: PhotoCraft crop and global brightness/contrast/saturation native edits")


if __name__ == "__main__":
    main()
