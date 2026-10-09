"""Run the original FORM 01 Blender design study on the Windows RTX GPU."""

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
    parser.add_argument("--output", type=Path)
    parser.add_argument("--portrait", action="store_true")
    args = parser.parse_args()
    default_output = ROOT / "artifacts" / f"fictional-product-ad-{date.today().isoformat()}" / ("portrait/render" if args.portrait else "render")
    blender, output = args.blender.resolve(), (args.output or default_output).resolve()
    if not blender.is_file():
        parser.error(f"Blender not found: {blender}")
    output.mkdir(parents=True, exist_ok=True)
    command = [str(blender), "-b", "-t", "4", "--python", str(Path(__file__).with_name("fictional_product_ad.py")), "--", str(output), "portrait-final" if args.portrait else "final"]
    baseline = gpu_snapshot()
    samples: list[dict[str, int]] = []
    started = time.perf_counter()
    with (output / "blender.log").open("w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        last_progress = 0.0
        while process.poll() is None:
            snapshot = gpu_snapshot()
            if snapshot:
                samples.append(snapshot)
            elapsed = time.perf_counter() - started
            if elapsed - last_progress >= 30:
                frame_count = len(list((output / "frames").glob("frame_*.png"))) if (output / "frames").exists() else 0
                print(f"Rendered {frame_count}/72 frames in {elapsed:.0f}s", flush=True)
                last_progress = elapsed
            time.sleep(1)
        exit_code = process.wait()
    frame_count = len(list((output / "frames").glob("frame_*.png"))) if (output / "frames").exists() else 0
    complete = exit_code == 0 and frame_count == 72 and (output / "endcard_product.png").is_file() and (output / "render-report.json").is_file()
    report = {
        "exit_code": exit_code,
        "complete": complete,
        "frame_count": frame_count,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "gpu_monitor_note": "Whole-GPU nvidia-smi samples, not Blender-attributed VRAM",
        "gpu_baseline": baseline,
        "gpu_peak_memory_used_mib": max((sample["memory_used_mib"] for sample in samples), default=None),
        "gpu_peak_utilization_percent": max((sample["utilization_percent"] for sample in samples), default=None),
        "command": command,
    }
    (output / "host-run-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if not complete:
        print(f"Incomplete Blender output; see {output / 'blender.log'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
