# -*- coding: utf-8 -*-
"""C 项像素 GT 起草：标注框中心点提示 SAM（猫头/猫脸用标注框 box 提示），
产出 0/255 灰度草稿蒙版。

用法（仓库根目录，venv-sam2）：
  .tools/venv-sam2/Scripts/python.exe scripts/photocraft/draft-grounding-masks.py \
      qa/fixtures/photocraft-grounding/annotations.json \
      .tools/photocraft-grounding-work/masks-draft

这不是标注工具：草稿仅供两轮 VLM 叠加图复核 + 人工笔刷修正
（apply-grounding-mask-patches.py），开发者终审后才落
qa/fixtures/photocraft-grounding/masks/；manifest.json 的方法串如实声明
「SAM 家族起草，与被测服务非独立」（服务用 8×8 网格 + CLIP 排序，此处用
标注框中心点提示——提示通道不同，模型家族相同）。

草稿坐标系：SAM 在服务同款预处理（exif_transpose + ≤1024 LANCZOS）上推理，
解码回原尺寸后 NEAREST 放大到标注 width×height，保持与最终 GT 同分辨率，
复核/评测都不再缩放。多实例短语（多框）跳过——逐候选 IoU 对并集 GT 无意义。
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("REMBG_HOME", str((ROOT / ".tools/rembg-models").resolve()))

# 代表性目标（codex §C 点名类别）：帽顶/帽沿、猫头/猫脸（毛发+耳）、屋顶×2、
# 窗户×3（dinner-table 窗为遮挡样本）、门洞（l-beck 拱门内阴影，天然孔洞例）、
# 花朵/花蕊（花蕊为小目标）。全部为单实例短语。
REPRESENTATIVE_TARGETS = [
    ("../photocraft-hat-teal.png", "帽顶"),
    ("../photocraft-hat-teal.png", "帽沿"),
    ("../photocraft-fluffy-cat-cc0.jpg", "猫头"),
    ("../photocraft-fluffy-cat-cc0.jpg", "猫脸"),
    ("meigs-house-front-street-marietta-oh.jpg", "屋顶"),
    ("plas-newydd-llangollen-2010.jpg", "屋顶"),
    ("plas-newydd-llangollen-2010.jpg", "窗户"),
    ("l-beck-an-der-mauer-150-152-2017-0454.jpg", "窗户"),
    ("dinner-table-and-chairs.jpg", "窗户"),
    ("l-beck-an-der-mauer-150-152-2017-0454.jpg", "门"),
    ("hibiscus-brilliant.jpg", "花朵"),
    ("hibiscus-brilliant.jpg", "花蕊"),
]
# 蓬毛猫的两个目标点提示会退化成覆盖半图的大团块（框中心落在毛发纹理上，
# 最佳输出为 0.48/0.54 面积的 blob，裁剪后只剩实心矩形）——这两个目标改用
# 标注框 box 提示，输出天然约束在框内且保留头部轮廓。仍属 SAM 家族，
# manifest 非独立性声明不变。
BOX_PROMPT_TARGETS = {
    ("../photocraft-fluffy-cat-cc0.jpg", "猫头"),
    ("../photocraft-fluffy-cat-cc0.jpg", "猫脸"),
}
# 框+单点仍只抓「面中轴核」（耳朵/额头/颊外侧漏）。这两目标再加一组从
# 标注框几何派生的正点（耳中、额顶、颊、下巴——不是新标注，框内固定
# 相对位置），引导 SAM 拉满整个头部。迭代过程记入 manifest 方法串。
EXTRA_POINT_TARGETS = {
    ("../photocraft-fluffy-cat-cc0.jpg", "猫头"): [
        (0.545, 0.185),  # 左耳中
        (0.815, 0.185),  # 右耳中
        (0.68, 0.24),  # 头顶
        (0.68, 0.34),  # 口鼻
    ],
    ("../photocraft-fluffy-cat-cc0.jpg", "猫脸"): [
        (0.675, 0.235),  # 前额
        (0.575, 0.31),  # 左颊
        (0.775, 0.31),  # 右颊
        (0.675, 0.355),  # 下巴
    ],
}
MODEL_LIMIT = 1024


def prompt_mask(session, image: Image.Image, prompts: list[dict]):
    """点/框提示解码，返回 3 个输出中分数最高的 bool 蒙版（图像分辨率）。

    与 spike_sam_candidates.py 同一套 rembg sam 会话机制（encoder 一次、
    decoder 提示、transform_masks 回原尺寸）。prompts 透传 rembg
    get_input_points 认可的 {"type":"point"} / {"type":"rectangle"}。
    """
    from rembg.sessions.sam import (
        apply_coords,
        get_input_points,
        transform_masks,
        warp_affine,
    )

    input_size = (684, 1024)
    target_size = 1024
    rgb = np.asarray(image.convert("RGB"))
    original_size = rgb.shape[:2]
    scale = min(input_size[1] / original_size[1], input_size[0] / original_size[0])
    transform = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]])
    model_image = warp_affine(rgb, transform[:2], input_size).astype(np.float32)
    embeddings = session.encoder.run(
        None, {session.encoder.get_inputs()[0].name: model_image}
    )[0]
    input_points, input_labels = get_input_points(prompts)
    coords = np.concatenate([input_points, np.array([[0.0, 0.0]])], axis=0)[
        None, :, :
    ]
    labels = np.concatenate([input_labels, np.array([-1])], axis=0)[None, :].astype(
        np.float32
    )
    coords = apply_coords(coords, input_size, target_size).astype(np.float32)
    coords = np.concatenate(
        [coords, np.ones((1, coords.shape[1], 1), dtype=np.float32)], axis=2
    )
    coords = (coords @ transform.T)[:, :, :2].astype(np.float32)
    outputs = session.decoder.run(
        None,
        {
            "image_embeddings": embeddings,
            "point_coords": coords,
            "point_labels": labels,
            "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
            "has_mask_input": np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array(input_size, dtype=np.float32),
        },
    )
    masks = transform_masks(outputs[0], original_size, np.linalg.inv(transform))
    scores = outputs[1][0]
    best = int(np.argmax(scores))
    # decoder 输出是 logits：>0 才是选中（parts-candidates.py _sam_regions 同口径）。
    return masks[0][best] > 0, float(scores[best])


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    annotations_path = Path(sys.argv[1])
    out_root = Path(sys.argv[2])
    out_root.mkdir(parents=True, exist_ok=True)
    data = json.loads(annotations_path.read_text(encoding="utf-8"))
    fixture_dir = annotations_path.parent
    by_image: dict[str, list[str]] = {}
    for image_name, phrase in REPRESENTATIVE_TARGETS:
        by_image.setdefault(image_name, []).append(phrase)

    from rembg import new_session

    session = new_session("sam", sam_quant=True)
    drafted = 0
    for entry in data["images"]:
        image_name = entry["image"]
        phrases = by_image.get(image_name)
        if not phrases:
            continue
        image_path = fixture_dir / image_name
        image = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
        # 服务同款预处理：SAM 在 ≤1024 上推理，随后一次性放大回标注分辨率。
        scale = min(1.0, MODEL_LIMIT / max(image.size))
        if scale < 1.0:
            inference = image.resize(
                (round(image.width * scale), round(image.height * scale)),
                Image.Resampling.LANCZOS,
            )
        else:
            inference = image
        targets = {t["phrase"]: t for t in entry["targets"]}
        for phrase in phrases:
            target = targets.get(phrase)
            if target is None:
                print(f"skip (phrase missing): {image_name} | {phrase}")
                continue
            if len(target["boxes"]) != 1:
                print(f"skip (multi-instance): {image_name} | {phrase}")
                continue
            x, y, w, h = target["boxes"][0]
            if (image_name, phrase) in BOX_PROMPT_TARGETS:
                # 框+中心正点组合：纯框提示只抓框内最显著核（面中轴），
                # 纯点提示退化成半图团块；组合让输出拉满整个头部。
                prompts = [
                    {
                        "type": "rectangle",
                        "data": [
                            round(x * inference.width),
                            round(y * inference.height),
                            round((x + w) * inference.width),
                            round((y + h) * inference.height),
                        ],
                    },
                    {
                        "type": "point",
                        "label": 1,
                        "data": [
                            round((x + w / 2) * inference.width),
                            round((y + h / 2) * inference.height),
                        ],
                    },
                ]
                for px, py in EXTRA_POINT_TARGETS.get(
                    (image_name, phrase), []
                ):
                    prompts.append(
                        {
                            "type": "point",
                            "label": 1,
                            "data": [
                                round(px * inference.width),
                                round(py * inference.height),
                            ],
                        }
                    )
            else:
                prompts = [
                    {
                        "type": "point",
                        "label": 1,
                        "data": [
                            round((x + w / 2) * inference.width),
                            round((y + h / 2) * inference.height),
                        ],
                    }
                ]
            mask, score = prompt_mask(session, inference, prompts)
            ratio = float(mask.sum()) / (mask.shape[0] * mask.shape[1])
            full = Image.fromarray(
                np.where(mask, 255, 0).astype(np.uint8), "L"
            ).resize((entry["width"], entry["height"]), Image.Resampling.NEAREST)
            out_dir = out_root / image_name
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{phrase}.png"
            full.save(out_path)
            drafted += 1
            print(
                f"draft {image_name} | {phrase}: score={score:.3f} "
                f"area={ratio:.4f} bbox={full.getbbox()} -> {out_path}"
            )
    print(f"done: {drafted} drafts under {out_root}")


if __name__ == "__main__":
    main()
