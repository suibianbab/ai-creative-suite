"""Hide the diagnostic green adjustment with PhotoCraft's native layer command."""

import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
GREEN = ROOT / ".tools/photocraft-selection-qa/provider-bridge-test/cat-ear-ear-outline.pcraft"
OUT = ROOT / ".tools/photocraft-selection-qa/cat-ear-restore"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    native = OUT / "ear-green-removed.pcraft"
    preview = OUT / "ear-green-removed.png"
    subprocess.run(
        [str(CLI), "run", str(GREEN), "--cmd", "layer.setProps", "--params", json.dumps({"visible": False}), "--out", str(native)],
        check=True,
        capture_output=True,
        timeout=120,
    )
    subprocess.run([str(CLI), "convert", str(native), str(preview)], check=True, capture_output=True, timeout=120)
    original = Image.open(BASE).convert("RGB")
    restored = Image.open(preview).convert("RGB")
    ear = (1350, 120, 1810, 620)
    delta = np.abs(np.asarray(original.crop(ear), dtype=np.int16) - np.asarray(restored.crop(ear), dtype=np.int16))
    assert delta.max() <= 4 and delta.mean() < 0.1, (delta.max(), delta.mean())
    print(preview)
    print(native)


if __name__ == "__main__":
    main()
