"""Render FORM 01 landscape and portrait using the Remotion final composer."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages" / "remotion-engine"
DEFAULT_ARTIFACT = ROOT / "artifacts" / f"fictional-product-ad-{date.today().isoformat()}"
WINDOWS_CHROME = Path("C:/Program Files/Google/Chrome/Application/chrome.exe")


def probe(path: Path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames,r_frame_rate", "-show_entries", "format=duration,size", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--browser", type=Path, default=WINDOWS_CHROME)
    parser.add_argument("--aspect", choices=["landscape", "portrait", "both"], default="both")
    args = parser.parse_args()
    artifact = args.artifact.resolve()
    browser = args.browser.resolve()
    if not browser.is_file():
        parser.error(f"Chrome browser not found: {browser}")
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        parser.error("pnpm not found on PATH")
    staged = subprocess.run([sys.executable, str(ROOT / "scripts" / "blender" / "stage_form01_remotion.py"), "--artifact", str(artifact), "--aspect", args.aspect], check=False)
    if staged.returncode:
        return staged.returncode
    output = artifact / "remotion"
    output.mkdir(parents=True, exist_ok=True)
    aspects = ("landscape", "portrait") if args.aspect == "both" else (args.aspect,)
    reports = {}
    for aspect in aspects:
        composition = "Form01-Landscape" if aspect == "landscape" else "Form01-Portrait"
        video = output / f"form01_{aspect}.mp4"
        command = [pnpm, "--filter", "@acs/remotion-engine", "exec", "remotion", "render", "src/index.ts", composition, str(video), "--codec=h264", "--crf=18", "--pixel-format=yuv420p", "--image-format=png", "--color-space=bt709", "--concurrency=2", "--browser-executable", str(browser)]
        started = time.perf_counter()
        with (output / f"{aspect}.log").open("w", encoding="utf-8", errors="replace") as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=False)
        if result.returncode or not video.is_file():
            print(f"Remotion {aspect} failed: {output / f'{aspect}.log'}", file=sys.stderr)
            return result.returncode or 1
        metadata = probe(video)
        streams = metadata.get("streams", [])
        video_stream = next((stream for stream in streams if stream.get("codec_name") == "h264"), None)
        audio_stream = next((stream for stream in streams if stream.get("codec_name") == "aac"), None)
        dimensions = (1280, 720) if aspect == "landscape" else (720, 1280)
        if not video_stream or not audio_stream or (video_stream.get("width"), video_stream.get("height")) != dimensions or video_stream.get("nb_frames") != "144" or abs(float(metadata["format"]["duration"]) - 6) > 0.05:
            print(f"Unexpected media metadata for {video}: {metadata}", file=sys.stderr)
            return 1
        reports[aspect] = {"video": str(video), "elapsed_seconds": round(time.perf_counter() - started, 3), "metadata": metadata, "command": command}
        print(f"Rendered {aspect}: {video}", flush=True)
    (output / "render-report.json").write_text(json.dumps(reports, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: {"video": value["video"], "elapsed_seconds": value["elapsed_seconds"]} for key, value in reports.items()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
