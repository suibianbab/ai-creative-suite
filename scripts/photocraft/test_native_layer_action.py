"""Current-layer duplicate and visibility through PhotoCraft's native bridge."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from subprocess import check_output
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")
ORIGINAL = ROOT / "qa/fixtures/photocraft-tiny.png"


def edit(source: bytes, mime: str, action: str, expected_layer: int | None = None) -> tuple[Image.Image, bytes, dict]:
    plan = {"operation": "layer-action", "target": "whole-image", "protectLabel": False, "action": action}
    if expected_layer is not None:
        plan["expectedLayerId"] = expected_layer
    request = Request(f"{BASE}/v1/instruction", data=source, method="POST", headers={
        "Content-Type": mime, "X-Acs-Plan": dumps(plan),
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
    return preview, native, info


def main() -> None:
    original = ORIGINAL.read_bytes()
    preview, duplicated, info = edit(original, "image/png", "duplicate")
    assert preview.size == (8, 8)
    assert len(info["layers"]) == 2
    assert all(layer["kind"] == "Pixel" for layer in info["layers"])
    current = info["activeLayer"]
    _, hidden, hidden_info = edit(duplicated, "application/x-photocraft", "hide", current)
    assert len(hidden_info["layers"]) == 2
    assert not next(layer for layer in hidden_info["layers"] if layer["id"] == current)["visible"]
    _, shown, shown_info = edit(hidden, "application/x-photocraft", "show", current)
    assert len(shown_info["layers"]) == 2
    assert next(layer for layer in shown_info["layers"] if layer["id"] == current)["visible"]
    assert shown != hidden and ORIGINAL.read_bytes() == original
    try:
        edit(duplicated, "application/x-photocraft", "hide", current + 10000)
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("Stale selected layer was accepted")
    print("PASS: PhotoCraft current-layer duplicate, hide, show and stale-layer rejection")


if __name__ == "__main__":
    main()
