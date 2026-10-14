"""Exercise PhotoCraft spot healing, exposure and vibrance through the bridge."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from subprocess import run
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

from test_native_object_selection import BASE, ROOT, SOURCE

CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
WORK = ROOT / ".tools/photocraft-selection-qa"


def request(data: bytes, plan: dict, points: list[list[int]] | None = None, mime: str = "image/png") -> dict:
    operation = Request(
        f"{BASE}/v1/instruction",
        data=data,
        headers={
            "Content-Type": mime,
            "X-Acs-Plan": dumps(plan),
            "X-Acs-Points": dumps(points or []),
            "X-Acs-Rect": "null",
            "X-Acs-Outline": "[]",
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": "object",
            "X-Acs-Heal-Size": "55",
        },
        method="POST",
    )
    with urlopen(operation, timeout=120) as response:
        return loads(response.read())


def fetch_image(job: dict) -> Image.Image:
    with urlopen(f"{BASE}{job['previewUrl']}", timeout=120) as response:
        return Image.open(BytesIO(response.read())).convert("RGB")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    marked = WORK / "healing-regression-input.pcraft"
    command = [
        str(CLI), "run", str(ROOT / "qa/fixtures/photocraft-hat-teal.png"),
        "--cmd", "paint.stroke", "--params",
        dumps({"points": [[100, 100], [101, 100]], "size": 30,
               "hardness": 1, "opacity": 1, "color": "#ff0000", "target": "pixels"}),
        "--out", str(marked),
    ]
    run(command, check=True, capture_output=True, timeout=120)
    with marked.open("rb") as source:
        healed = request(
            source.read(),
            {"operation": "heal", "target": "selected-area", "protectLabel": False},
            [[100, 100]], "application/x-photocraft",
        )
    assert healed["layers"] == 2
    recovered = fetch_image(healed).getpixel((100, 100))
    original = Image.open(BytesIO(SOURCE)).convert("RGB").getpixel((100, 100))
    assert max(abs(a - b) for a, b in zip(recovered, original)) <= 3, (recovered, original)
    with urlopen(f"{BASE}{healed['sourceUrl']}", timeout=120) as response:
        assert response.read(4) == b"PK\x03\x04"
    for adjustment in ("exposure", "vibrance", "shadows", "highlights"):
        result = request(SOURCE, {
            "operation": "adjust", "target": "whole-image",
            "adjustment": adjustment, "amount": 20, "protectLabel": False,
        })
        assert result["layers"] == 2
        assert fetch_image(result).getpixel((600, 400)) != Image.open(BytesIO(SOURCE)).convert("RGB").getpixel((600, 400))
    try:
        request(SOURCE, {"operation": "heal", "target": "selected-area", "protectLabel": False}, [])
    except HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError("spot heal without click accepted")
    print("PASS: PhotoCraft spot healing, exposure, vibrance and native tonal curves")


if __name__ == "__main__":
    main()
