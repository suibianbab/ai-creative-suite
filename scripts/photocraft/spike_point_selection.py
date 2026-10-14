"""Test native PhotoCraft positive/negative quick selection on the cat ear."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/point-native"


def render(name: str, steps: list[tuple[str, dict]]) -> None:
    native = OUT / f"{name}.pcraft"
    preview = OUT / f"{name}.png"
    args = [str(CLI), "run", str(SOURCE)]
    for command, params in steps:
        args.extend(["--cmd", command, "--params", json.dumps(params)])
    args.extend(["--cmd", "layer.newAdjustmentLayer.hueSaturation", "--params", json.dumps({"saturation": -100, "lightness": 0}), "--out", str(native)])
    process = subprocess.run(args, capture_output=True, text=True, timeout=120)
    print(name, process.returncode, process.stdout[-600:], process.stderr[-250:])
    if process.returncode == 0:
        subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    positive = [[1530, 300], [1540, 350], [1520, 400]]
    negative = [[1490, 500], [1410, 480], [1640, 500]]
    render("quick-positive", [("select.quick", {"points": positive, "size": 30, "mode": "replace", "enhanceEdge": True})])
    render("quick-positive-negative", [
        ("select.quick", {"points": positive, "size": 30, "mode": "replace", "enhanceEdge": True}),
        ("select.quick", {"points": negative, "size": 45, "mode": "subtract", "enhanceEdge": True}),
    ])
    render("object-plus-negative", [
        ("select.object", {"rect": [1390, 150, 390, 440], "mode": "replace"}),
        ("select.quick", {"points": negative, "size": 45, "mode": "subtract", "enhanceEdge": True}),
    ])


if __name__ == "__main__":
    main()
