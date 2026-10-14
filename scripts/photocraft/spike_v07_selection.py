"""Compare isolated PhotoCraft 0.7.0 selection outputs on the same fur sample."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.7.0/desktop/photocraft-0.7.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/v07"


def run(name: str, selection: tuple[str, dict], refine: dict) -> None:
    source = OUT / f"{name}.pcraft"
    preview = OUT / f"{name}.png"
    steps = [selection, ("select.refineEdge", refine), (
        "layer.newAdjustmentLayer.hueSaturation",
        {"colorize": True, "hue": 120, "saturation": 65, "lightness": 0},
    )]
    args = [str(CLI), "run", str(SOURCE)]
    for command, params in steps:
        args.extend(["--cmd", command, "--params", json.dumps(params)])
    args.extend(["--out", str(source)])
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    print(name, "exit", result.returncode, result.stdout[-500:], result.stderr[-250:])
    if result.returncode:
        return
    subprocess.run([str(CLI), "convert", str(source), str(preview)], check=True, capture_output=True, timeout=120)
    info = subprocess.run([str(CLI), "info", str(source), "--compact"], check=True, capture_output=True, text=True, timeout=120)
    parsed = json.loads(info.stdout)
    print(name, "selectionBounds", parsed.get("selectionBounds"), "layers", len(parsed.get("layers", [])))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, select, refine in [
        ("object-tight", ("select.object", {"rect": [1440, 210, 270, 310], "mode": "replace"}), {"radius": 12, "smartRadius": True, "smooth": 8, "feather": 2, "shiftEdge": -5, "output": "selection"}),
        ("object-wide", ("select.object", {"rect": [1390, 150, 390, 440], "mode": "replace"}), {"radius": 12, "smartRadius": True, "smooth": 8, "feather": 2, "shiftEdge": -5, "output": "selection"}),
        ("subject", ("select.subject", {}), {"radius": 12, "smartRadius": True, "smooth": 8, "feather": 2, "shiftEdge": -5, "output": "selection"}),
    ]:
        run(name, select, refine)
