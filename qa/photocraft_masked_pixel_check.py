"""Check that a PhotoCraft native masked adjustment changes only its selected pixels."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
CLI = Path(os.environ.get("PHOTOCRAFT_CLI_PATH", ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"))
FIXTURE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
RECT = (200, 200, 300, 300)


def run(*args: str) -> None:
    subprocess.run([str(CLI), *args], check=True, capture_output=True, timeout=120)


def main() -> None:
    if not CLI.exists():
        raise RuntimeError(f"PhotoCraft CLI missing: {CLI}")
    with tempfile.TemporaryDirectory(prefix="acs-pc-mask-qa-") as directory:
        folder = Path(directory)
        source = folder / "source.pcraft"
        edited = folder / "edited.pcraft"
        before_png = folder / "before.png"
        after_png = folder / "after.png"
        run("convert", str(FIXTURE), str(source))
        run("convert", str(source), str(before_png))
        x, y, width, height = RECT
        run("run", str(source),
            "--cmd", "select.rect", "--params", json.dumps({
                "x": x, "y": y, "width": width, "height": height,
                "mode": "replace", "feather": 0,
            }),
            "--cmd", "layer.newAdjustmentLayer.brightnessContrast", "--params", json.dumps({"brightness": 30}),
            "--out", str(edited))
        run("convert", str(edited), str(after_png))
        with Image.open(before_png) as original, Image.open(after_png) as result:
            before = original.convert("RGBA")
            after = result.convert("RGBA")
            if before.size != after.size:
                raise AssertionError("Masked adjustment changed canvas size")
            changed_inside = 0
            changed_outside = 0
            for pixel_y in range(before.height):
                for pixel_x in range(before.width):
                    if before.getpixel((pixel_x, pixel_y)) == after.getpixel((pixel_x, pixel_y)):
                        continue
                    if x <= pixel_x < x + width and y <= pixel_y < y + height:
                        changed_inside += 1
                    else:
                        changed_outside += 1
            if changed_inside < 1000 or changed_outside != 0:
                raise AssertionError(f"Unexpected masked pixels: inside={changed_inside}, outside={changed_outside}")
            print(f"PASS: masked adjustment changed {changed_inside} selected pixels; outside changed={changed_outside}")


if __name__ == "__main__":
    main()
