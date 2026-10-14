"""Regression gate for the pinned PhotoCraft 0.6.0 black-hat recipe."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
BRIDGE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def read(url: str) -> bytes:
    with urlopen(url, timeout=120) as response:
        return response.read()


def difference(original: Image.Image, edited: Image.Image, box: tuple[int, int, int, int]) -> float:
    delta = ImageChops.difference(original.crop(box), edited.crop(box))
    return sum(ImageStat.Stat(delta).mean) / 3


def main() -> None:
    image = SOURCE.read_bytes()
    points = [[400, 450], [900, 450], [600, 850], [850, 850]]
    plan = {"operation": "recolor", "color": "black", "target": "hat", "protectLabel": False}
    request = Request(
        f"{BRIDGE}/v1/instruction",
        data=image,
        headers={
            "Content-Type": "image/png",
            "X-Acs-Plan": dumps(plan),
            "X-Acs-Points": dumps(points),
            "X-Acs-Rect": "null",
            "X-Acs-Protect-Rect": "null",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    native = read(f"{BRIDGE}{result['sourceUrl']}")
    preview = read(f"{BRIDGE}{result['previewUrl']}")
    assert native.startswith(b"PK\x03\x04"), "editable .pcraft ZIP missing"
    assert result["layers"] >= 2, "masked adjustment layer missing"
    with Image.open(BytesIO(image)) as original_file, Image.open(BytesIO(preview)) as edited_file:
        original = original_file.convert("RGB")
        edited = edited_file.convert("RGB")
        assert original.size == edited.size == (1254, 1254), "image size changed"
        cap = difference(original, edited, (230, 390, 550, 620))
        brim = difference(original, edited, (500, 800, 950, 980))
        label = difference(original, edited, (650, 520, 830, 610))
        background = difference(original, edited, (20, 50, 150, 300))
    assert cap > 35 and brim > 35, f"hat did not change enough: {cap=:.2f}, {brim=:.2f}"
    assert label < 12, f"patch changed too much: {label=:.2f}"
    assert background < 2, f"background changed: {background=:.2f}"
    print(
        "PASS: PhotoCraft masked black-hat recipe; "
        f"mean RGB delta cap={cap:.2f}, brim={brim:.2f}, "
        f"label={label:.2f}, background={background:.2f}"
    )


if __name__ == "__main__":
    main()
