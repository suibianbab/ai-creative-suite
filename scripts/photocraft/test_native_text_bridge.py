"""End-to-end native PhotoCraft text layer through the shared instruction bridge."""

from io import BytesIO
from os import environ
from json import dumps, loads
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
ORIGINAL = ROOT / "qa/fixtures/photocraft-hat-teal.png"
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def main() -> None:
    source = ORIGINAL.read_bytes()
    request = Request(f"{BASE}/v1/instruction", data=source, method="POST", headers={
        "Content-Type": "image/png",
        "X-Acs-Plan": dumps({"operation": "text", "target": "selected-area",
                              "protectLabel": False, "text": "SALE", "size": 64,
                              "color": "#cc2020"}),
        "X-Acs-Points": "[[250,200]]", "X-Acs-Rect": "null",
        "X-Acs-Outline": "[]", "X-Acs-Patches": "[]",
        "X-Acs-Edge-Shift": "0", "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": "null", "X-Acs-Selection-Method": "manual",
    })
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        editable = response.read()
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        preview = Image.open(BytesIO(response.read())).convert("RGB")
    original = Image.open(ORIGINAL).convert("RGB")
    assert ImageChops.difference(original.crop((200, 100, 650, 220)),
                                 preview.crop((200, 100, 650, 220))).getbbox()
    assert original.getpixel((1000, 1200)) == preview.getpixel((1000, 1200))
    with TemporaryDirectory() as folder:
        path = Path(folder) / "text.pcraft"
        path.write_bytes(editable)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
        assert info["layers"][0]["kind"] == "Type"
        assert info["layers"][0]["text"]["text"] == "SALE"
        assert len(info["layers"]) == 2
    assert ORIGINAL.read_bytes() == source
    with urlopen(f"{BASE}/v1/capabilities", timeout=20) as response:
        capabilities = loads(response.read())
    assert capabilities["version"] == "0.6.0"
    assert any(item["id"] == "type.create" for item in capabilities["groups"]["text"])
    print("PASS: PhotoCraft native text layer, editable reopen, preview and catalog")


if __name__ == "__main__":
    main()
