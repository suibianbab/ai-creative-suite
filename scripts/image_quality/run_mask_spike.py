"""Reproducible mask-only product-image quality spike.

The segmentation model supplies alpha only. Every exported cutout keeps the
original decoded RGB pixels at the original dimensions.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


def fit_size(size: tuple[int, int], maximum: int) -> tuple[int, int]:
    scale = min(1.0, maximum / max(size))
    return round(size[0] * scale), round(size[1] * scale)


def case_key(case: dict) -> str:
    return f"{case['case']}-{case['object_id']}" if "object_id" in case else case["case"]


def layout(cutout: Image.Image, title: str, size: tuple[int, int]) -> Image.Image:
    width, height = size
    scene = Image.new("RGB", size)
    pixels = np.asarray(scene).copy()
    for y in range(height):
        blend = y / max(1, height - 1)
        pixels[y, :, :] = [round(243 - 13 * blend), round(240 - 13 * blend), round(233 - 11 * blend)]
    scene = Image.fromarray(pixels, "RGB")
    draw = ImageDraw.Draw(scene)
    draw.rectangle((0, 0, width, 13), fill=(48, 64, 63))

    alpha = cutout.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("Empty mask")
    subject = cutout.crop(bbox)
    target = fit_size(subject.size, round(min(width * 0.76 / subject.width, height * 0.68 / subject.height) * max(subject.size)))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    x = (width - target[0]) // 2
    y = round(height * 0.78 - target[1])

    shadow = Image.new("RGBA", size)
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse((x + target[0] * 0.1, y + target[1] * 0.98, x + target[0] * 0.9, y + target[1] * 1.03), fill=(42, 35, 26, 45))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(width * 0.025)))
    scene = Image.alpha_composite(scene.convert("RGBA"), shadow)
    scene.alpha_composite(subject, (x, y))

    draw = ImageDraw.Draw(scene)
    font_path = Path("C:/Windows/Fonts/segoeui.ttf")
    font = ImageFont.truetype(str(font_path), round(width * 0.027)) if font_path.exists() else ImageFont.load_default()
    title_font = ImageFont.truetype(str(font_path), round(width * 0.045)) if font_path.exists() else ImageFont.load_default()
    draw.text((round(width * 0.07), round(height * 0.045)), "OBJECT STUDY  /  OPEN ACCESS", font=font, fill=(54, 68, 66))
    draw.text((round(width * 0.07), round(height * 0.915)), title, font=title_font, fill=(45, 60, 58))
    return scene.convert("RGB")


def process_case(case: dict, root: Path, session, max_model_size: int, skip_layouts: bool = False) -> dict:
    from rembg import remove

    source = root / "originals" / case["filename"]
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != case["sha256"]:
        raise ValueError(f"Source checksum changed: {source}")
    # Decode the visual orientation before inference while leaving the source file untouched.
    original = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    model_size = fit_size(original.size, max_model_size)
    model_input = original.resize(model_size, Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    model_input.save(stream, format="PNG")
    start = time.perf_counter()
    mask_bytes = remove(stream.getvalue(), session=session, only_mask=True)
    elapsed = round(time.perf_counter() - start, 2)
    mask = Image.open(io.BytesIO(mask_bytes)).convert("L").resize(original.size, Image.Resampling.LANCZOS)
    rgba = original.copy().convert("RGBA")
    rgba.putalpha(mask)

    stem = case_key(case)
    directories = ("masks", "cutouts", "white") if skip_layouts else ("masks", "cutouts", "white", "layouts")
    for directory in directories:
        (root / directory).mkdir(exist_ok=True)
    mask.save(root / "masks" / f"{stem}.png")
    rgba.save(root / "cutouts" / f"{stem}.png")
    white = Image.new("RGBA", original.size, "white")
    white.alpha_composite(rgba)
    white.convert("RGB").save(root / "white" / f"{stem}.png")
    if not skip_layouts:
        for label, size in (("square", (1600, 1600)), ("portrait", (1600, 2000))):
            layout(rgba, case["title"], size).save(root / "layouts" / f"{stem}-{label}.png")

    source_pixels = np.asarray(original)
    output_pixels = np.asarray(rgba)[:, :, :3]
    if not np.array_equal(source_pixels, output_pixels):
        raise AssertionError("The cutout changed the original RGB pixels")
    alpha = np.asarray(mask)
    outputs = {
        "mask": f"masks/{stem}.png",
        "cutout": f"cutouts/{stem}.png",
        "white": f"white/{stem}.png",
    }
    if not skip_layouts:
        outputs.update({
            "square": f"layouts/{stem}-square.png",
            "portrait": f"layouts/{stem}-portrait.png",
        })
    return {
        "case": case["case"],
        "object_id": case.get("object_id"),
        "source_sha256": case["sha256"],
        "source_size": list(original.size),
        "model_input_size": list(model_size),
        "inference_seconds": elapsed,
        "rgb_changed_pixels": 0,
        "alpha_high_coverage_percent": round(float(np.mean(alpha >= 250) * 100), 2),
        "alpha_low_coverage_percent": round(float(np.mean(alpha <= 5) * 100), 2),
        "alpha_transition_percent": round(float(np.mean((alpha > 5) & (alpha < 250)) * 100), 2),
        "mask_bbox": list(mask.getbbox() or ()),
        "outputs": outputs,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("artifacts/image-quality-spike-2026-10-09"))
    parser.add_argument("--model", default="birefnet-general-lite")
    parser.add_argument("--max-model-size", type=int, default=1600)
    parser.add_argument("--layouts-only", action="store_true")
    parser.add_argument("--skip-layouts", action="store_true", help="Produce only mask, cutout and white outputs for a batch review")
    args = parser.parse_args()
    root = args.root.resolve()
    os.environ["REMBG_HOME"] = str((Path(".tools") / "rembg-models").resolve())
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if args.layouts_only:
        (root / "layouts").mkdir(exist_ok=True)
        for case in manifest["cases"]:
            stem = case_key(case)
            cutout = Image.open(root / "cutouts" / f"{stem}.png").convert("RGBA")
            for label, size in (("square", (1600, 1600)), ("portrait", (1600, 2000))):
                layout(cutout, case["title"], size).save(root / "layouts" / f"{stem}-{label}.png")
        return
    from rembg import new_session

    session = new_session(args.model)
    results = []
    for case in manifest["cases"]:
        print(f"Processing {case_key(case)}", flush=True)
        result = process_case(case, root, session, args.max_model_size, args.skip_layouts)
        results.append(result)
        (root / "measurements.json").write_text(json.dumps({"model": args.model, "results": results}, indent=2), encoding="utf-8")
        print(f"  {result['inference_seconds']}s; original RGB preserved; {result['source_size']}", flush=True)


if __name__ == "__main__":
    main()
