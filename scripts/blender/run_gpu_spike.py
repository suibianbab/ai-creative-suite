"""Run the trusted Blender smoke scene on the Windows host and capture evidence.

This is a development Golden Spike, not a production worker or a product model.
"""

from __future__ import annotations

import argparse
from datetime import date
import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BLENDER = ROOT / ".tools" / "blender-5.2.2-windows-x64" / "blender.exe"
DEFAULT_OUTPUT = ROOT / "artifacts" / f"blender-gpu-spike-{date.today().isoformat()}"


def gpu_snapshot() -> dict[str, int] | None:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        memory, utilization = result.stdout.strip().splitlines()[0].split(",", 1)
        return {"memory_used_mib": int(memory.strip()), "utilization_percent": int(utilization.strip())}
    except (ValueError, IndexError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--blender", type=Path, default=DEFAULT_BLENDER)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--backend", choices=["OPTIX", "CUDA"], default="OPTIX")
    args = parser.parse_args()

    blender = args.blender.resolve()
    output = args.output.resolve()
    if not blender.is_file():
        parser.error(f"Blender executable not found: {blender}")
    output.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).with_name("gpu_spike.py")
    command = [str(blender), "-b", "-t", "4", "--python", str(script), "--", str(output), args.backend]
    baseline = gpu_snapshot()
    samples: list[dict[str, int]] = []
    started = time.perf_counter()
    log_path = output / "blender.log"

    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        last_progress = 0.0
        while process.poll() is None:
            snapshot = gpu_snapshot()
            if snapshot:
                samples.append(snapshot)
            elapsed = time.perf_counter() - started
            if elapsed - last_progress >= 15:
                print(f"Blender running: {elapsed:.0f}s, GPU sample: {snapshot}", flush=True)
                last_progress = elapsed
            time.sleep(1)
        exit_code = process.wait()

    elapsed = round(time.perf_counter() - started, 3)
    report = {
        "exit_code": exit_code,
        "elapsed_seconds": elapsed,
        "blender_executable": str(blender),
        "backend_requested": args.backend,
        "gpu_monitor_note": "nvidia-smi samples are whole-GPU observations, not Blender-attributed VRAM",
        "gpu_baseline": baseline,
        "gpu_peak_memory_used_mib": max((sample["memory_used_mib"] for sample in samples), default=None),
        "gpu_peak_utilization_percent": max((sample["utilization_percent"] for sample in samples), default=None),
    }
    (output / "host-run-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if exit_code:
        print(f"Blender failed. See {log_path}", file=sys.stderr)
    else:
        print(f"Blender completed. See {output}", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
