"""Render the camera product motion on RTX GPU and assemble a local MP4."""

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
    base = ROOT / "artifacts" / f"blender-product-spike-{date.today().isoformat()}"
    parser.add_argument("--blender", type=Path, default=DEFAULT_BLENDER)
    parser.add_argument("--scene", type=Path, default=base / "final" / "camera_product_scene.blend")
    parser.add_argument("--output", type=Path, default=base / "motion")
    args = parser.parse_args()
    blender, scene, output = args.blender.resolve(), args.scene.resolve(), args.output.resolve()
    if not blender.is_file() or not scene.is_file():
        parser.error("Blender executable or product scene not found")
    output.mkdir(parents=True, exist_ok=True)

    command = [str(blender), "-b", str(scene), "-t", "4", "--python", str(Path(__file__).with_name("camera_product_motion.py")), "--", str(output)]
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
    frame_files = sorted((output / "frames").glob("frame_*.png"))
    if len(frame_files) != 72 or not (output / "render-report.json").is_file():
        print(f"Blender did not produce all 72 frames: {output / 'blender.log'}", file=sys.stderr)
        return 1

    video = output / "camera_product_preview.mp4"
    ffmpeg = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "24", "-start_number", "1", "-i", str(output / "frames" / "frame_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(video)],
        capture_output=True, text=True, check=False,
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
    (output / "host-run-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
