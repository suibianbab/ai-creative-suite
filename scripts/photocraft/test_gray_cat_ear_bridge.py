"""End-to-end gray ear recolor through the Image Studio PhotoCraft bridge."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from subprocess import run
from urllib.request import Request, urlopen

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
OUT = ROOT / ".tools/photocraft-selection-qa/gray-ear"
BASE = "http://127.0.0.1:4112"
OUTLINE = [[1340, 415], [1420, 335], [1500, 240], [1590, 190], [1660, 225], [1690, 420], [1600, 485], [1450, 480]]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    request = Request(
        f"{BASE}/v1/instruction",
        data=SOURCE.read_bytes(),
        headers={
            "Content-Type": "image/jpeg",
            "X-Acs-Plan": dumps({"operation": "recolor", "target": "selected-area", "color": "gray", "protectLabel": False}),
            "X-Acs-Points": "[]",
            "X-Acs-Rect": "null",
            "X-Acs-Outline": dumps(OUTLINE),
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": "provider",
            "X-Acs-Provider-Scope-Feather": "60",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        preview_bytes = response.read()
    with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
        native_bytes = response.read()
    assert native_bytes[:4] == b"PK\x03\x04"
    preview_path = OUT / "gray-ear-bridge.png"
    native_path = OUT / "gray-ear-bridge.pcraft"
    preview_path.write_bytes(preview_bytes)
    native_path.write_bytes(native_bytes)

    original = Image.open(SOURCE).convert("RGB")
    edited = Image.open(BytesIO(preview_bytes)).convert("RGB")
    assert edited.size == original.size
    for point in [(1540, 310), (1550, 350), (1560, 430)]:
        before = original.getpixel(point)
        after = edited.getpixel(point)
        assert max(before) - min(before) > 20, (point, before)
        assert max(after) - min(after) < 12, (point, after)
        assert max(abs(a - b) for a, b in zip(before, after)) >= 15, (point, before, after)
    for point in [(1050, 330), (200, 300), (1500, 800), (800, 1200)]:
        assert edited.getpixel(point) == original.getpixel(point), point
    ear_crop = (1470, 285, 1580, 380)
    source_contrast = ImageStat.Stat(original.crop(ear_crop).convert("L")).stddev[0]
    edited_contrast = ImageStat.Stat(edited.crop(ear_crop).convert("L")).stddev[0]
    assert abs(edited_contrast - source_contrast) < 3, (source_contrast, edited_contrast)

    info = loads(run([str(CLI), "info", str(native_path), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
    assert len(info["layers"]) == 2
    assert info["layers"][0]["hasMask"]
    assert info["layers"][0]["blend"] != "Color"
    assert info["layers"][0]["adjustment"]["HueSaturation"]["saturation"] == -100
    assert info["layers"][0]["adjustment"]["HueSaturation"]["lightness"] == 0

    restored_path = OUT / "gray-ear-restored.pcraft"
    restored_png = OUT / "gray-ear-restored.png"
    run([str(CLI), "run", str(native_path), "--cmd", "layer.setProps", "--params", dumps({"visible": False}), "--out", str(restored_path)], check=True, capture_output=True, timeout=120)
    run([str(CLI), "convert", str(restored_path), str(restored_png)], check=True, capture_output=True, timeout=120)
    restored = Image.open(restored_png).convert("RGB")
    diff = ImageStat.Stat(ImageChops.difference(original, restored))
    assert max(diff.extrema[channel][1] for channel in range(3)) <= 4
    assert max(diff.mean) < 0.1

    stroke_request = Request(
        f"{BASE}/v1/jobs/{result['id']}/mask-stroke",
        data=dumps({
            "mode": "erase",
            "points": [[1350, 485], [1390, 495], [1430, 505], [1470, 510], [1510, 510], [1550, 510], [1590, 510], [1630, 495]],
            "size": 60,
            "hardness": 0.6,
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(stroke_request, timeout=120) as response:
        refined_job = loads(response.read())
    with urlopen(f"{BASE}{refined_job['previewUrl']}", timeout=120) as response:
        refined_bytes = response.read()
    with urlopen(f"{BASE}{refined_job['sourceUrl']}", timeout=120) as response:
        refined_source = response.read()
    refined_path = OUT / "gray-ear-refined.png"
    refined_native = OUT / "gray-ear-refined.pcraft"
    refined_path.write_bytes(refined_bytes)
    refined_native.write_bytes(refined_source)
    refined = Image.open(BytesIO(refined_bytes)).convert("RGB")
    head_box = (1400, 465, 1600, 525)
    baseline_head_change = max(ImageStat.Stat(ImageChops.difference(original.crop(head_box), edited.crop(head_box))).mean)
    refined_head_change = max(ImageStat.Stat(ImageChops.difference(original.crop(head_box), refined.crop(head_box))).mean)
    assert refined_head_change < baseline_head_change * 0.6, (baseline_head_change, refined_head_change)
    for point in [(1540, 310), (1550, 350), (1560, 430)]:
        assert refined.getpixel(point) == edited.getpixel(point), point
    for point in [(1050, 330), (200, 300), (1500, 800), (800, 1200)]:
        assert refined.getpixel(point) == original.getpixel(point), point
    refined_info = loads(run([str(CLI), "info", str(refined_native), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
    assert refined_info["layers"][0]["hasMask"]
    refined_restored = OUT / "gray-ear-refined-restored.pcraft"
    refined_restored_png = OUT / "gray-ear-refined-restored.png"
    run([str(CLI), "run", str(refined_native), "--cmd", "layer.setProps", "--params", dumps({"visible": False}), "--out", str(refined_restored)], check=True, capture_output=True, timeout=120)
    run([str(CLI), "convert", str(refined_restored), str(refined_restored_png)], check=True, capture_output=True, timeout=120)
    restored_refined = Image.open(refined_restored_png).convert("RGB")
    refined_diff = ImageStat.Stat(ImageChops.difference(original, restored_refined))
    assert max(refined_diff.extrema[channel][1] for channel in range(3)) <= 4
    browser_save_psd = OUT / "gray-ear-browser-save.psd"
    run([str(CLI), "convert", str(refined_native), str(browser_save_psd)], check=True, capture_output=True, timeout=120)
    assert 20 * 1024 * 1024 < browser_save_psd.stat().st_size < 64 * 1024 * 1024
    normalize_request = Request(
        f"{BASE}/v1/normalize",
        data=browser_save_psd.read_bytes(),
        headers={"Content-Type": "image/vnd.adobe.photoshop"},
        method="POST",
    )
    with urlopen(normalize_request, timeout=120) as response:
        normalized = loads(response.read())
    assert normalized["width"] == 1920 and normalized["height"] == 2560
    assert normalized["layers"] == 2
    with urlopen(f"{BASE}{normalized['sourceUrl']}", timeout=120) as response:
        normalized_path = OUT / "gray-ear-browser-save-normalized.pcraft"
        normalized_path.write_bytes(response.read())
    normalized_info = loads(run([str(CLI), "info", str(normalized_path), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
    assert normalized_info["layers"][0]["hasMask"]
    print(f"PASS: gray ear and PhotoCraft mask brush refinement; head spill {baseline_head_change:.2f} -> {refined_head_change:.2f}; editable source: {refined_native}")


if __name__ == "__main__":
    main()
