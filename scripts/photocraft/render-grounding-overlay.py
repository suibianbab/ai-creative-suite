# -*- coding: utf-8 -*-
"""叠加渲染 ground-truth 标注框，用于人工/视觉复核与报告配图。

用法（在仓库根目录）：
  .tools/venv-sam2/Scripts/python.exe scripts/photocraft/render-grounding-overlay.py \
      qa/fixtures/photocraft-grounding/annotations.json \
      .tools/photocraft-grounding-work/overlays

对 annotations.json 里每张图绘制全部目标框（编号+短语标签），
输出 <image>.overlay.jpg（最长边 1024，jpeg 质量 88）。
标注坐标系为归一化 [x, y, w, h]，渲染时按输出尺寸换算，与分辨率无关。
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 框配色循环（亮色+黑描边，压深色/浅色背景都可见）。
COLORS = [
    (255, 0, 0),
    (0, 255, 80),
    (0, 200, 255),
    (255, 0, 255),
    (255, 200, 0),
    (255, 140, 0),
    (120, 255, 120),
    (200, 120, 255),
]
MAX_SIDE = 1024


def load_font(size):
    # 中文标签需要 CJK 字形：优先微软雅黑/黑体，找不到再退回西文字体。
    for name in ("msyh.ttc", "simhei.ttf", "seguisyh.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_image(image_path: Path, targets, out_path: Path):
    im = Image.open(image_path).convert("RGB")
    w, h = im.size
    scale = MAX_SIDE / max(w, h)
    if scale < 1:
        im = im.resize((round(w * scale), round(h * scale)))
    w, h = im.size
    draw = ImageDraw.Draw(im)
    font = load_font(max(16, round(min(w, h) / 28)))
    for idx, target in enumerate(targets):
        color = COLORS[idx % len(COLORS)]
        label = f"{idx}:{target['phrase']}"
        for box in target["boxes"]:
            x, y, bw, bh = box
            px = [round(x * w), round(y * h), round((x + bw) * w), round((y + bh) * h)]
            for off in (2, 0):
                draw.rectangle(
                    [px[0] - off, px[1] - off, px[2] + off, px[3] + off],
                    outline=(0, 0, 0) if off else color,
                    width=3,
                )
            # 标签画在框内左上角（不够高时画到框上方）。
            tx, ty = px[0] + 6, max(0, px[1] - 6)
            draw.text((tx + 1, ty + 1), label, font=font, fill=(0, 0, 0))
            draw.text((tx, ty), label, font=font, fill=color)
    im.save(out_path, "JPEG", quality=88)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    annotations_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(annotations_path.read_text(encoding="utf-8"))
    fixture_dir = annotations_path.parent
    for entry in data["images"]:
        image_path = fixture_dir / entry["image"]
        if not image_path.exists():
            print(f"skip (missing): {image_path}")
            continue
        # 用 basename 作输出名，避免 ../ 上层引用把 .. 带进输出/上传路径。
        out_path = out_dir / f"{image_path.name}.overlay.jpg"
        render_image(image_path, entry["targets"], out_path)
        print(f"{out_path}  ({len(entry['targets'])} targets)")


if __name__ == "__main__":
    main()
