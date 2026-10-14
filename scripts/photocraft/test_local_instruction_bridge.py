"""Exercise bounded PhotoCraft recolor, rectangular adjustment and protection."""

from io import BytesIO
from json import dumps, loads
from os import environ
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
IMAGE = (ROOT / "qa/fixtures/photocraft-hat-teal.png").read_bytes()
BASE = environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")


def edit(plan: dict, points: list, rect: list | None, protected: list | None, outline: list | None = None) -> Image.Image:
    request = Request(
        f"{BASE}/v1/instruction",
        data=IMAGE,
        headers={
            "Content-Type": "image/png",
            "X-Acs-Plan": dumps(plan),
            "X-Acs-Points": dumps(points),
            "X-Acs-Rect": dumps(rect),
            "X-Acs-Outline": dumps(outline or []),
            "X-Acs-Protect-Rect": dumps(protected),
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        result = loads(response.read())
    assert result["layers"] >= 2, "editable adjustment layer missing"
    with urlopen(f"{BASE}{result['previewUrl']}", timeout=120) as response:
        return Image.open(BytesIO(response.read())).convert("RGB")


def main() -> None:
    original = Image.open(BytesIO(IMAGE)).convert("RGB")
    red = edit(
        {"operation": "recolor", "color": "red", "target": "brim", "protectLabel": True},
        [],
        None,
        [620, 480, 270, 180],
        [[280, 800], [450, 790], [700, 750], [990, 730], [1080, 820],
         [1180, 930], [1120, 955], [960, 950], [820, 990], [630, 1035],
         [520, 1040], [400, 960], [280, 820]],
    )
    assert red.size == original.size
    assert red.getpixel((700, 880))[0] > red.getpixel((700, 880))[2], "brim did not turn red"
    assert red.getpixel((600, 400)) == original.getpixel((600, 400)), "hat crown changed outside the brim range"
    assert red.getpixel((60, 80)) == original.getpixel((60, 80)), "background changed"
    assert red.getpixel((900, 1080)) == original.getpixel((900, 1080)), "cast shadow changed"

    green = edit(
        {"operation": "recolor", "color": "green", "target": "hat", "protectLabel": True},
        [[400, 450], [900, 450], [600, 850], [850, 850]],
        None,
        [620, 480, 270, 180],
    )
    assert green.getpixel((400, 450)) != original.getpixel((400, 450)), "hat did not recolor"
    assert green.getpixel((700, 560)) == original.getpixel((700, 560)), "protected patch changed"
    assert green.getpixel((60, 80)) == original.getpixel((60, 80)), "background changed"

    brighter = edit(
        {"operation": "adjust", "adjustment": "brightness", "amount": 25, "target": "hat", "protectLabel": False},
        [],
        [150, 270, 470, 360],
        None,
    )
    assert brighter.getpixel((400, 450)) != original.getpixel((400, 450)), "selected fabric did not change"
    assert brighter.getpixel((1000, 800)) == original.getpixel((1000, 800)), "outside the rectangle changed"

    try:
        edit(
            {"operation": "adjust", "adjustment": "brightness", "amount": 25, "target": "hat", "protectLabel": True},
            [],
            [150, 270, 470, 360],
            None,
        )
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("missing protection rectangle was accepted")
    print("PASS: PhotoCraft lasso red brim, sampled green hat, rectangular brightness, and label protection")


if __name__ == "__main__":
    main()
