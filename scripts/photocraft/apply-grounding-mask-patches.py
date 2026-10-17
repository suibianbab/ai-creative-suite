# -*- coding: utf-8 -*-
"""把归一化坐标的修正笔刷应用到草稿蒙版，产出终稿（严格 0/255）。

用法（仓库根目录，任意 python 均可，无第三方依赖）：
  python scripts/photocraft/apply-grounding-mask-patches.py \
      .tools/photocraft-grounding-work/masks-draft/<image>/<phrase>.png \
      .tools/photocraft-grounding-work/patches/<image>/<phrase>.json \
      qa/fixtures/photocraft-grounding/masks/<image>/<phrase>.png

patch JSON（坐标全部归一化 [0,1]，分辨率无关，复核阶段读叠加图即可手写）：
  {"ops": [
    {"mode": "add"|"remove", "shape": "rect"|"ellipse",
     "x": 0.10, "y": 0.20, "w": 0.30, "h": 0.15}
  ]}

add=涂白（纳入选区）、remove=涂黑（剔除）。输出前会校验草稿与标注分辨率
一致（--size WxH 可选显式声明），并断言输出非全空。人工笔刷修正的记录
（复核结论、每条 op 的依据）随 manifest.json 一并归档。
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    draft_path = Path(sys.argv[1])
    patches_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    ops = json.loads(patches_path.read_text(encoding="utf-8")).get("ops", [])
    if not ops:
        print("no ops; nothing to do", file=sys.stderr)
        sys.exit(1)
    mask = Image.open(draft_path).convert("L")
    w, h = mask.size
    for op in ops:
        if op.get("mode") not in ("add", "remove") or op.get("shape") not in (
            "rect",
            "ellipse",
        ):
            print(f"bad op: {op}", file=sys.stderr)
            sys.exit(1)
        value = 255 if op["mode"] == "add" else 0
        box = [
            round(op["x"] * w),
            round(op["y"] * h),
            round((op["x"] + op["w"]) * w),
            round((op["y"] + op["h"]) * h),
        ]
        draw = ImageDraw.Draw(mask)
        if op["shape"] == "rect":
            draw.rectangle(box, fill=value)
        else:
            draw.ellipse(box, fill=value)
    binary = mask.point(lambda p: 255 if p >= 128 else 0, mode="L")
    if binary.getextrema()[0] == 255:  # 全黑 = 空蒙版
        print("patched mask is empty; refusing", file=sys.stderr)
        sys.exit(1)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    binary.save(out_path)
    hist = binary.histogram()
    print(
        f"patched {draft_path.name}: {len(ops)} ops -> {out_path} "
        f"(white={hist[255]}, black={hist[0]})"
    )


if __name__ == "__main__":
    main()
