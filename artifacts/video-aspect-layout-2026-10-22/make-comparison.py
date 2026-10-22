"""Render four mid-shot frames from the same project before/after layout changes."""

from pathlib import Path
import subprocess
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
TIMES = (1.8, 4.8, 7.8, 10.8)
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
FONT = ImageFont.truetype(str(FONT_PATH), 25)


def frame(video: Path, at: float) -> Image.Image:
    output = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            str(at),
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(BytesIO(output.stdout)).convert("RGB")


for aspect, size in (("landscape", (480, 270)), ("portrait", (270, 480))):
    margin = 16
    header = 55
    canvas = Image.new(
        "RGB", (size[0] * 4 + margin * 5, (size[1] + header) * 2 + margin * 3), "#eef1f5"
    )
    draw = ImageDraw.Draw(canvas)
    for row, version in enumerate(("before", "after")):
        for col, at in enumerate(TIMES):
            img = frame(ROOT / version / f"{aspect}.mp4", at)
            img = img.resize(size, Image.Resampling.LANCZOS)
            x = margin + col * (size[0] + margin)
            y = margin + row * (size[1] + header + margin)
            draw.text((x, y + 8), f"{version} · 镜头 {col + 1}", font=FONT, fill="#1c304a")
            canvas.paste(img, (x, y + header))
    canvas.save(ROOT / f"comparison-{aspect}.png")
