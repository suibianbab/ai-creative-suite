"""Verify saved PhotoCraft selections on real Qwen edit samples."""

import json
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:4112"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"


def post(path: str, data: bytes, headers: dict[str, str]) -> dict:
    with urlopen(Request(BASE + path, data=data, headers=headers, method="POST"), timeout=120) as response:
        return json.load(response)


def compose(case: str, commands: list[tuple[str, dict]], rect: list[int], generated_case: str | None = None) -> dict:
    with tempfile.TemporaryDirectory() as temporary:
        selected = Path(temporary) / "selected.pcraft"
        args = [str(CLI), "run", str(SOURCE)]
        for name, params in commands:
            args.extend(["--cmd", name, "--params", json.dumps(params)])
        args.extend(["--out", str(selected)])
        subprocess.run(args, check=True, capture_output=True, timeout=120)
        job = post("/v1/normalize", selected.read_bytes(), {"Content-Type": "application/x-photocraft"})
    generated = ROOT / f"artifacts/qwen-{generated_case or case}-spike-2026-10-13.png"
    result = post("/v1/compose-generated", generated.read_bytes(), {
        "Content-Type": "image/png",
        "x-acs-source-job": job["id"],
        "x-acs-generation-rect": json.dumps(rect),
        "x-acs-generation-selection": "existing",
    })
    with urlopen(BASE + result["previewUrl"], timeout=30) as response:
        preview = response.read()
    with urlopen(BASE + result["sourceUrl"], timeout=30) as response:
        native = response.read()
    preview_path = ROOT / f"artifacts/qwen-{case}-saved-selection-preview-2026-10-13.png"
    source_path = ROOT / f"artifacts/qwen-{case}-saved-selection-2026-10-13.pcraft"
    preview_path.write_bytes(preview)
    source_path.write_bytes(native)
    info = post("/v1/inspect", native, {"Content-Type": "application/x-photocraft"})
    assert info["layers"] == 2 and any(layer["hasMask"] for layer in info["layerDetails"])
    image = Image.open(preview_path).convert("RGB")
    original = Image.open(SOURCE).convert("RGB")
    assert image.size == original.size
    assert image.getpixel((100, 100)) == original.getpixel((100, 100)) if case == "remove" else True
    return {"case": case, "id": result["id"], "preview": str(preview_path), "source": str(source_path), "layers": info["layers"]}


print(json.dumps(compose("remove", [
    ("select.rect", {"x": 600, "y": 470, "width": 300, "height": 190, "mode": "replace", "feather": 15}),
], [600, 470, 300, 190])))

background = ROOT / "artifacts/qwen-background-spike-2026-10-13.png"
if background.exists():
    background_result = compose("background", [
        ("select.subject", {"sampleAllLayers": True, "mode": "replace"}),
        ("select.inverse", {}),
    ], [0, 0, 1254, 1254])
    print(json.dumps(background_result))
    stroke = post(f"/v1/jobs/{background_result['id']}/mask-stroke", json.dumps({
        "points": [[145, 817], [180, 855], [220, 895], [270, 935], [320, 965],
                   [380, 993], [440, 1015], [500, 1035], [560, 1045], [620, 1044],
                   [680, 1035], [740, 1017], [800, 995], [860, 975], [920, 958],
                   [980, 948], [1040, 946], [1100, 949], [1155, 953]],
        "mode": "add", "size": 22, "hardness": 0.75,
    }).encode(), {"Content-Type": "application/json"})
    with urlopen(BASE + stroke["previewUrl"], timeout=30) as response:
        brushed_preview = response.read()
    with urlopen(BASE + stroke["sourceUrl"], timeout=30) as response:
        brushed_source = response.read()
    brush_preview_path = ROOT / "artifacts/qwen-background-brushed-preview-2026-10-13.png"
    brush_source_path = ROOT / "artifacts/qwen-background-brushed-2026-10-13.pcraft"
    brush_preview_path.write_bytes(brushed_preview)
    brush_source_path.write_bytes(brushed_source)
    brush_info = post("/v1/inspect", brushed_source, {"Content-Type": "application/x-photocraft"})
    assert brush_info["layers"] == 2 and any(layer["hasMask"] for layer in brush_info["layerDetails"])
    print(json.dumps({"case": "background-brushed", "preview": str(brush_preview_path), "source": str(brush_source_path)}))
    print(json.dumps(compose("background-object", [
        ("select.object", {"rect": [60, 170, 1130, 900], "mode": "replace", "sampleAllLayers": True}),
        ("select.inverse", {}),
    ], [0, 0, 1254, 1254], generated_case="background")))
    print(json.dumps(compose("background-shadow-refined", [
        ("select.subject", {"sampleAllLayers": True, "mode": "replace"}),
        ("select.colorRange", {"select": "sampledColors", "points": [[200, 840], [900, 1000]], "fuzziness": 40, "sampleAllLayers": True, "mode": "subtract"}),
        ("select.inverse", {}),
    ], [0, 0, 1254, 1254], generated_case="background")))
