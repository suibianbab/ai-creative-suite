"""Verify the live adjustment session (M2 slider handoff) end to end.

A whole-image brightness preview opens as a live serve-session document;
slider moves become one layer.setAdjustment + doc.render round trip, the
preview pixels track the parameter, the editable .pcraft persists the value,
and out-of-range or non-adjustment targets are refused.
"""

from io import BytesIO
from json import dumps, loads
import os
from pathlib import Path
from subprocess import run
from time import sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
BASE = os.environ.get("PHOTOCRAFT_BRIDGE_BASE", "http://127.0.0.1:4112")
OUT = ROOT / ".tools/photocraft-selection-qa/live-session"


def post(path, data=None, headers=None, timeout=180):
    request = Request(
        f"{BASE}{path}",
        data=data,
        headers=headers or {"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return loads(response.read())


def retry_post(path, data=None, headers=None, attempts=4):
    # the bridge serializes jobs (maxActiveRequests=1); honor 429 retry-after
    for _ in range(attempts):
        try:
            return post(path, data, headers)
        except HTTPError as error:
            if error.code == 429:
                sleep(float(error.headers.get("retry-after", "3")))
                continue
            raise
    raise AssertionError("bridge stayed busy")


def fetch(url: str) -> bytes:
    with urlopen(f"{BASE}{url}", timeout=120) as response:
        return response.read()


def native_info(path: Path) -> dict:
    return loads(
        run([str(CLI), "info", str(path), "--compact"], check=True, capture_output=True, text=True, timeout=120).stdout
    )


def sample_mean(image: Image.Image, box=(int, int, int, int)) -> float:
    stat = image.crop(box).convert("L")
    return sum(stat.getdata()) / (stat.width * stat.height)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    original = Image.open(SOURCE).convert("RGB")
    box = (600, 1000, 1300, 1600)

    # 1. a whole-image brightness preview creates the editable job
    result = retry_post(
        "/v1/instruction",
        data=SOURCE.read_bytes(),
        headers={
            "Content-Type": "image/jpeg",
            "X-Acs-Plan": dumps({"operation": "adjust", "target": "whole-image", "adjustment": "brightness", "amount": 10, "protectLabel": False}),
            "X-Acs-Points": "[]",
            "X-Acs-Rect": "null",
            "X-Acs-Outline": "[]",
            "X-Acs-Patches": "[]",
            "X-Acs-Edge-Shift": "0",
            "X-Acs-Edge-Feather": "0",
            "X-Acs-Protect-Rect": "null",
            "X-Acs-Selection-Method": "manual",
            "X-Acs-Heal-Size": "32",
            "X-Acs-Provider-Scope-Feather": "80",
        },
    )
    assert result["transport"] == "serve", result

    # 2. open the previewed source as a live document
    live = retry_post("/v1/live/open", headers={"X-Acs-Source-Job": result["id"]})
    live_id = live["id"]
    adjustment_layers = [layer for layer in live["layers"] if layer["adjustment"]]
    assert len(adjustment_layers) == 1, live["layers"]
    target = adjustment_layers[0]
    assert target["adjustment"]["BrightnessContrast"]["brightness"] == 10
    before = Image.open(BytesIO(fetch(live["previewUrl"]))).convert("RGB")

    # 3. slider move: brightness 10 -> 60 must brighten the preview pixels
    adjusted = retry_post(
        f"/v1/live/{live_id}/adjust",
        data=dumps({"layer": target["id"], "params": {"brightness": 60}}).encode(),
    )
    assert adjusted["adjustment"]["BrightnessContrast"]["brightness"] == 60
    after = Image.open(BytesIO(fetch(adjusted["previewUrl"]))).convert("RGB")
    before_mean = sample_mean(before, box)
    after_mean = sample_mean(after, box)
    assert after_mean > before_mean + 5, (before_mean, after_mean)

    # 4. out-of-range and non-adjustment targets are refused
    for payload in [
        {"layer": target["id"], "params": {"brightness": 999}},
        {"layer": target["id"], "params": {"notAParam": 1}},
        {"layer": live["layers"][-1]["id"], "params": {"brightness": 5}},
    ]:
        try:
            retry_post(f"/v1/live/{live_id}/adjust", data=dumps(payload).encode())
        except HTTPError as error:
            assert error.code == 400, error.code
        else:
            raise AssertionError(f"live adjust accepted invalid payload {payload}")

    # 5. saving persists the slider value into the editable source
    retry_post(f"/v1/live/{live_id}/save")
    source_path = OUT / "live-saved.pcraft"
    source_path.write_bytes(fetch(f"/v1/jobs/{result['id']}/source"))
    info = native_info(source_path)
    assert info["layers"][0]["adjustment"]["BrightnessContrast"]["brightness"] == 60

    # 6. closing ends the session
    retry_post(f"/v1/live/{live_id}/close")
    try:
        retry_post(f"/v1/live/{live_id}/render")
    except HTTPError as error:
        assert error.code == 404, error.code
    else:
        raise AssertionError("closed live session still accepted requests")

    print("PASS: live adjustment session; slider move renders and persists on the native layer")


if __name__ == "__main__":
    main()
