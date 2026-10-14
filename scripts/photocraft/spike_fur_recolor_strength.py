"""Compare PhotoCraft-native fur recolor strengths on a fixed outline."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
MASK = ROOT / ".tools/photocraft-selection-qa/v07/cat-birefnet-mask.png"
OUT = ROOT / ".tools/photocraft-selection-qa/fur-strength"
OUTLINE = [[1340, 415], [1420, 335], [1500, 240], [1590, 190], [1660, 225], [1690, 420], [1600, 485], [1450, 480]]


def render(saturation: int, opacity: float, blend: str, colorize: bool = True, hue: int = 120, sample: bool = False, fuzziness: int = 100) -> Path:
    stem = f"green-{'colorize' if colorize else 'shift'}-h{hue}-s{saturation}-o{int(opacity * 100)}-{blend.lower()}" + (f"-sample{fuzziness}" if sample else "")
    native = OUT / f"{stem}.pcraft"
    preview = OUT / f"{stem}.png"
    commands = [
        ("file.placeEmbedded", {"path": str(MASK), "fit": False}),
        ("select.loadSelection", {"channel": "red", "operation": "new"}),
        ("layer.delete", {}),
        ("select.lasso", {"points": OUTLINE, "mode": "intersect", "feather": 20}),
        *([("select.colorRange", {"points": [[1525, 275], [1580, 245], [1620, 350]], "fuzziness": fuzziness, "mode": "intersect"})] if sample else []),
        ("layer.newAdjustmentLayer.hueSaturation", {"colorize": colorize, "hue": hue, "saturation": saturation, "lightness": 0}),
        ("layer.setProps", {"opacity": opacity, "blend": blend}),
    ]
    args = [str(CLI), "run", str(SOURCE)]
    for name, params in commands:
        args.extend(["--cmd", name, "--params", json.dumps(params)])
    args.extend(["--out", str(native)])
    subprocess.run(args, check=True, capture_output=True, timeout=120)
    subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
    return preview


def refine() -> Path:
    source = OUT / "green-colorize-h120-s35-o100-color-sample50.pcraft"
    native = OUT / "green-ear-native-brush.pcraft"
    preview = OUT / "green-ear-native-brush.png"
    args = [str(CLI), "run", str(source), "--cmd", "select.deselect", "--cmd", "paint.stroke", "--params", json.dumps({"points": [[1560, 300], [1575, 330], [1590, 360]], "size": 65, "hardness": 0.4, "opacity": 1, "color": "#000000", "target": "mask"}), "--out", str(native)]
    subprocess.run(args, check=True, capture_output=True, timeout=120)
    subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
    return preview


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for saturation, opacity, blend in [(10, 1.0, "Color"), (20, 1.0, "Color"), (35, 1.0, "Color"), (35, 1.0, "Hue")]:
        print(render(saturation, opacity, blend))


if __name__ == "__main__":
    main()
