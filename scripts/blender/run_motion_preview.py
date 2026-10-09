"""Render the synthetic motion preview on Windows RTX GPU and assemble MP4."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from run_gpu_spike import DEFAULT_BLENDER, ROOT, gpu_snapshot


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--blender", type=Path, default=DEFAULT_BLENDER)
    parser.add_argument("--scene", type=Path, default=ROOT / "artifacts" / "blender-gpu-spike-2026-10-09" / "synthetic_product.blend")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / f"blender-motion-preview-{date.today().isoformat()}")
    args = parser.parse_args()
    blender = args.blender.resolve()
    scene = args.scene.resolve()
    output = args.output.resolve()
    if not blender.is_file() or not scene.is_file():
        parser.error("Blender executable or synthetic scene not found")
    output.mkdir(parents=True, exist_ok=True)

    command = [str(blender), "-b", str(scene), "-t", "4", "--python", str(Path(__file__).with_name("motion_preview.py")), "--", str(output)]
    started = time.perf_counter()
    baseline = gpu_snapshot()
    samples: list[dict[str, int]] = []
    with (output / "blender.log").open("w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        while process.poll() is None:
            snapshot = gpu_snapshot()
            if snapshot:
                samples.append(snapshot)
            time.sleep(1)
        exit_code = process.wait()
    if exit_code:
        print(f"Blender failed: {output / 'blender.log'}", file=sys.stderr)
        return exit_code

    video = output / "motion_preview.mp4"
    ffmpeg = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "24", "-start_number", "1", "-i", str(output / "frames" / "frame_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(video)],
        capture_output=True,
        text=True,
        check=False,
    )
    if ffmpeg.returncode:
        print(ffmpeg.stderr, file=sys.stderr)
        return ffmpeg.returncode
    report = {
        "exit_code": 0,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "gpu_monitor_note": "Whole-GPU nvidia-smi samples, not Blender-attributed VRAM",
        "gpu_baseline": baseline,
        "gpu_peak_memory_used_mib": max((item["memory_used_mib"] for item in samples), default=None),
        "gpu_peak_utilization_percent": max((item["utilization_percent"] for item in samples), default=None),
        "video": str(video),
    }
    (output / "host-run-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
