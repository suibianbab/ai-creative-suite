"""Render gray-ear candidates through native PhotoCraft selections and adjustments."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
MASK = ROOT / ".tools/photocraft-selection-qa/v07/cat-birefnet-mask.png"
OUT = ROOT / ".tools/photocraft-selection-qa/gray-ear"
OUTLINE = [[1340, 415], [1420, 335], [1500, 240], [1590, 190], [1660, 225], [1690, 420], [1600, 485], [1450, 480]]


def render(name: str, feather: int, saturation: int, lightness: int) -> Path:
    native = OUT / f"{name}.pcraft"
    preview = OUT / f"{name}.png"
    commands = [
        ("file.placeEmbedded", {"path": str(MASK), "fit": False}),
        ("select.loadSelection", {"channel": "red", "operation": "new"}),
        ("layer.delete", {}),
        ("select.lasso", {"points": OUTLINE, "mode": "intersect", "feather": feather}),
        ("layer.newAdjustmentLayer.hueSaturation", {"saturation": saturation, "lightness": lightness}),
    ]
    args = [str(CLI), "run", str(SOURCE)]
    for command, params in commands:
        args.extend(["--cmd", command, "--params", json.dumps(params)])
    args.extend(["--out", str(native)])
    subprocess.run(args, check=True, capture_output=True, timeout=120)
    subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
    return preview


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for feather, saturation, lightness in [(20, -100, 0), (40, -100, 0), (60, -100, 0)]:
        name = f"gray-f{feather}-s{saturation}-l{lightness}"
        print(render(name, feather, saturation, lightness))


if __name__ == "__main__":
    main()
