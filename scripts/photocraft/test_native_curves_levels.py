"""Verify advanced tonal edits remain native editable PhotoCraft layers."""

import json
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
OUT = ROOT / ".tools/photocraft-selection-qa/native-tone"


def cli(*args: str) -> str:
    return subprocess.run([str(CLI), *args], capture_output=True, text=True, check=True, timeout=120).stdout


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    native = OUT / "curves-levels.pcraft"
    preview = OUT / "curves-levels.png"
    psd = OUT / "curves-levels.psd"
    cli(
        "run", str(SOURCE),
        "--cmd", "layer.newAdjustmentLayer.curves", "--params", json.dumps({"points": [[0, 0], [64, 84], [128, 128], [255, 255]]}),
        "--cmd", "layer.newAdjustmentLayer.levels", "--params", json.dumps({"inBlack": 8, "gamma": 1.1, "inWhite": 248}),
        "--out", str(native),
    )
    info = json.loads(cli("info", str(native), "--compact"))
    assert len(info["layers"]) == 3
    assert "Levels" in info["layers"][0]["adjustment"]
    assert "Curves" in info["layers"][1]["adjustment"]
    cli("convert", str(native), str(preview))
    original = Image.open(SOURCE).convert("RGB")
    changed = Image.open(preview).convert("RGB")
    assert changed.getpixel((600, 400)) != original.getpixel((600, 400))
    cli("convert", str(native), str(psd))
    reopened = json.loads(cli("info", str(psd), "--compact"))
    assert len(reopened["layers"]) == 3
    assert "Levels" in reopened["layers"][0]["adjustment"]
    assert "Curves" in reopened["layers"][1]["adjustment"]
    assert native.read_bytes()[:4] == b"PK\x03\x04"
    assert psd.read_bytes()[:4] == b"8BPS"
    print("PASS: PhotoCraft Curves and Levels remain editable after native and PSD round trips")


if __name__ == "__main__":
    main()
