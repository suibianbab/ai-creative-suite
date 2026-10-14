"""PhotoCraft generated-layer integration smoke test with a local PNG stand-in."""

import json
import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
BASE = f"http://127.0.0.1:{os.environ.get('PHOTOCRAFT_BRIDGE_PORT', '4112')}"


def post(path: str, data: bytes, headers: dict[str, str]) -> dict:
    request = Request(BASE + path, data=data, headers=headers, method="POST")
    with urlopen(request, timeout=120) as response:
        return json.load(response)


source = (ROOT / "qa/fixtures/photocraft-tiny.pcraft").read_bytes()
original = Image.open(ROOT / "qa/fixtures/photocraft-tiny.png").convert("RGB")
generated_image = Image.new("RGB", original.size, "#ff0000")
generated_buffer = BytesIO()
generated_image.save(generated_buffer, format="PNG")
generated = generated_buffer.getvalue()
native = post("/v1/normalize", source, {"Content-Type": "application/x-photocraft"})
result = post(
    "/v1/compose-generated",
    generated,
    {
        "Content-Type": "image/png",
        "x-acs-source-job": native["id"],
        "x-acs-generation-rect": "[1,1,4,4]",
    },
)
assert result["layers"] == 2, result
assert result["width"] == result["height"] == 8, result
with urlopen(BASE + result["sourceUrl"], timeout=30) as response:
    edited = response.read()
inspection = post("/v1/inspect", edited, {"Content-Type": "application/x-photocraft"})
assert inspection["layers"] == 2, inspection
assert any(layer["hasMask"] for layer in inspection["layerDetails"]), inspection
with urlopen(BASE + result["previewUrl"], timeout=30) as response:
    preview = Image.open(BytesIO(response.read())).convert("RGB")
assert preview.getpixel((0, 0)) == original.getpixel((0, 0))
assert preview.getpixel((2, 2))[0] > preview.getpixel((2, 2))[1]

outlined = post(
    "/v1/compose-generated",
    generated,
    {
        "Content-Type": "image/png",
        "x-acs-source-job": native["id"],
        "x-acs-generation-rect": "[0,0,8,8]",
        "x-acs-generation-outline": "[[2,2],[5,2],[5,5],[2,5]]",
    },
)
with urlopen(BASE + outlined["sourceUrl"], timeout=30) as response:
    outlined_source = response.read()
outlined_inspection = post("/v1/inspect", outlined_source, {"Content-Type": "application/x-photocraft"})
assert any(layer["hasMask"] for layer in outlined_inspection["layerDetails"])
with urlopen(BASE + outlined["previewUrl"], timeout=30) as response:
    outlined_preview = Image.open(BytesIO(response.read())).convert("RGB")
assert outlined_preview.getpixel((7, 7)) == original.getpixel((7, 7))
assert outlined_preview.getpixel((3, 3))[0] > outlined_preview.getpixel((3, 3))[1]
brush = post(f"/v1/jobs/{outlined['id']}/mask-stroke", json.dumps({
    "points": [[6, 6]], "mode": "add", "size": 3, "hardness": 1,
}).encode(), {"Content-Type": "application/json"})
with urlopen(BASE + brush["sourceUrl"], timeout=30) as response:
    brushed_source = response.read()
brushed_info = post("/v1/inspect", brushed_source, {"Content-Type": "application/x-photocraft"})
assert brushed_info["layers"] == 2 and any(layer["hasMask"] for layer in brushed_info["layerDetails"])
with urlopen(BASE + brush["previewUrl"], timeout=30) as response:
    brushed_preview = Image.open(BytesIO(response.read())).convert("RGB")
assert brushed_preview.getpixel((6, 6))[0] > brushed_preview.getpixel((6, 6))[1]
print(json.dumps({"ok": True, "rectangle": result["id"], "outline": outlined["id"], "layers": result["layers"]}))

cli = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
with tempfile.TemporaryDirectory() as temporary:
    selected_path = Path(temporary) / "selected.pcraft"
    subprocess.run([
        str(cli), "run", str(ROOT / "qa/fixtures/photocraft-tiny.pcraft"),
        "--cmd", "select.rect",
        "--params", '{"x":2,"y":2,"width":3,"height":3,"mode":"replace","feather":0}',
        "--out", str(selected_path),
    ], check=True, capture_output=True, timeout=30)
    selected_job = post("/v1/normalize", selected_path.read_bytes(), {"Content-Type": "application/x-photocraft"})

try:
    post("/v1/compose-generated", generated, {
        "Content-Type": "image/png",
        "x-acs-source-job": native["id"],
        "x-acs-generation-rect": "[2,2,3,3]",
        "x-acs-generation-selection": "existing",
    })
    raise AssertionError("missing saved selection accepted")
except HTTPError as error:
    assert error.code == 400

saved_selection = post("/v1/compose-generated", generated, {
    "Content-Type": "image/png",
    "x-acs-source-job": selected_job["id"],
    "x-acs-generation-rect": "[2,2,3,3]",
    "x-acs-generation-selection": "existing",
})
with urlopen(BASE + saved_selection["sourceUrl"], timeout=30) as response:
    reopened = response.read()
saved_info = post("/v1/inspect", reopened, {"Content-Type": "application/x-photocraft"})
assert saved_info["layers"] == 2 and any(layer["hasMask"] for layer in saved_info["layerDetails"])
with urlopen(BASE + saved_selection["previewUrl"], timeout=30) as response:
    saved_preview = Image.open(BytesIO(response.read())).convert("RGB")
assert saved_preview.getpixel((0, 0)) == original.getpixel((0, 0))
assert saved_preview.getpixel((3, 3))[0] > saved_preview.getpixel((3, 3))[1]
print(json.dumps({"saved_selection": saved_selection["id"], "layers": saved_info["layers"]}))
