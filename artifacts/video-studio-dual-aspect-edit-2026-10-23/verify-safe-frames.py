"""Dual-aspect edit export: check visible content against the 10% safe area.

Spans (per-shot start seconds) are computed by the Node audit from the
quantized timeline and passed via spans.json; each shot is sampled at four
evenly spaced offsets. Before = auto layout (no override), after = portrait
layout override. Both variants must stay inside the safe area — the delta
this round is label/title readability (human review), not containment.
"""

from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
OFFSETS = (0.3, 0.9, 1.8, 2.7)

spans = json.loads((ROOT / "spans.json").read_text(encoding="utf-8"))


def frame(video: Path, at: float) -> Image.Image:
    output = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", str(video),
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(BytesIO(output.stdout)).convert("RGB")


results = []
for version, shot_spans in (("before", spans["before"]), ("after", spans["after"])):
    assert len(shot_spans) == spans["shotCount"]
    for aspect in ("landscape", "portrait"):
        video = ROOT / f"render-{version}" / f"{aspect}.mp4"
        for shot_index, start_seconds in enumerate(shot_spans):
            for offset in OFFSETS:
                at = start_seconds + offset * spans["shotSeconds"][shot_index] / 3.0
                image = frame(video, at)
                background = Image.new("RGB", image.size, image.getpixel((0, 0)))
                bbox = ImageChops.difference(image, background).getbbox()
                assert bbox is not None, f"{version}/{aspect} shot {shot_index + 1} 空帧"
                width, height = image.size
                safe = (width * 0.1, height * 0.1, width * 0.9, height * 0.9)
                inside = (
                    bbox[0] >= safe[0] - 2 and bbox[1] >= safe[1] - 2
                    and bbox[2] <= safe[2] + 2 and bbox[3] <= safe[3] + 2
                )
                results.append({
                    "version": version,
                    "aspect": aspect,
                    "shot": shot_index + 1,
                    "atSeconds": round(at, 3),
                    "contentBounds": bbox,
                    "inside": inside,
                })

before_outside = [r for r in results if r["version"] == "before" and not r["inside"]]
after_outside = [r for r in results if r["version"] == "after" and not r["inside"]]
report = {
    "criterion": "Visible pixels stay inside the central 80% of the exported frame; 2 px raster tolerance; both variants must pass (the override changes readability, not containment)",
    "samplesPerAspectPerVariant": len(results) // 2,
    "beforeOutside": before_outside,
    "afterOutside": after_outside,
    "frames": results,
}
target = (
    ROOT / "safe-frame-report.json"
    if "--record" in sys.argv
    else ROOT.parents[1] / ".tools" / "video-studio-dual-aspect-edit" / "safe-frame-report.json"
)
target.parent.mkdir(parents=True, exist_ok=True)
with target.open("w", encoding="utf-8", newline="\n") as report_file:
    report_file.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(
    f"safe frames: before outside={len(before_outside)}; "
    f"after outside={len(after_outside)} / {len(results)} frames"
)
assert not before_outside, "Auto-layout (before) variant has content outside safe area"
assert not after_outside, "Override (after) variant has content outside safe area"
