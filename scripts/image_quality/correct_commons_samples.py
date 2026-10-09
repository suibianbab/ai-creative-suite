"""Create source-bound corrections for two specific Commons quality samples.

These are reproducible QA edits, not a general foreground or material model.
Originals and initial masks remain untouched. Processing time is not manual edit time.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

from run_mask_spike import layout


ROOT = Path("artifacts/image-ecommerce-commons-2026-10-09")
CASES = ("matte-shampoo", "reflective-lens")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def keep_main_component(alpha: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(alpha >= 128)
    if count < 2:
        raise ValueError("Expected the bottle and decor as separate mask components")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    main = labels == int(sizes.argmax())
    protection = ndimage.binary_dilation(main, iterations=12)
    return np.where(protection, alpha, 0).astype(np.uint8)


def remove_lens_reflection(alpha: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    height, width = alpha.shape
    if (width, height) != (4415, 2943):
        raise ValueError("Lens sample dimensions changed")
    # Below y=1800 the lens is dark and its floor reflection is light. Estimate
    # the last dark lens pixel in each column, then smooth the lower contour.
    luma = np.mean(rgb[1800:2300].astype(np.uint16), axis=2)
    foreground = (luma < 150) & (alpha[1800:2300] > 64)
    last = np.where(foreground, np.arange(1800, 2300)[:, None], -1).max(axis=0)
    edge = np.where(last >= 1900, last, 1900).astype(np.float32)
    edge = ndimage.median_filter(edge, size=41)
    edge = ndimage.gaussian_filter1d(edge, sigma=8)
    ramp = np.clip((edge[None, :] + 4 - np.arange(1800, height)[:, None]) / 12, 0, 1)
    result = alpha.copy()
    result[1800:] = np.rint(result[1800:].astype(np.float32) * ramp).astype(np.uint8)
    return result


def main() -> None:
    root = ROOT.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    cases = {case["case"]: case for case in manifest["cases"]}
    correction_root = root / "corrected"
    for directory in ("masks", "cutouts", "white", "layouts"):
        (correction_root / directory).mkdir(parents=True, exist_ok=True)
    records = []
    for key in CASES:
        case = cases[key]
        source = root / "originals" / case["filename"]
        initial_mask = root / "masks" / f"{key}.png"
        if sha(source) != case["sha256"]:
            raise ValueError(f"Original changed: {source}")
        with Image.open(source) as image:
            original = ImageOps.exif_transpose(image).convert("RGB")
        with Image.open(initial_mask) as image:
            alpha = np.asarray(image.convert("L"))
        rgb = np.asarray(original)
        if alpha.shape != rgb.shape[:2]:
            raise ValueError(f"Initial mask dimensions changed: {key}")
        started = time.perf_counter()
        corrected = (
            keep_main_component(alpha)
            if key == "matte-shampoo"
            else remove_lens_reflection(alpha, rgb)
        )
        mask = Image.fromarray(corrected, "L")
        rgba = original.copy().convert("RGBA")
        rgba.putalpha(mask)
        white = Image.new("RGBA", original.size, "white")
        white.alpha_composite(rgba)
        outputs = {
            "mask": correction_root / "masks" / f"{key}.png",
            "cutout": correction_root / "cutouts" / f"{key}.png",
            "white": correction_root / "white" / f"{key}.png",
            "square": correction_root / "layouts" / f"{key}-square.png",
            "portrait": correction_root / "layouts" / f"{key}-portrait.png",
        }
        mask.save(outputs["mask"])
        rgba.save(outputs["cutout"])
        white.convert("RGB").save(outputs["white"])
        layout(rgba, case["title"], (1600, 1600)).save(outputs["square"])
        layout(rgba, case["title"], (1600, 2000)).save(outputs["portrait"])
        if not np.array_equal(np.asarray(rgba)[:, :, :3], rgb):
            raise AssertionError(f"Product RGB changed: {key}")
        records.append({
            "case": key,
            "source_sha256": case["sha256"],
            "initial_mask_sha256": sha(initial_mask),
            "method": (
                "Keep the largest 128-threshold mask component and 12-pixel alpha fringe"
                if key == "matte-shampoo"
                else "Trim alpha below the photographed dark-lens bottom contour"
            ),
            "processing_seconds": round(time.perf_counter() - started, 2),
            "manual_correction_seconds": None,
            "alpha_changed_pixels": int(np.count_nonzero(alpha != corrected)),
            "rgb_changed_pixels": 0,
            "outputs": {label: {"path": str(path.relative_to(root)), "sha256": sha(path)} for label, path in outputs.items()},
        })
        print(f"{key}: {records[-1]['alpha_changed_pixels']} alpha pixels changed; RGB exact")
    (correction_root / "provenance.json").write_text(
        json.dumps({"scope": "two sample-specific QA corrections", "records": records}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
