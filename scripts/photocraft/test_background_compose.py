"""Exercise the PhotoCraft foreground-mask/background-layer composition contract."""

import json
import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
BASE = f"http://127.0.0.1:{os.environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"


def post(path: str, data: bytes, headers: dict[str, str]) -> dict:
    with urlopen(Request(BASE + path, data=data, headers=headers, method="POST"), timeout=120) as response:
        return json.load(response)


with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary)
    source = Image.new("RGB", (64, 64), "#e6e6e6")
    for y in range(18, 46):
        for x in range(18, 46):
            source.putpixel((x, y), (18, 80, 125))
    source_path = folder / "source.png"
    source.save(source_path)
    selected_path = folder / "selected.pcraft"
    subprocess.run([
        str(CLI), "run", str(source_path), "--cmd", "select.rect",
        "--params", json.dumps({"x": 18, "y": 18, "width": 28, "height": 28, "mode": "replace", "feather": 0}),
        "--out", str(selected_path),
    ], check=True, capture_output=True, timeout=30)
    native = post("/v1/normalize", selected_path.read_bytes(), {"Content-Type": "application/x-photocraft"})
    background = Image.new("RGB", (64, 64), "#d5b384")
    generated = BytesIO()
    background.save(generated, format="PNG")
    composed = post("/v1/compose-background", generated.getvalue(), {
        "Content-Type": "image/png",
        "x-acs-source-job": native["id"],
        "x-acs-foreground-selection": "existing",
    })
    with urlopen(BASE + composed["sourceUrl"], timeout=30) as response:
        editable = response.read()
    with urlopen(BASE + composed["previewUrl"], timeout=30) as response:
        preview = Image.open(BytesIO(response.read())).convert("RGB")
    inspection = post("/v1/inspect", editable, {"Content-Type": "application/x-photocraft"})
    assert inspection["layers"] == 3, inspection
    assert inspection["layerDetails"][0]["hasMask"] is True, inspection
    assert inspection["layerDetails"][1]["kind"] == "Smart Object", inspection
    assert preview.getpixel((32, 32)) == source.getpixel((32, 32))
    assert preview.getpixel((0, 0)) == background.getpixel((0, 0))
    shadow = post("/v1/compose-background", generated.getvalue(), {
        "Content-Type": "image/png", "x-acs-source-job": native["id"],
        "x-acs-foreground-selection": "existing", "x-acs-background-shadow": "on",
    })
    with urlopen(BASE + shadow["sourceUrl"], timeout=30) as response:
        shadow_path = folder / "shadow.pcraft"
        shadow_path.write_bytes(response.read())
    details = subprocess.run([str(CLI), "info", str(shadow_path), "--compact"],
                             check=True, capture_output=True, text=True, timeout=30)
    assert json.loads(details.stdout)["layers"][0]["effects"]["items"][0]["kind"] == "Drop Shadow"
    unselected = post("/v1/normalize", source_path.read_bytes(), {"Content-Type": "image/png"})
    try:
        post("/v1/compose-background", generated.getvalue(), {
            "Content-Type": "image/png", "x-acs-source-job": unselected["id"],
            "x-acs-foreground-selection": "existing",
        })
        raise AssertionError("missing saved selection accepted")
    except HTTPError as error:
        assert error.code == 400
    try:
        post("/v1/compose-background", generated.getvalue(), {
            "Content-Type": "image/png", "x-acs-source-job": native["id"],
            "x-acs-foreground-selection": "prepared",
        })
        raise AssertionError("unprepared source accepted")
    except HTTPError as error:
        assert error.code == 400
    prepared = post("/v1/prepare-foreground", b"", {
        "x-acs-source-job": native["id"], "x-acs-foreground-selection": "existing",
        "x-acs-foreground-patches": json.dumps([{
            "mode": "subtract", "points": [[18, 18], [28, 18], [28, 28], [18, 28]],
        }]),
    })
    with urlopen(BASE + prepared["previewUrl"], timeout=30) as response:
        selection_preview = Image.open(BytesIO(response.read())).convert("RGB")
    assert selection_preview.getpixel((32, 32)) == source.getpixel((32, 32))
    assert selection_preview.getpixel((22, 22)) == (216, 199, 173)
    repaired = post(f"/v1/jobs/{prepared['id']}/mask-stroke", json.dumps({
        "points": [[22, 22]], "mode": "add", "size": 8, "hardness": 1,
    }).encode(), {"Content-Type": "application/json"})
    finished = post("/v1/compose-background", generated.getvalue(), {
        "Content-Type": "image/png", "x-acs-source-job": repaired["id"],
        "x-acs-foreground-selection": "prepared", "x-acs-background-shadow": "on",
    })
    with urlopen(BASE + finished["previewUrl"], timeout=30) as response:
        final = Image.open(BytesIO(response.read())).convert("RGB")
    assert final.getpixel((22, 22)) == source.getpixel((22, 22))
    assert final.getpixel((0, 0)) == background.getpixel((0, 0))
    manual = post("/v1/prepare-foreground", b"", {
        "x-acs-source-job": unselected["id"], "x-acs-foreground-selection": "outline",
        "x-acs-foreground-outline": "[[18,18],[46,18],[46,46],[18,46]]",
    })
    with urlopen(BASE + manual["previewUrl"], timeout=30) as response:
        manual_preview = Image.open(BytesIO(response.read())).convert("RGB")
    assert manual_preview.getpixel((32, 32)) == source.getpixel((32, 32))
    print(json.dumps({"ok": True, "layers": inspection["layers"], "job": composed["id"]}))
