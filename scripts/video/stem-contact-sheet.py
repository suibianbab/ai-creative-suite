"""Make a compact two-aspect, seven-shot review sheet from retained MP4 frames."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
KEYFRAMES = ROOT / "artifacts/video-studio-multielement-2026-10-23/keyframes"
SHEET = Image.new("RGB", (7 * 280, 2 * 300), "#e7ebf1")
draw = ImageDraw.Draw(SHEET)
for row, aspect in enumerate(("landscape", "portrait")):
    for shot in range(1, 8):
        image = Image.open(KEYFRAMES / f"review-{aspect}-{shot}.png").convert("RGB")
        image.thumbnail((268, 265))
        x = (shot - 1) * 280 + (280 - image.width) // 2
        y = row * 300 + (270 - image.height) // 2
        SHEET.paste(image, (x, y))
        draw.text(((shot - 1) * 280 + 8, row * 300 + 274), f"{aspect} / shot {shot}", fill="#102033")
SHEET.save(KEYFRAMES / "contact-sheet.png")
