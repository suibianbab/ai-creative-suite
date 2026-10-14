"""Test whether a Provider alpha mask can become a PhotoCraft adjustment mask."""

import json
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/provider-spike"
MASK = ROOT / ".tools/photocraft-selection-qa/v07/cat-birefnet-mask.png"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    alpha = Image.open(MASK).convert("L")
    overlay = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    overlay.putalpha(alpha)
    overlay.save(OUT / "provider-alpha.png")
    steps = [
        ("file.placeEmbedded", {"path": str(MASK), "fit": False}),
        ("select.loadSelection", {"channel": "red", "operation": "new"}),
        ("layer.delete", {}),
        ("select.rect", {"x": 1360, "y": 145, "width": 440, "height": 450, "mode": "intersect", "feather": 80}),
        ("layer.newAdjustmentLayer.hueSaturation", {"colorize": True, "hue": 120, "saturation": 65, "lightness": 0}),
    ]
    args = [str(CLI), "run", str(SOURCE)]
    for command, params in steps:
        args.extend(["--cmd", command, "--params", json.dumps(params)])
    args.extend(["--out", str(OUT / "cat-ear-provider.pcraft")])
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    print("exit", result.returncode, result.stdout[-2000:], result.stderr[-500:])
    if result.returncode == 0:
        subprocess.run([str(CLI), "convert", str(OUT / "cat-ear-provider.pcraft"), str(OUT / "cat-ear-provider.png")], check=True, capture_output=True, timeout=120)
        info = subprocess.run([str(CLI), "info", str(OUT / "cat-ear-provider.pcraft"), "--compact"], check=True, capture_output=True, text=True, timeout=120)
        print(info.stdout[:1000])


if __name__ == "__main__":
    main()
