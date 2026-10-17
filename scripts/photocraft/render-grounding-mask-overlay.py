# -*- coding: utf-8 -*-
"""叠加渲染像素 GT 蒙版，供两轮 VLM 复核与开发者终审。

用法（仓库根目录，venv-sam2）：
  .tools/venv-sam2/Scripts/python.exe scripts/photocraft/render-grounding-mask-overlay.py \
      qa/fixtures/photocraft-grounding/annotations.json \
      .tools/photocraft-grounding-work/masks-draft \
      .tools/photocraft-grounding-work/overlays [--all]

对每个 GT 目标渲染：原图（最长边 ≤1024）+ 蒙版红色 40% 填充 + 白色 2px
边界 + 黄色标注框 + 短语标签。蒙版按输出尺寸缩放（红绿通道即蒙版语义，
缩放插值对复核可读性无影响）。默认只渲染代表性目标清单；--all 渲染蒙版
目录下全部条目。输出 <image>.<phrase>.mask.jpg，basename 规避 ../ 路径。
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MAX_SIDE = 1024
FILL = (255, 0, 0, 102)  # 红 40%
BOUNDARY = (255, 255, 255)
BOX = (255, 220, 0)


def load_font(size):
    # 中文标签需要 CJK 字形：优先微软雅黑/黑体，找不到再退回西文字体。
    for name in ("msyh.ttc", "simhei.ttf", "seguisyh.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(image_path: Path, mask_path: Path, box, phrase: str, out_path: Path):
    im = Image.open(image_path).convert("RGB")
    w, h = im.size
    scale = MAX_SIDE / max(w, h)
    if scale < 1:
        im = im.resize((round(w * scale), round(h * scale)))
    w, h = im.size
    mask = Image.open(mask_path).convert("L").resize((w, h))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    overlay.paste(FILL, (0, 0), mask)
    composed = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(composed)
    # 边界：蒙版差分太脆，直接按二值轮廓像素描 2px（膨胀-腐蚀的近似：逐像素
    # 判断邻域）。复核目的是「涂到了哪里」，不追求亚像素边界。
    pixels = mask.load()
    for y in range(h):
        for x in range(w):
            if pixels[x, y] >= 128 and (
                x == 0
                or y == 0
                or x == w - 1
                or y == h - 1
                or pixels[x - 1, y] < 128
                or pixels[x + 1, y] < 128
                or pixels[x, y - 1] < 128
                or pixels[x, y + 1] < 128
            ):
                composed.putpixel((x, y), BOUNDARY)
    if box:
        x, y, bw, bh = box
        px = [round(x * w), round(y * h), round((x + bw) * w), round((y + bh) * h)]
        for off in (2, 0):
            draw.rectangle(
                [px[0] - off, px[1] - off, px[2] + off, px[3] + off],
                outline=(0, 0, 0) if off else BOX,
                width=3,
            )
    font = load_font(max(16, round(min(w, h) / 28)))
    draw.text((7, 7), phrase, font=font, fill=(0, 0, 0))
    draw.text((6, 6), phrase, font=font, fill=BOX)
    composed.save(out_path, "JPEG", quality=88)


def main() -> None:
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    annotations_path = Path(sys.argv[1])
    masks_root = Path(sys.argv[2])
    out_dir = Path(sys.argv[3])
    render_all = "--all" in sys.argv[4:]
    out_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(annotations_path.read_text(encoding="utf-8"))
    fixture_dir = annotations_path.parent
    rendered = 0
    for entry in data["images"]:
        image_name = entry["image"]
        mask_dir = masks_root / image_name
        if not mask_dir.is_dir():
            continue
        boxes = {t["phrase"]: t["boxes"][0] for t in entry["targets"] if t["boxes"]}
        image_path = fixture_dir / image_name
        for mask_path in sorted(mask_dir.glob("*.png")):
            phrase = mask_path.stem
            if not render_all and phrase not in boxes:
                continue
            out_path = out_dir / f"{image_name}.{phrase}.mask.jpg"
            render(image_path, mask_path, boxes.get(phrase), phrase, out_path)
            rendered += 1
            print(f"overlay {image_name} | {phrase} -> {out_path}")
    print(f"done: {rendered} overlays under {out_dir}")


if __name__ == "__main__":
    main()
