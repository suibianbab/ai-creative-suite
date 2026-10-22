"""Check visible content against 10% frame safe area at four times per shot."""

from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parent
OFFSETS = (0.3, 0.9, 1.8, 2.7)


def frame(video: Path, at: float) -> Image.Image:
    output = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", str(at), "-i", str(video),
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(BytesIO(output.stdout)).convert("RGB")


results = []
for version in ("before", "after", "long-title"):
    for aspect in ("landscape", "portrait"):
        video = ROOT / version / f"{aspect}.mp4"
        for shot in range(4):
            for offset in OFFSETS:
                at = shot * 3 + offset
                image = frame(video, at)
                background = Image.new("RGB", image.size, image.getpixel((0, 0)))
                bbox = ImageChops.difference(image, background).getbbox()
                assert bbox is not None
                width, height = image.size
                safe = (width * 0.1, height * 0.1, width * 0.9, height * 0.9)
                inside = (
                    bbox[0] >= safe[0] - 2 and bbox[1] >= safe[1] - 2
                    and bbox[2] <= safe[2] + 2 and bbox[3] <= safe[3] + 2
                )
                results.append({
                    "version": version,
                    "aspect": aspect,
                    "shot": shot + 1,
                    "atSeconds": at,
                    "contentBounds": bbox,
                    "safeBounds": safe,
                    "inside": inside,
                })

report = {
    "criterion": "Visible pixels stay inside the central 80% of the exported frame; 2 px raster tolerance",
    "samplesPerAspect": 16,
    "beforeOutside": [r for r in results if r["version"] == "before" and not r["inside"]],
    "afterOutside": [r for r in results if r["version"] == "after" and not r["inside"]],
    "stressOutside": [r for r in results if r["version"] == "long-title" and not r["inside"]],
    "frames": results,
}
output = (
    ROOT / "safe-frame-report.json"
    if "--record" in sys.argv
    else ROOT.parents[1] / ".tools" / "video-aspect-layout" / "safe-frame-report.json"
)
output.parent.mkdir(parents=True, exist_ok=True)
with output.open("w", encoding="utf-8", newline="\n") as report_file:
    report_file.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(
    f"before outside={len(report['beforeOutside'])}; "
    f"after outside={len(report['afterOutside'])}; "
    f"long-title outside={len(report['stressOutside'])} / 96 frames"
)
assert not report["afterOutside"], "Updated export still has content outside safe area"
assert not report["stressOutside"], "Long-title export still has content outside safe area"
