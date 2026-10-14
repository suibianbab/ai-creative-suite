"""Inspect each SAM ONNX candidate instead of rembg's union mask."""

import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
os.environ["REMBG_HOME"] = str((ROOT / ".tools/rembg-models").resolve())
SOURCE = ROOT / "qa/fixtures/photocraft-fluffy-cat-cc0.jpg"
OUT = ROOT / ".tools/photocraft-selection-qa/sam-ear"
CROP = (1280, 120, 1770, 630)
POINTS = [(1540, 300, 1), (1520, 400, 1), (1580, 390, 1), (1490, 500, 0), (1420, 470, 0), (1640, 500, 0), (1460, 560, 0), (1650, 380, 0)]


def candidates(session, image: Image.Image, points: list[tuple[int, int, int]], iterative: bool = False) -> tuple[np.ndarray, np.ndarray]:
    from rembg.sessions.sam import apply_coords, get_input_points, transform_masks, warp_affine

    input_size = (684, 1024)
    target_size = 1024
    rgb = np.asarray(image.convert("RGB"))
    original_size = rgb.shape[:2]
    scale = min(input_size[1] / original_size[1], input_size[0] / original_size[0])
    transform = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]])
    model_image = warp_affine(rgb, transform[:2], input_size).astype(np.float32)
    embeddings = session.encoder.run(None, {session.encoder.get_inputs()[0].name: model_image})[0]
    prior = np.zeros((1, 1, 256, 256), dtype=np.float32)
    outputs = None
    for count in range(1 if not iterative else 1, len(points) + 1 if iterative else 2):
        active = points[:count] if iterative else points
        prompts = [{"type": "point", "label": label, "data": [x, y]} for x, y, label in active]
        input_points, input_labels = get_input_points(prompts)
        coords = np.concatenate([input_points, np.array([[0.0, 0.0]])], axis=0)[None, :, :]
        labels = np.concatenate([input_labels, np.array([-1])], axis=0)[None, :].astype(np.float32)
        coords = apply_coords(coords, input_size, target_size).astype(np.float32)
        coords = np.concatenate([coords, np.ones((1, coords.shape[1], 1), dtype=np.float32)], axis=2)
        coords = (coords @ transform.T)[:, :, :2].astype(np.float32)
        outputs = session.decoder.run(None, {
            "image_embeddings": embeddings,
            "point_coords": coords,
            "point_labels": labels,
            "mask_input": prior,
            "has_mask_input": np.ones(1, dtype=np.float32) if iterative and count > 1 else np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array(input_size, dtype=np.float32),
        })
        prior = outputs[2]
    assert outputs is not None
    masks = transform_masks(outputs[0], original_size, np.linalg.inv(transform))
    return masks[0], outputs[1][0]


def main() -> None:
    from rembg import new_session

    image = Image.open(SOURCE).convert("RGB")
    crop = image.crop(CROP)
    local_points = [(x - CROP[0], y - CROP[1], label) for x, y, label in POINTS]
    session = new_session("sam", sam_quant=True)
    masks, scores = candidates(session, crop, local_points)
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (raw, score) in enumerate(zip(masks, scores)):
        local = Image.fromarray(np.where(raw > 0, 255, 0).astype(np.uint8), "L")
        full = Image.new("L", image.size, 0)
        full.paste(local, CROP[:2])
        full.save(OUT / f"candidate-{i}.png")
        print(i, float(score), full.getbbox(), [full.getpixel((x, y)) for x, y, _ in POINTS])
    masks, scores = candidates(session, crop, local_points, iterative=True)
    for i, (raw, score) in enumerate(zip(masks, scores)):
        local = Image.fromarray(np.where(raw > 0, 255, 0).astype(np.uint8), "L")
        full = Image.new("L", image.size, 0)
        full.paste(local, CROP[:2])
        full.save(OUT / f"iterative-{i}.png")
        print("iterative", i, float(score), full.getbbox(), [full.getpixel((x, y)) for x, y, _ in POINTS])


if __name__ == "__main__":
    main()
