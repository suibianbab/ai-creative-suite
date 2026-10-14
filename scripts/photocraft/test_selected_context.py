"""Saved PhotoCraft selection can drive an edit; stale layer binding is refused."""

import json
import os
from pathlib import Path
from subprocess import check_call, check_output
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = f"http://127.0.0.1:{os.environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"


def request(source: bytes, path: str, headers: dict[str, str]) -> dict:
    with urlopen(Request(BASE + path, data=source, headers=headers, method="POST"), timeout=120) as response:
        return json.load(response)


with TemporaryDirectory() as folder:
    selected_path = Path(folder) / "selected.pcraft"
    check_call([
        str(CLI), "run", str(ROOT / "qa/fixtures/photocraft-hat-teal.png"),
        "--cmd", "select.rect", "--params", '{"x":200,"y":100,"width":80,"height":80,"mode":"replace"}',
        "--out", str(selected_path),
    ])
    source = selected_path.read_bytes()
    info = request(source, "/v1/inspect", {"Content-Type": "application/x-photocraft"})
    assert info["hasSelection"] and info["selectionBounds"] == [200, 100, 80, 80], info
    assert len(info["selectedLayers"]) == 1, info
    headers = {
        "Content-Type": "application/x-photocraft",
        "X-Acs-Plan": json.dumps({"operation": "adjust", "adjustment": "brightness", "amount": 10,
                                  "target": "selected-area", "protectLabel": False,
                                  "expectedLayerId": info["activeLayer"]}),
        "X-Acs-Points": "[]", "X-Acs-Rect": "null", "X-Acs-Outline": "[]",
        "X-Acs-Patches": "[]", "X-Acs-Edge-Shift": "0", "X-Acs-Edge-Feather": "0",
        "X-Acs-Protect-Rect": "null", "X-Acs-Selection-Method": "existing",
    }
    edited = request(source, "/v1/instruction", headers)
    assert edited["layers"] == info["layers"] + 1, edited
    headers["X-Acs-Plan"] = json.dumps({"operation": "adjust", "adjustment": "brightness", "amount": 10,
                                       "target": "selected-area", "protectLabel": False,
                                       "expectedLayerId": 999999})
    try:
        request(source, "/v1/instruction", headers)
    except HTTPError as error:
        assert error.code == 400 and "当前图层已变化" in error.read().decode("utf-8")
    else:
        raise AssertionError("stale layer binding was accepted")
    print(json.dumps({"ok": True, "activeLayer": info["activeLayer"], "selection": info["selectionBounds"]}))
