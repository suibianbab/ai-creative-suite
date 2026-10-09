"""Stage generated FORM 01 frames for Remotion without changing source renders."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from run_gpu_spike import ROOT


def stage_file(source: Path, destination: Path):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, default=ROOT / "artifacts" / f"fictional-product-ad-{date.today().isoformat()}")
    parser.add_argument("--aspect", choices=["landscape", "portrait", "both"], default="both")
    args = parser.parse_args()
    artifact = args.artifact.resolve()
    public = ROOT / "packages" / "remotion-engine" / "public" / "form01"
    aspects = ("landscape", "portrait") if args.aspect == "both" else (args.aspect,)
    staged = {}
    for aspect in aspects:
        render = artifact / ("render" if aspect == "landscape" else "portrait/render")
        frames = sorted((render / "frames").glob("frame_*.png"))
        if len(frames) != 72 or not (render / "endcard_product.png").is_file():
            parser.error(f"Expected 72 frames and an endcard still for {aspect}: {render}")
        dest = public / aspect
        for frame in frames:
            stage_file(frame, dest / "frames" / frame.name)
        stage_file(render / "endcard_product.png", dest / "endcard_product.png")
        staged[aspect] = {"frame_count": len(frames), "render_source": str(render)}
    audio = artifact / "final" / "original_audio.wav"
    if not audio.is_file():
        parser.error(f"Missing original audio: {audio}")
    stage_file(audio, public / "original_audio.wav")
    report = {"staged": staged, "audio": str(audio), "public": str(public), "note": "Copied staging files are generated and gitignored; render sources are untouched"}
    report_path = artifact / "remotion" / "asset-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
