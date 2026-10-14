"""Render point-mask candidates with PhotoCraft's native adjustment layer."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/sam2-ear"


def main() -> None:
    for name in ("2p-2n-box-full-1", "2p-2n-box-full-2", "3p-5n-box-full-1"):
        mask = OUT / f"{name}.png"
        native = OUT / f"{name}-edited.pcraft"
        preview = OUT / f"{name}-edited.png"
        commands = [
            ("file.placeEmbedded", {"path": str(mask), "fit": False}),
            ("select.loadSelection", {"channel": "red", "operation": "new"}),
            ("layer.delete", {}),
            ("select.modify.feather", {"radius": 6}),
            ("layer.newAdjustmentLayer.hueSaturation", {"saturation": -100, "lightness": 0}),
        ]
        args = [str(CLI), "run", str(SOURCE)]
        for command, params in commands:
            args.extend(["--cmd", command, "--params", json.dumps(params)])
        args.extend(["--out", str(native)])
        subprocess.run(args, check=True, capture_output=True, timeout=120)
        subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
        print(preview)


if __name__ == "__main__":
    main()
