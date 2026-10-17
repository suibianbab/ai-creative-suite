"""Verify subject/background targets run from the provider mask on any image.

These targets must work without a drawn scope: the rembg subject mask selects
`subject` directly and `select.inverse` turns it into `background`. A drawn
rect stays an optional refinement (mask ∩ rect), and any other selection
source must be rejected with a clear message.
"""

from io import BytesIO
from json import dumps, loads
import os
from pathlib import Path
from subprocess import run
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = os.environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")
MASK_PROVIDER = os.environ.get(
    "PHOTOCRAFT_MASK_PROVIDER", "http://127.0.0.1:4101/v1/masks/remove-background"
)
OUT = ROOT / ".tools/photocraft-selection-qa/subject-target-test"


def edit(plan, rect=None, outline=None, selection_method="provider", provider_scope_feather="20"):
    request = Request(
        f"{BASE}/v1/instruction",
        data=SOURCE.read_bytes(),
        headers={
            "Content-Type": "image/jpeg",
            "X-Acs-Plan": dumps(plan),
            "X-Acs-Points": "[]",
            "X-Acs-Rect": dumps(rect),
            "X-Acs-Outline": dumps(outline or []),
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": selection_method,
            "X-Acs-Heal-Size": "32",
            "X-Acs-Provider-Scope-Feather": provider_scope_feather,
        },
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        return loads(response.read())


def fetch(url: str) -> bytes:
    with urlopen(f"{BASE}{url}", timeout=120) as response:
        return response.read()


def native_info(path: Path) -> dict:
    return loads(
        run([str(CLI), "info", str(path), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout
    )


def max_diff(a, b) -> int:
    return max(abs(x - y) for x, y in zip(a, b))


def assert_unchanged(preview, original, point, label, tol=2):
    # PhotoCraft and PIL decode the source JPEG slightly differently, so
    # untouched pixels may shift by a channel count of ~2.
    diff = max_diff(preview.getpixel(point), original.getpixel(point))
    assert diff <= tol, (label, point, original.getpixel(point), preview.getpixel(point))


def assert_changed(preview, original, point, label, floor=4):
    diff = max_diff(preview.getpixel(point), original.getpixel(point))
    assert diff > floor, (label, point, original.getpixel(point), preview.getpixel(point))


def subject_mask() -> Image.Image:
    request = Request(
        MASK_PROVIDER,
        data=SOURCE.read_bytes(),
        headers={"Content-Type": "image/jpeg"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        mask = Image.open(BytesIO(response.read())).convert("L")
    original = Image.open(SOURCE).convert("RGB")
    assert mask.size == original.size, (mask.size, original.size)
    return mask


def find_point(
    mask: Image.Image,
    original: Image.Image,
    want_subject: bool,
    bounds=None,
    avoid=None,
    colored=False,
    bright=False,
):
    width, height = mask.size
    x0, y0, x1, y1 = bounds or (0, 0, width, height)
    for y in range(y0, min(y1, height), 6):
        for x in range(x0, min(x1, width), 6):
            if avoid and avoid[0] <= x < avoid[0] + avoid[2] and avoid[1] <= y < avoid[1] + avoid[3]:
                continue
            if (mask.getpixel((x, y)) > 128) != want_subject:
                continue
            pixel = original.getpixel((x, y))
            if colored and max(pixel) - min(pixel) < 30:
                continue
            if bright and sum(pixel) < 240:
                continue
            return (x, y)
    raise AssertionError("no sampling point matched the requested mask/original predicates")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    original = Image.open(SOURCE).convert("RGB")
    mask = subject_mask()
    subject_point = find_point(mask, original, True, colored=True)
    background_point = find_point(mask, original, False, bright=True)

    # 1. subject recolor without any drawn scope
    result = edit({"operation": "recolor", "target": "subject", "color": "gray", "protectLabel": False})
    assert result["layers"] == 2, result
    (OUT / "subject-gray.png").write_bytes(fetch(result["previewUrl"]))
    (OUT / "subject-gray.pcraft").write_bytes(fetch(result["sourceUrl"]))
    preview = Image.open(OUT / "subject-gray.png").convert("RGB")
    assert_changed(preview, original, subject_point, "subject recolored")
    assert_unchanged(preview, original, background_point, "background untouched")
    info = native_info(OUT / "subject-gray.pcraft")
    assert info["layers"][0]["hasMask"]
    assert info["layers"][0]["adjustment"]["HueSaturation"]["saturation"] == -100

    # hiding the desaturation layer restores the untouched original
    restored_source = OUT / "subject-gray-restored.pcraft"
    restored_preview = OUT / "subject-gray-restored.png"
    run(
        [str(CLI), "run", str(OUT / "subject-gray.pcraft"), "--cmd", "layer.setProps", "--params", dumps({"visible": False}), "--out", str(restored_source)],
        check=True,
        capture_output=True,
        timeout=120,
    )
    run([str(CLI), "convert", str(restored_source), str(restored_preview)], check=True, capture_output=True, timeout=120)
    restored = Image.open(restored_preview).convert("RGB")
    for point in [subject_point, background_point]:
        assert max_diff(restored.getpixel(point), original.getpixel(point)) <= 4, point

    # 2. background brightness without any drawn scope (inverse of the mask)
    result = edit({"operation": "adjust", "target": "background", "adjustment": "brightness", "amount": -20, "protectLabel": False})
    assert result["layers"] == 2, result
    (OUT / "background-darker.png").write_bytes(fetch(result["previewUrl"]))
    (OUT / "background-darker.pcraft").write_bytes(fetch(result["sourceUrl"]))
    preview = Image.open(OUT / "background-darker.png").convert("RGB")
    assert_changed(preview, original, background_point, "background darkened")
    assert_unchanged(preview, original, subject_point, "subject untouched")
    info = native_info(OUT / "background-darker.pcraft")
    assert info["layers"][0]["hasMask"]
    assert info["layers"][0]["adjustment"]["BrightnessContrast"]["brightness"] == -20, info["layers"][0]["adjustment"]

    # 3. an optional rect refines the mask instead of replacing it
    rect = [1360, 145, 440, 450]
    subject_inside = find_point(mask, original, True, bounds=(rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]), colored=True)
    subject_outside = find_point(mask, original, True, avoid=rect, colored=True)
    result = edit({"operation": "recolor", "target": "subject", "color": "green", "protectLabel": False}, rect=rect)
    assert result["layers"] == 2, result
    (OUT / "subject-green-rect.png").write_bytes(fetch(result["previewUrl"]))
    (OUT / "subject-green-rect.pcraft").write_bytes(fetch(result["sourceUrl"]))
    preview = Image.open(OUT / "subject-green-rect.png").convert("RGB")
    assert_changed(preview, original, subject_inside, "subject inside rect recolored")
    assert_unchanged(preview, original, subject_outside, "subject outside rect untouched")
    assert_unchanged(preview, original, background_point, "background untouched")
    info = native_info(OUT / "subject-green-rect.pcraft")
    assert info["layers"][0]["hasMask"]
    assert info["layers"][0]["blend"] == "Color"
    assert info["layers"][0]["adjustment"]["HueSaturation"]["saturation"] == 35

    # 4. subject/background only accept the provider selection source
    for plan in [
        {"operation": "recolor", "target": "subject", "color": "gray", "protectLabel": False},
        {"operation": "adjust", "target": "background", "adjustment": "brightness", "amount": -20, "protectLabel": False},
    ]:
        # the bridge serializes jobs (maxActiveRequests=1) and answers 429
        # while the previous response is still draining; honor retry-after
        for attempt in range(4):
            try:
                edit(plan, rect=rect, selection_method="object")
            except HTTPError as error:
                if error.code == 429:
                    time.sleep(float(error.headers.get("retry-after", "3")))
                    continue
                assert error.code == 400
                failure = loads(error.read())
                assert "AI 主体蒙版" in failure["error"], failure
                break
            else:
                raise AssertionError(f"{plan['target']} target accepted a non-provider selection source")
        else:
            raise AssertionError("bridge stayed busy; rejection could not be verified")

    print("PASS: subject/background edit from the provider mask; rect refines but never replaces it")


if __name__ == "__main__":
    main()
