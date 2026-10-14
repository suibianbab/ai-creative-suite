"""Verify Provider segmentation remains a PhotoCraft-native editable mask."""

from io import BytesIO
from json import dumps, loads
import os
from pathlib import Path
from subprocess import run
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = os.environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")
OUT = ROOT / ".tools/photocraft-selection-qa/provider-bridge-test"


def edit(data: bytes, content_type: str, outline: list[list[int]] | None = None) -> dict:
    request = Request(
        f"{BASE}/v1/instruction",
        data=data,
        headers={
            "Content-Type": content_type,
            "X-Acs-Plan": dumps({"operation": "recolor", "target": "selected-area", "color": "green", "protectLabel": False}),
            "X-Acs-Points": "[]",
            "X-Acs-Rect": dumps([1360, 145, 440, 450]) if outline is None else "null",
            "X-Acs-Outline": dumps(outline or []),
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": "provider",
            "X-Acs-Provider-Scope-Feather": "80" if outline is None else "20",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        return loads(response.read())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    native = OUT / "cat-original.pcraft"
    run([str(CLI), "convert", str(SOURCE), str(native)], check=True, capture_output=True, timeout=120)
    original = Image.open(SOURCE).convert("RGB")
    for kind, data, content_type in [
        ("jpeg", SOURCE.read_bytes(), "image/jpeg"),
        ("native", native.read_bytes(), "application/x-photocraft"),
        ("ear-outline", SOURCE.read_bytes(), "image/jpeg"),
    ]:
        outline = (
            [[1340, 415], [1420, 335], [1500, 240], [1590, 190], [1660, 225], [1690, 420], [1600, 485], [1450, 480]]
            if kind == "ear-outline"
            else None
        )
        result = edit(data, content_type, outline)
        assert result["layers"] == 2, result
        with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
            preview_bytes = response.read()
        with urlopen(f"{BASE}{result['sourceUrl']}", timeout=120) as response:
            source_bytes = response.read()
        assert source_bytes[:4] == b"PK\x03\x04"
        (OUT / f"cat-ear-{kind}.png").write_bytes(preview_bytes)
        (OUT / f"cat-ear-{kind}.pcraft").write_bytes(source_bytes)
        preview = Image.open(BytesIO(preview_bytes)).convert("RGB")
        assert preview.getpixel((1550, 350)) != original.getpixel((1550, 350))
        for point in [(1050, 330), (200, 300), (1500, 800)]:
            assert preview.getpixel(point) == original.getpixel(point), (kind, point)
        if kind == "ear-outline":
            assert preview.getpixel((1550, 600)) == original.getpixel((1550, 600))
            # The intended ear root must recolor too, without a large orange hole.
            root_original = original.getpixel((1560, 430))
            root_edited = preview.getpixel((1560, 430))
            assert max(abs(a - b) for a, b in zip(root_original, root_edited)) > 20
            ear = (1470, 285, 1580, 380)
            source_contrast = ImageStat.Stat(original.crop(ear).convert("L")).stddev[0]
            edited_contrast = ImageStat.Stat(preview.crop(ear).convert("L")).stddev[0]
            assert abs(edited_contrast - source_contrast) < 2, (source_contrast, edited_contrast)
        info = loads(run([str(CLI), "info", str(OUT / f"cat-ear-{kind}.pcraft"), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
        assert info["layers"][0]["hasMask"]
        assert info["layers"][0]["blend"] == "Color"
        assert info["layers"][0]["adjustment"]["HueSaturation"]["saturation"] == 35
        assert len(info["layers"]) == 2
        if kind == "ear-outline":
            restored_source = OUT / "cat-ear-restored.pcraft"
            restored_preview = OUT / "cat-ear-restored.png"
            run(
                [str(CLI), "run", str(OUT / f"cat-ear-{kind}.pcraft"), "--cmd", "layer.setProps", "--params", dumps({"visible": False}), "--out", str(restored_source)],
                check=True,
                capture_output=True,
                timeout=120,
            )
            run([str(CLI), "convert", str(restored_source), str(restored_preview)], check=True, capture_output=True, timeout=120)
            restored = Image.open(restored_preview).convert("RGB")
            difference = ImageStat.Stat(ImageChops.difference(original, restored))
            assert max(difference.extrema[channel][1] for channel in range(3)) <= 4
            assert max(difference.mean) < 0.1
            restored_info = loads(run([str(CLI), "info", str(restored_source), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout)
            assert not restored_info["layers"][0]["visible"]
            assert restored_info["layers"][0]["hasMask"]
    try:
        edit(SOURCE.read_bytes(), "image/jpeg", [[80, 80], [320, 80], [320, 230], [80, 230]])
    except HTTPError as error:
        assert error.code == 400
        failure = loads(error.read())
        assert "没有交集" in failure["error"], failure
    else:
        raise AssertionError("Empty Provider selection was incorrectly accepted")
    print("PASS: Provider mask stays editable; disabling the green layer restores original ear and background")


if __name__ == "__main__":
    main()
