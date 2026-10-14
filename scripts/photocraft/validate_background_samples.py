"""Visual samples for hard fabric, fur, and smooth product edges.

Uses one saved Qwen empty studio background to isolate PhotoCraft/segmentation
composition quality from changes in the image-generation service.
"""

import json
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:4112"
BACKGROUND = ROOT / "artifacts/qwen-empty-background-2026-10-13.png"
OUT = ROOT / "artifacts/background-layer-qa-2026-10-13"
CASES = [
    ("hat", ROOT / "qa/fixtures/photocraft-hat-teal.png", "on"),
    ("cat-fur", ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg", "off"),
    ("shampoo", ROOT / "artifacts/image-ecommerce-commons-2026-10-09/originals/matte-shampoo.jpg", "on"),
]


def request(path: str, data: bytes, headers: dict[str, str]) -> dict:
    with urlopen(Request(BASE + path, data=data, headers=headers, method="POST"), timeout=150) as response:
        return json.load(response)


def download(path: str) -> bytes:
    with urlopen(BASE + path, timeout=40) as response:
        return response.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    generated = BACKGROUND.read_bytes()
    for name, source_path, shadow in CASES:
        preview = OUT / f"{name}.png"
        source = OUT / f"{name}.pcraft"
        if not preview.exists() or not source.exists():
            original = source_path.read_bytes()
            mime = "image/png" if source_path.suffix == ".png" else "image/jpeg"
            native = request("/v1/normalize", original, {"Content-Type": mime})
            result = request("/v1/compose-background", generated, {
                "Content-Type": "image/png", "x-acs-source-job": native["id"],
                "x-acs-foreground-selection": "provider", "x-acs-background-shadow": shadow,
            })
            preview.write_bytes(download(result["previewUrl"]))
            source.write_bytes(download(result["sourceUrl"]))
        info = request("/v1/inspect", source.read_bytes(), {"Content-Type": "application/x-photocraft"})
        assert info["layers"] == 3 and info["layerDetails"][0]["hasMask"]
        assert Image.open(preview).size == Image.open(source_path).size
        print(json.dumps({"case": name, "preview": str(preview), "source": str(source),
                          "layers": info["layers"], "shadow": shadow}))


if __name__ == "__main__":
    main()
