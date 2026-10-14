"""A new capability must work through the shared native bridge and remain editable."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
ORIGINAL = ROOT / "qa/fixtures/photocraft-tiny.png"
BASE = f"http://127.0.0.1:{environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"


def main() -> None:
    source = ORIGINAL.read_bytes()
    request = Request(f"{BASE}/v1/instruction", data=source, method="POST", headers={
        "Content-Type": "image/png",
        "X-Acs-Plan": dumps({"operation": "canvas-size", "target": "whole-image",
                              "protectLabel": False, "width": 12, "height": 10}),
        "X-Acs-Points": "[]", "X-Acs-Rect": "null", "X-Acs-Outline": "[]",
        "X-Acs-Patches": "[]", "X-Acs-Edge-Shift": "0", "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": "null", "X-Acs-Selection-Method": "manual",
    })
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    assert (result["width"], result["height"]) == (12, 10)
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        image = Image.open(BytesIO(response.read())).convert("RGB")
        assert image.size == (12, 10)
        original_image = Image.open(ORIGINAL).convert("RGB")
        assert image.crop((2, 1, 10, 9)).tobytes() == original_image.tobytes()
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        editable = response.read()
    with TemporaryDirectory() as folder:
        path = Path(folder) / "canvas.pcraft"
        path.write_bytes(editable)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
        assert (info["width"], info["height"]) == (12, 10)
        assert len(info["layers"]) == 1
    assert ORIGINAL.read_bytes() == source
    print("PASS: canvas expansion through PhotoCraft, reopen and preview")


if __name__ == "__main__":
    main()
