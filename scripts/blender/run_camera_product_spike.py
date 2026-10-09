"""Render the licensed camera sample on the Windows GPU and record host metrics."""

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
    parser.add_argument("--source", type=Path, default=ROOT / "artifacts" / "blender-product-spike-2026-10-09" / "source" / "Camera_01_2k.blend")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / f"blender-product-spike-{date.today().isoformat()}" / "final")
    parser.add_argument("--backend", choices=["OPTIX", "CUDA"], default="OPTIX")
    args = parser.parse_args()
    blender, source, output = args.blender.resolve(), args.source.resolve(), args.output.resolve()
    if not blender.is_file() or not source.is_file():
        parser.error("Blender executable or licensed source model not found")
    output.mkdir(parents=True, exist_ok=True)

    command = [str(blender), "-b", str(source), "-t", "4", "--python", str(Path(__file__).with_name("camera_product_spike.py")), "--", str(output), args.backend, "final"]
    baseline = gpu_snapshot()
    samples: list[dict[str, int]] = []
    started = time.perf_counter()
    with (output / "blender.log").open("w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        while process.poll() is None:
            snapshot = gpu_snapshot()
            if snapshot:
                samples.append(snapshot)
            time.sleep(0.5)
        exit_code = process.wait()
    report = {
        "exit_code": exit_code,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "gpu_monitor_note": "Whole-GPU nvidia-smi samples, not Blender-attributed VRAM",
        "gpu_baseline": baseline,
        "gpu_peak_memory_used_mib": max((item["memory_used_mib"] for item in samples), default=None),
        "gpu_peak_utilization_percent": max((item["utilization_percent"] for item in samples), default=None),
        "command": command,
    }
    (output / "host-run-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if exit_code:
        print(f"Blender failed: {output / 'blender.log'}", file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
