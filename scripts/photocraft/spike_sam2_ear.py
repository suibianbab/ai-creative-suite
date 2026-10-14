"""Evaluate official SAM 2.1 point masks before exposing them to Image Studio."""

import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
os.environ["HF_HUB_CACHE"] = str((ROOT / ".tools/hf-cache").resolve())
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/sam2-ear"
CROP = (1280, 120, 1770, 630)
FULL = os.environ.get("SAM2_FULL_IMAGE") == "1"
CASES = {
    "2p-2n": [(1540, 300, 1), (1520, 400, 1), (1490, 500, 0), (1420, 470, 0)],
    "3p-5n": [(1540, 300, 1), (1520, 400, 1), (1580, 390, 1), (1490, 500, 0), (1420, 470, 0), (1640, 500, 0), (1460, 560, 0), (1650, 380, 0)],
}


def main() -> None:
    from transformers import Sam2Model, Sam2Processor
    import torch

    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGB")
    bounds = (0, 0, image.width, image.height) if FULL else CROP
    crop = image.crop(bounds)
    model_id = "facebook/sam2.1-hiera-small"
    processor = Sam2Processor.from_pretrained(model_id)
    model = Sam2Model.from_pretrained(model_id).eval()
    for name, points in CASES.items():
        input_points = [[[[x - bounds[0], y - bounds[1]] for x, y, _ in points]]]
        input_labels = [[[label for _, _, label in points]]]
        inputs = processor(images=crop, input_points=input_points, input_labels=input_labels, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0]
        print(name, "masks", tuple(masks.shape), "scores", outputs.iou_scores.cpu().numpy().tolist())
        for index, mask in enumerate(masks.reshape(-1, crop.height, crop.width)):
            local = Image.fromarray(np.where(mask.numpy(), 255, 0).astype(np.uint8), "L")
            full = Image.new("L", image.size, 0)
            full.paste(local, bounds[:2])
            full.save(OUT / f"{name}-{'full' if FULL else 'crop'}-{index}.png")
            print(name, index, full.getbbox(), [full.getpixel((x, y)) for x, y, _ in points])
    for name, points in CASES.items():
        input_points = [[[[x - bounds[0], y - bounds[1]] for x, y, _ in points]]]
        input_labels = [[[label for _, _, label in points]]]
        box = [[[1360 - bounds[0], 180 - bounds[1], 1670 - bounds[0], 490 - bounds[1]]]]
        inputs = processor(images=crop, input_points=input_points, input_labels=input_labels, input_boxes=box, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0]
        print(name + "-box", "scores", outputs.iou_scores.cpu().numpy().tolist())
        for index, mask in enumerate(masks.reshape(-1, crop.height, crop.width)):
            local = Image.fromarray(np.where(mask.numpy(), 255, 0).astype(np.uint8), "L")
            full = Image.new("L", image.size, 0)
            full.paste(local, bounds[:2])
            full.save(OUT / f"{name}-box-{'full' if FULL else 'crop'}-{index}.png")
            print(name + "-box", index, full.getbbox(), [full.getpixel((x, y)) for x, y, _ in points])


if __name__ == "__main__":
    main()
