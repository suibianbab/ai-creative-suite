"""Add original typography and synthesized audio to the FORM 01 render frames."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import wave
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from run_gpu_spike import ROOT


SIZE = (1280, 720)
IVORY = (243, 233, 208)
GOLD = (206, 172, 113)


def font(name: str, size: int):
    path = Path("C:/Windows/Fonts") / name
    if not path.is_file():
        raise FileNotFoundError(f"Required local font: {path}")
    return ImageFont.truetype(str(path), size)


SERIF = {size: font("georgia.ttf", size) for size in (42, 82)}
SANS = {size: font("arial.ttf", size) for size in (20, 22, 25, 29)}


def alpha_for(frame: int, start: int, peak: int, end: int) -> float:
    if frame < start or frame > end:
        return 0.0
    if frame < peak:
        return (frame - start) / max(1, peak - start)
    fade_start = max(peak, end - 8)
    if frame > fade_start:
        return (end - frame) / max(1, end - fade_start)
    return 1.0


def text_layer(frame: int) -> Image.Image:
    layer = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if frame <= 48:
        opacity = int(255 * alpha_for(frame, 1, 13, 48))
        draw.text((78, 84), "FORM 01", font=SERIF[42], fill=(*IVORY, opacity))
        draw.line((80, 145, 235, 145), fill=(*GOLD, opacity), width=2)
        draw.text((79, 164), "A QUIETER PRESENCE", font=SANS[20], fill=(*IVORY, opacity))
    elif frame <= 72:
        opacity = int(255 * alpha_for(frame, 49, 54, 72))
        draw.text((78, 97), "DETAIL IN", font=SANS[25], fill=(*IVORY, opacity))
        draw.text((78, 132), "EVERY SURFACE", font=SANS[25], fill=(*IVORY, opacity))
        draw.line((79, 177, 286, 177), fill=(*GOLD, opacity), width=2)
    else:
        opacity = int(255 * min(1.0, (frame - 72) / 15))
        draw.text((80, 177), "A DESIGN STUDY", font=SANS[22], fill=(*GOLD, opacity))
        draw.text((72, 240), "FORM 01", font=SERIF[82], fill=(*IVORY, opacity))
        draw.line((81, 353, 389, 353), fill=(*GOLD, opacity), width=2)
        draw.text((81, 383), "BOTANICAL PERFUME", font=SANS[29], fill=(*IVORY, opacity))
        draw.text((82, 445), "A QUIETER PRESENCE", font=SANS[22], fill=(*IVORY, opacity))
        draw.text((82, 607), "DESIGN STUDY  /  50 ML", font=SANS[20], fill=(*GOLD, opacity))
    return layer


def make_audio(path: Path):
    sample_rate = 48_000
    seconds = 6.0
    t = np.arange(int(sample_rate * seconds), dtype=np.float64) / sample_rate
    fade = np.minimum(1.0, t / 0.6) * np.minimum(1.0, (seconds - t) / 0.75)
    bed = (0.11 * np.sin(2 * math.pi * 130.81 * t) + 0.07 * np.sin(2 * math.pi * 196.0 * t) + 0.035 * np.sin(2 * math.pi * 261.63 * t)) * fade
    audio = bed.copy()
    for when, frequency, amplitude in ((0.22, 523.25, 0.10), (2.0, 392.0, 0.085), (3.03, 659.25, 0.11)):
        dt = t - when
        active = dt >= 0
        bell = np.zeros_like(t)
        bell[active] = amplitude * np.exp(-3.4 * dt[active]) * (np.sin(2 * math.pi * frequency * dt[active]) + 0.35 * np.sin(2 * math.pi * 2.01 * frequency * dt[active]))
        audio += bell
    rng = np.random.default_rng(101)
    noise = rng.standard_normal(len(t))
    envelope = np.exp(-((t - 2.0) / 0.22) ** 2) + 0.8 * np.exp(-((t - 3.0) / 0.28) ** 2)
    # Gentle high-passed noise accents at scene changes.
    audio += 0.018 * (noise - np.convolve(noise, np.ones(31) / 31, mode="same")) * envelope
    audio = np.clip(audio, -0.75, 0.75)
    stereo = np.column_stack((audio, audio * 0.98)).astype(np.float32)
    pcm = (stereo * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=ROOT / "artifacts" / f"fictional-product-ad-{date.today().isoformat()}" / "render")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / f"fictional-product-ad-{date.today().isoformat()}" / "final")
    args = parser.parse_args()
    source, output = args.input.resolve(), args.output.resolve()
    frames = sorted((source / "frames").glob("frame_*.png"))
    if len(frames) != 72 or not (source / "endcard_product.png").is_file():
        parser.error("Expected 72 Blender frames and a rendered end card product still")
    output.mkdir(parents=True, exist_ok=True)
    composed = output / "frames"
    composed.mkdir(exist_ok=True)
    endcard = Image.open(source / "endcard_product.png").convert("RGB").resize(SIZE, Image.Resampling.LANCZOS)
    for frame in range(1, 145):
        base = Image.open(frames[frame - 1]).convert("RGB") if frame <= 72 else endcard
        if base.size != SIZE:
            raise ValueError(f"Unexpected Blender frame size at {frame}: {base.size}")
        base_rgba = base.convert("RGBA")
        base_rgba.alpha_composite(text_layer(frame))
        composed_frame = base_rgba.convert("RGB")
        if frame >= 133:
            fade = (144 - frame) / 11
            composed_frame = Image.blend(Image.new("RGB", SIZE, (0, 0, 0)), composed_frame, fade)
        composed_frame.save(composed / f"frame_{frame:04d}.png", compress_level=1)
    audio = output / "original_audio.wav"
    make_audio(audio)
    video = output / "form01_fictional_ad.mp4"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "24", "-start_number", "1", "-i", str(composed / "frame_%04d.png"), "-i", str(audio), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(video)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr)
    report = {"duration_seconds": 6, "fps": 24, "frame_count": 144, "resolution": SIZE, "video": str(video), "audio": str(audio), "visual_source": str(source), "sound_source": "original synthesized in this script", "compositor": "Pillow overlays + FFmpeg encode; prototype, not production Remotion pipeline"}
    (output / "composition-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
