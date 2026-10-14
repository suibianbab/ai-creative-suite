"""Probe point-prompted SAM ear masks; edit rendering remains PhotoCraft-native."""

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
os.environ["REMBG_HOME"] = str((ROOT / ".tools/rembg-models").resolve())
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/sam-ear"


def main() -> None:
    from rembg import new_session

    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGB")
    session = new_session("sam", sam_quant=True)
    cases = {
        "ear-2p-2n": [(1540, 300, 1), (1520, 400, 1), (1490, 500, 0), (1420, 470, 0)],
        "ear-3p-3n": [(1540, 300, 1), (1520, 400, 1), (1580, 390, 1), (1490, 500, 0), (1420, 470, 0), (1640, 500, 0)],
        "ear-3p-5n": [(1540, 300, 1), (1520, 400, 1), (1580, 390, 1), (1490, 500, 0), (1420, 470, 0), (1640, 500, 0), (1460, 560, 0), (1650, 380, 0)],
    }
    for name, points in cases.items():
        prompt = [{"type": "point", "label": label, "data": [x, y]} for x, y, label in points]
        mask = session.predict(image, sam_prompt=prompt)[0].convert("L")
        mask.save(OUT / f"{name}.png")
        print(name,mask.getbbox(), [mask.getpixel((x,y)) for x,y,label in points])
    crop_box = (1280, 120, 1770, 630)
    local_image = image.crop(crop_box)
    for name, points in cases.items():
        prompt = [{"type": "point", "label": label, "data": [x - crop_box[0], y - crop_box[1]]} for x, y, label in points]
        local_mask = session.predict(local_image, sam_prompt=prompt)[0].convert("L")
        mask = Image.new("L", image.size, 0)
        mask.paste(local_mask, crop_box[:2])
        mask.save(OUT / f"{name}-crop.png")
        print(name + "-crop", mask.getbbox(), [mask.getpixel((x, y)) for x, y, label in points])
    box_cases = {
        "box-3p-2n": ([(1540, 300, 1), (1490, 360, 1), (1540, 420, 1), (1470, 510, 0), (1610, 510, 0)], (1360, 180, 1650, 485)),
        "box-4p-4n": ([(1540, 300, 1), (1490, 360, 1), (1430, 410, 1), (1570, 430, 1), (1470, 510, 0), (1610, 510, 0), (1350, 430, 0), (1670, 390, 0)], (1340, 180, 1660, 490)),
    }
    for name, (points, rectangle) in box_cases.items():
        prompt = [{"type": "rectangle", "data": [rectangle[0] - crop_box[0], rectangle[1] - crop_box[1], rectangle[2] - crop_box[0], rectangle[3] - crop_box[1]], "label": 1}]
        prompt += [{"type": "point", "label": label, "data": [x - crop_box[0], y - crop_box[1]]} for x, y, label in points]
        local_mask = session.predict(local_image, sam_prompt=prompt)[0].convert("L")
        mask = Image.new("L", image.size, 0)
        mask.paste(local_mask, crop_box[:2])
        mask.save(OUT / f"{name}-crop.png")
        print(name + "-crop", mask.getbbox(), [mask.getpixel((x, y)) for x, y, label in points])


if __name__ == "__main__":
    main()
