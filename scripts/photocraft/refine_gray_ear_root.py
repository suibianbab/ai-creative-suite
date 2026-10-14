"""Try native PhotoCraft mask-brush passes on the existing gray-ear project.

Only PhotoCraft edits the project. Pillow makes visual QA crops and measures
differences against the untouched original; it does not alter result pixels.
"""

import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
SOURCE = ROOT / ".tools/photocraft-selection-qa/gray-ear/gray-ear-refined.pcraft"
ORIGINAL = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUTPUT = ROOT / ".tools/photocraft-selection-qa/gray-ear/root-refinement"
DELIVERY = ROOT / "artifacts/gray-ear-refinement-2026-10-12"
BOX = (1240, 145, 1780, 620)
HEAD_BOX = (1400, 465, 1600, 525)
EAR_POINTS = [(1540, 310), (1550, 350), (1560, 430)]
CONTROL_POINTS = [(1050, 330), (200, 300), (1500, 800), (800, 1200)]
STROKES = {
    "contour-soft-35": {
        "size": 35,
        "hardness": 0.55,
        "points": [[1335, 457], [1380, 478], [1420, 490], [1460, 499], [1500, 506], [1540, 508], [1580, 502], [1620, 487], [1660, 468]],
    },
    "contour-firm-28": {
        "size": 28,
        "hardness": 0.8,
        "points": [[1335, 457], [1380, 478], [1420, 490], [1460, 499], [1500, 506], [1540, 508], [1580, 502], [1620, 487], [1660, 468]],
    },
    "under-root-wide-65": {
        "size": 65,
        "hardness": 0.7,
        "points": [[1335, 470], [1380, 486], [1420, 499], [1460, 509], [1500, 517], [1540, 519], [1580, 513], [1620, 498], [1660, 480]],
    },
    "under-root-soft-65": {
        "size": 65,
        "hardness": 0.3,
        "points": [[1335, 470], [1380, 486], [1420, 499], [1460, 509], [1500, 517], [1540, 519], [1580, 513], [1620, 498], [1660, 480]],
    },
    "root-left-55": {
        "size": 55,
        "hardness": 0.65,
        "points": [[1335, 455], [1360, 467], [1385, 480], [1410, 492], [1435, 502], [1460, 510]],
    },
}


def command(*args: str) -> None:
    subprocess.run([str(CLI), *args], check=True, capture_output=True, timeout=120)


def head_change(image: Image.Image, original: Image.Image) -> float:
    difference = ImageChops.difference(original.crop(HEAD_BOX), image.crop(HEAD_BOX))
    return max(ImageStat.Stat(difference).mean)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    original = Image.open(ORIGINAL).convert("RGB")
    baseline = Image.open(ROOT / ".tools/photocraft-selection-qa/gray-ear/gray-ear-refined.png").convert("RGB")
    results = [("original", original), ("baseline", baseline)]
    for name, stroke in STROKES.items():
        project = OUTPUT / f"{name}.pcraft"
        preview = OUTPUT / f"{name}.png"
        params = {**stroke, "opacity": 1, "color": "#000000", "target": "mask"}
        command("run", str(SOURCE), "--cmd", "paint.stroke", "--params", json.dumps(params), "--out", str(project))
        command("convert", str(project), str(preview))
        image = Image.open(preview).convert("RGB")
        assert image.size == original.size
        assert all(image.getpixel(point) == baseline.getpixel(point) for point in EAR_POINTS), name
        results.append((name, image))
    strand_project = OUTPUT / "fur-strands.pcraft"
    strand_preview = OUTPUT / "fur-strands.png"
    strand_paths = [
        [[1400, 479], [1391, 462], [1381, 445]],
        [[1432, 491], [1423, 475], [1416, 459]],
        [[1468, 501], [1459, 482], [1451, 467]],
        [[1508, 510], [1498, 489], [1491, 475]],
        [[1548, 511], [1538, 494], [1529, 479]],
        [[1590, 500], [1578, 481], [1569, 467]],
    ]
    args = ["run", str(OUTPUT / "under-root-wide-65.pcraft")]
    for points in strand_paths:
        args += ["--cmd", "paint.stroke", "--params", json.dumps({"points": points, "size": 10, "hardness": 0.45, "opacity": 0.6, "color": "#000000", "target": "mask"})]
    args += ["--out", str(strand_project)]
    command(*args)
    command("convert", str(strand_project), str(strand_preview))
    strand_image = Image.open(strand_preview).convert("RGB")
    results.append(("fur-strands", strand_image))
    balanced_project = OUTPUT / "fur-strands-balanced.pcraft"
    balanced_preview = OUTPUT / "fur-strands-balanced.png"
    gray_fibers = [
        [[1371, 449], [1383, 463], [1391, 474]],
        [[1421, 457], [1435, 473], [1443, 483]],
        [[1460, 463], [1474, 479], [1483, 489]],
        [[1509, 459], [1524, 475], [1534, 485]],
        [[1559, 456], [1575, 469], [1585, 479]],
    ]
    args = ["run", str(strand_project)]
    for points in gray_fibers:
        args += ["--cmd", "paint.stroke", "--params", json.dumps({"points": points, "size": 5, "hardness": 0.55, "opacity": 0.35, "color": "#ffffff", "target": "mask"})]
    args += ["--out", str(balanced_project)]
    command(*args)
    command("convert", str(balanced_project), str(balanced_preview))
    balanced_image = Image.open(balanced_preview).convert("RGB")
    results.append(("fur-strands-balanced", balanced_image))
    comparison = Image.new("RGB", ((BOX[2] - BOX[0]) * len(results), BOX[3] - BOX[1]))
    for index, (_, image) in enumerate(results):
        comparison.paste(image.crop(BOX), ((BOX[2] - BOX[0]) * index, 0))
    comparison.save(OUTPUT / "comparison.png")
    selected_name = "fur-strands"
    selected = dict(results)[selected_name]
    change_bounds = ImageChops.difference(baseline, selected).getbbox()
    assert change_bounds is not None
    assert 1250 <= change_bounds[0] < change_bounds[2] <= 1700
    assert 400 <= change_bounds[1] < change_bounds[3] <= 580
    assert all(selected.getpixel(point) == original.getpixel(point) for point in CONTROL_POINTS)
    assert head_change(selected, original) < head_change(baseline, original)

    project = OUTPUT / f"{selected_name}.pcraft"
    info = json.loads(subprocess.run([str(CLI), "info", str(project), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
    assert len(info["layers"]) == 2 and info["layers"][0]["hasMask"]
    restored_project = OUTPUT / "selected-adjustment-off.pcraft"
    restored_preview = OUTPUT / "selected-adjustment-off.png"
    command("run", str(project), "--cmd", "layer.setProps", "--params", json.dumps({"visible": False}), "--out", str(restored_project))
    command("convert", str(restored_project), str(restored_preview))
    restored = Image.open(restored_preview).convert("RGB")
    restoration_difference = ImageChops.difference(original, restored)
    assert max(channel[1] for channel in ImageStat.Stat(restoration_difference).extrema) <= 4

    DELIVERY.mkdir(parents=True, exist_ok=True)
    shutil.copy2(project, DELIVERY / "gray-ear-refined.pcraft")
    shutil.copy2(OUTPUT / f"{selected_name}.png", DELIVERY / "gray-ear-refined.png")
    panels = [("Original", original), ("Previous", baseline), ("Refined", selected)]
    panel_width, panel_height = BOX[2] - BOX[0], BOX[3] - BOX[1]
    review = Image.new("RGB", (panel_width * 3, panel_height + 38), "#ffffff")
    draw = ImageDraw.Draw(review)
    for index, (label, image) in enumerate(panels):
        x = panel_width * index
        draw.text((x + 12, 10), label, fill="#111111")
        review.paste(image.crop(BOX), (x, 38))
    review.save(DELIVERY / "ear-root-comparison.png")
    close_box = (1300, 400, 1680, 560)
    close_width, close_height = close_box[2] - close_box[0], close_box[3] - close_box[1]
    manual_review = Image.new("RGB", (close_width * 2, close_height + 24), "#ffffff")
    manual_draw = ImageDraw.Draw(manual_review)
    for index, (label, image) in enumerate([("Current fine strokes", strand_image), ("Added gray fibers", balanced_image)]):
        x = close_width * index
        manual_draw.text((x + 8, 5), label, fill="#111111")
        manual_review.paste(image.crop(close_box), (x, 24))
    manual_review.resize((manual_review.width * 3, manual_review.height * 3), Image.Resampling.NEAREST).save(DELIVERY / "manual-pass-comparison.png")
    report = {
        "source": str(SOURCE.relative_to(ROOT)),
        "selected_stroke": selected_name,
        "changed_bounds_xyxy": change_bounds,
        "head_change_baseline": round(head_change(baseline, original), 3),
        "head_change_refined": round(head_change(selected, original), 3),
        "head_change_added_gray_fibers_candidate": round(head_change(balanced_image, original), 3),
        "ear_core_points_unchanged_from_previous": EAR_POINTS,
        "control_points_equal_original": CONTROL_POINTS,
        "editable_project_layers": len(info["layers"]),
        "adjustment_off_matches_original_max_channel_error": max(channel[1] for channel in ImageStat.Stat(restoration_difference).extrema),
    }
    (DELIVERY / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print({name: round(head_change(image, original), 3) for name, image in results[1:]})
    print(DELIVERY / "ear-root-comparison.png")


if __name__ == "__main__":
    main()
