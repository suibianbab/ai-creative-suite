"""Verify preview brush corrections use PhotoCraft's editable layer mask."""

from io import BytesIO
from json import dumps, loads
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

from test_native_object_selection import BASE, SOURCE, request


def stroke(job: dict, mode: str, points: list[list[int]], size: int = 44) -> dict:
    operation = Request(
        f"{BASE}/v1/jobs/{job['id']}/mask-stroke",
        data=dumps({
            "mode": mode, "points": points, "size": size, "hardness": 0.6,
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(operation, timeout=120) as response:
        return loads(response.read())


def pixel(job: dict, point: tuple[int, int]) -> tuple[int, int, int]:
    with urlopen(f"{BASE}{job['previewUrl']}", timeout=120) as response:
        return Image.open(BytesIO(response.read())).convert("RGB").getpixel(point)


def main() -> None:
    initial = request([270, 720, 920, 330])
    center = (650, 890)
    original = Image.open(BytesIO(SOURCE)).convert("RGB").getpixel(center)
    red = pixel(initial, center)
    assert red != original, (red, original)
    erased = stroke(initial, "erase", [[650, 890], [651, 890]])
    assert erased["id"] != initial["id"]
    assert erased["layers"] == initial["layers"]
    assert pixel(erased, center) == original
    restored = stroke(erased, "add", [[650, 890], [651, 890]])
    assert pixel(restored, center) == red
    assert pixel(initial, center) == red  # earlier immutable preview is undo source
    with urlopen(f"{BASE}{restored['sourceUrl']}", timeout=120) as response:
        assert response.read(4) == b"PK\x03\x04"
    try:
        stroke(initial, "add", [[99999, 99999]])
    except HTTPError as error:
        assert error.code == 400
        assert "超出图片范围" in loads(error.read())["error"]
    else:
        raise AssertionError("out-of-bounds mask stroke accepted")
    print("PASS: PhotoCraft mask erase/add, editable source and immutable undo")


if __name__ == "__main__":
    main()
