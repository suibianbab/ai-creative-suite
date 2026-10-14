"""Compare native PhotoCraft mask brush corrections at the gray ear root."""

import json
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
FOLDER = ROOT / ".tools/photocraft-selection-qa/gray-ear"
SOURCE = FOLDER / "gray-ear-bridge.pcraft"
ORIGINAL = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
PATHS = {
    "root-soft-40": (40, [[1350, 485], [1390, 495], [1430, 505], [1470, 510], [1510, 510], [1550, 510], [1590, 510], [1630, 495]]),
    "root-soft-60": (60, [[1350, 485], [1390, 495], [1430, 505], [1470, 510], [1510, 510], [1550, 510], [1590, 510], [1630, 495]]),
    "root-contour-45": (45, [[1330, 455], [1370, 472], [1410, 488], [1450, 497], [1490, 504], [1530, 505], [1570, 502], [1610, 490], [1650, 472]]),
}


def run_case(name: str, size: int, points: list[list[int]]) -> Path:
    native = FOLDER / f"{name}.pcraft"
    preview = FOLDER / f"{name}.png"
    params = {"points": points, "size": size, "hardness": 0.6, "opacity": 1, "color": "#000000", "target": "mask"}
    subprocess.run([str(CLI), "run", str(SOURCE), "--cmd", "select.deselect", "--cmd", "paint.stroke", "--params", json.dumps(params), "--out", str(native)], check=True, capture_output=True, timeout=120)
    subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
    return preview


def main() -> None:
    images = [("original", ORIGINAL), ("baseline", FOLDER / "gray-ear-bridge.png")]
    images += [(name, run_case(name, *params)) for name, params in PATHS.items()]
    box = (1250, 150, 1780, 620)
    comparison = Image.new("RGB", (530 * len(images), 470))
    for i, (_, path) in enumerate(images):
        comparison.paste(Image.open(path).convert("RGB").crop(box), (530 * i, 0))
    output = FOLDER / "mask-brush-comparison.png"
    comparison.save(output)
    print(output)
    print([name for name, _ in images])


if __name__ == "__main__":
    main()
