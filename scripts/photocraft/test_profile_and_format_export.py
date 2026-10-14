"""Verify PhotoCraft profile handling and layered format export."""

from io import BytesIO
from json import dumps, loads
from pathlib import Path
from subprocess import run
from urllib.request import Request, urlopen

from PIL import Image, ImageCms

from test_native_object_selection import BASE, ROOT, SOURCE

CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
WORK = ROOT / ".tools/photocraft-selection-qa"


def post(path: str, payload: bytes) -> dict:
    operation = Request(
        f"{BASE}{path}", data=payload,
        headers={"Content-Type": "application/x-photocraft"}, method="POST",
    )
    with urlopen(operation, timeout=120) as response:
        return loads(response.read())


def download(path: str) -> bytes:
    with urlopen(f"{BASE}{path}", timeout=120) as response:
        return response.read()


def profile_name(data: bytes) -> str:
    image = Image.open(BytesIO(data))
    icc = image.info.get("icc_profile")
    assert icc, "export omitted ICC profile"
    return ImageCms.getProfileName(ImageCms.ImageCmsProfile(BytesIO(icc))).strip()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    p3 = WORK / "profile-regression-p3.pcraft"
    run([
        str(CLI), "run", str(ROOT / "qa/fixtures/photocraft-hat-teal.png"),
        "--cmd", "edit.convertToProfile", "--params",
        dumps({"profile": "display-p3", "intent": "relative", "bpc": True}),
        "--cmd", "layer.newAdjustmentLayer.brightnessContrast", "--params",
        dumps({"brightness": 5}),
        "--out", str(p3),
    ], check=True, capture_output=True, timeout=120)
    source = p3.read_bytes()
    info = post("/v1/inspect", source)
    assert info["profile"] == "Display P3", info
    assert info["layers"] == 2
    for fmt in ("png", "jpg", "webp", "tif", "psd"):
        result = post(f"/v1/export?format={fmt}&profile=preserve", source)
        data = download(result["downloadUrl"])
        assert profile_name(data) == "Display P3", fmt
        if fmt == "psd":
            saved = WORK / "profile-regression-export.psd"
            saved.write_bytes(data)
            layer_info = loads(run([str(CLI), "info", str(saved), "--compact"],
                                   check=True, capture_output=True, text=True).stdout)
            assert len(layer_info["layers"]) == 2
            assert layer_info["layers"][0]["hasMask"]
    srgb = post("/v1/export?format=png&profile=srgb", source)
    assert profile_name(download(srgb["downloadUrl"])) == "sRGB IEC61966-2.1"
    assert srgb["width"] == 1254 and srgb["height"] == 1254
    print("PASS: native ICC inspect, P3 preservation, sRGB conversion and layered PSD")


if __name__ == "__main__":
    main()
