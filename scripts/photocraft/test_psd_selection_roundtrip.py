"""Document the PhotoCraft 0.6.0 selection boundary across native and PSD saves."""

import json
import os
from pathlib import Path
from subprocess import check_call
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
BRIDGE = f"http://127.0.0.1:{os.environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"


def inspect(path: Path) -> dict:
    content_type = "image/vnd.adobe.photoshop" if path.suffix == ".psd" else "application/x-photocraft"
    request = Request(
        BRIDGE + "/v1/inspect",
        data=path.read_bytes(),
        headers={"Content-Type": content_type},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        return json.load(response)


with TemporaryDirectory() as folder:
    results = {}
    for extension in ("pcraft", "psd"):
        output = Path(folder) / f"selected.{extension}"
        check_call([
            str(CLI), "run", str(SOURCE),
            "--cmd", "select.rect",
            "--params", json.dumps({"x": 200, "y": 100, "width": 80, "height": 80, "mode": "replace"}),
            "--out", str(output),
        ])
        results[extension] = inspect(output)
    assert results["pcraft"]["hasSelection"] is True
    assert results["pcraft"]["selectionBounds"] == [200, 100, 80, 80]
    assert results["psd"]["hasSelection"] is False
    assert results["psd"]["selectionBounds"] is None
    assert results["pcraft"]["layers"] == results["psd"]["layers"]
    print(json.dumps({"nativeSelection": results["pcraft"]["selectionBounds"], "psdSelection": None}))
