"""Check PhotoCraft quick negative seeds against the existing cat subject mask."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
MASK = ROOT / ".tools/photocraft-selection-qa/v07/cat-birefnet-mask.png"
OUT = ROOT / ".tools/photocraft-selection-qa/point-native"
RECT = {"x": 1320, "y": 150, "width": 400, "height": 420, "mode": "intersect", "feather": 0}


def render(name: str, points: list[list[int]], size: int) -> None:
    commands = [
        ("file.placeEmbedded", {"path": str(MASK), "fit": False}),
        ("select.loadSelection", {"channel": "red", "operation": "new"}),
        ("layer.delete", {}),
        ("select.rect", RECT),
        ("select.quick", {"points": points, "size": size, "mode": "subtract", "enhanceEdge": True}),
        ("select.modify.feather", {"radius": 3}),
        ("layer.newAdjustmentLayer.hueSaturation", {"saturation": -100, "lightness": 0}),
    ]
    native = OUT / f"{name}.pcraft"
    args = [str(CLI), "run", str(SOURCE)]
    for command, params in commands:
        args.extend(["--cmd", command, "--params", json.dumps(params)])
    args.extend(["--out", str(native)])
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=120)
    print(name, result.stdout[-280:])
    subprocess.run([str(CLI), "convert", str(native), str(OUT / f"{name}.png")], check=True, capture_output=True, timeout=120)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render("subject-neg-3", [[1450, 510], [1530, 510], [1600, 500]], 45)
    render("subject-neg-5", [[1400, 475], [1450, 510], [1530, 510], [1600, 500], [1650, 460]], 45)


if __name__ == "__main__":
    main()
