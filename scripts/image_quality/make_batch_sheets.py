"""Build side-by-side visual QA sheets for the fixed mask batch."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path("artifacts/image-quality-batch-2026-10-09")
PANEL = (340, 330)
FONT_PATH = Path("C:/Windows/Fonts/segoeui.ttf")


def fit(image: Image.Image) -> Image.Image:
    image = image.copy()
    image.thumbnail((PANEL[0] - 20, PANEL[1] - 46), Image.Resampling.LANCZOS)
    return image


def cell(case: dict, kind: str) -> Image.Image:
    stem = f"{case['case']}-{case['object_id']}"
    if kind == "source":
        image = Image.open(ROOT / "originals" / case["filename"]).convert("RGB")
        background = Image.new("RGB", PANEL, (238, 238, 238))
    else:
        image = Image.open(ROOT / "cutouts" / f"{stem}.png").convert("RGBA")
        background = Image.new("RGB", PANEL, "white" if kind == "white" else (234, 45, 152))
    image = fit(image)
    x = (PANEL[0] - image.width) // 2
    y = 30 + (PANEL[1] - 40 - image.height) // 2
    if image.mode == "RGBA":
        background.paste(image, (x, y), image)
    else:
        background.paste(image, (x, y))
    draw = ImageDraw.Draw(background)
    font = ImageFont.truetype(str(FONT_PATH), 17) if FONT_PATH.exists() else ImageFont.load_default()
    draw.text((10, 6), f"{stem} / {kind}", font=font, fill=(0, 0, 0))
    return background


def main() -> None:
    cases = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["cases"]
    qa_dir = ROOT / "qa"
    qa_dir.mkdir(exist_ok=True)
    for start in range(0, len(cases), 5):
        group = cases[start : start + 5]
        sheet = Image.new("RGB", (PANEL[0] * 3, PANEL[1] * len(group)), "white")
        for row, case in enumerate(group):
            for column, kind in enumerate(("source", "white", "magenta")):
                sheet.paste(cell(case, kind), (column * PANEL[0], row * PANEL[1]))
        sheet.save(qa_dir / f"batch-{start + 1:02d}-{start + len(group):02d}.jpg", quality=92)


if __name__ == "__main__":
    main()
