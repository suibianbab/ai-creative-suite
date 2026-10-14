"""Editable native type styling and drop shadow through the capability adapter."""

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
ORIGINAL = ROOT / "qa/fixtures/photocraft-hat-teal.png"
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def edit(source: bytes, mime: str, plan: dict, points: list | None = None):
    request = Request(f"{BASE}/v1/instruction", data=source, method="POST", headers={
        "Content-Type": mime, "X-Acs-Plan": dumps(plan),
        "X-Acs-Points": dumps(points or []), "X-Acs-Rect": "null", "X-Acs-Outline": "[]",
        "X-Acs-Patches": "[]", "X-Acs-Edge-Shift": "0", "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": "null", "X-Acs-Selection-Method": "manual",
    })
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        editable = response.read()
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        preview = Image.open(BytesIO(response.read())).convert("RGB")
    return editable, preview


def main() -> None:
    original_bytes = ORIGINAL.read_bytes()
    source, _ = edit(original_bytes, "image/png", {
        "operation": "text", "target": "selected-area", "protectLabel": False,
        "text": "SALE", "size": 64, "color": "#cc2020",
    }, [[250, 200]])
    with TemporaryDirectory() as folder:
        source_path = Path(folder) / "source.pcraft"
        source_path.write_bytes(source)
        active_layer = loads(check_output([str(CLI), "info", str(source_path), "--compact"], text=True))["activeLayer"]
    styled, before_shadow = edit(source, "application/x-photocraft", {
        "operation": "text-style", "target": "whole-image", "protectLabel": False,
        "weight": 700, "underline": True, "expectedLayerId": active_layer,
    })
    shadowed, after_shadow = edit(styled, "application/x-photocraft", {
        "operation": "drop-shadow", "target": "whole-image", "protectLabel": False,
        "distance": 8, "size": 10, "opacity": 55, "expectedLayerId": active_layer,
    })
    assert ImageChops.difference(before_shadow, after_shadow).getbbox() is not None
    with TemporaryDirectory() as folder:
        path = Path(folder) / "styled.pcraft"
        path.write_bytes(shadowed)
        info = loads(check_output([str(CLI), "info", str(path), "--compact"], text=True))
        layer = info["layers"][0]
        assert layer["kind"] == "Type" and layer["text"]["text"] == "SALE"
        assert any(effect["kind"] == "Drop Shadow" for effect in layer["effects"]["items"])
        details = check_output([str(CLI), "run", str(path), "--cmd", "type.info",
                                "--params", "{}"], text=True)
        style = loads(details.strip().splitlines()[-1])["result"]["runs"][0]["style"]
        assert style["weight"] == 700 and style["underline"] is True
    assert ORIGINAL.read_bytes() == original_bytes
    try:
        edit(original_bytes, "image/png", {"operation": "drop-shadow", "target": "whole-image",
                                          "protectLabel": False, "distance": 8, "size": 10,
                                          "opacity": 55})
    except HTTPError as error:
        assert error.code == 400
        assert "整幅背景图层的投影不可见" in error.read().decode("utf-8")
    else:
        raise AssertionError("full-canvas background shadow should be rejected")
    with urlopen(f"{BASE}/v1/capabilities", timeout=20) as response:
        groups = loads(response.read())["groups"]
    assert any(item["id"] == "type.setStyle" for item in groups["text"])
    assert any(item["id"] == "layer.layerStyle.dropShadow" for item in groups["layer-style"])
    print("PASS: native editable type style and drop shadow, background guard")


if __name__ == "__main__":
    main()
