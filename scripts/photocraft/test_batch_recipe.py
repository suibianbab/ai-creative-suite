"""Verify the native `batch --actions` leg of the M4 批量配方 line (方案 §12.3).

The cloud pipeline enqueues one batch-recipe job per project and flattens it to
the same whole-image commands; this script pins the native engine leg those
jobs rely on: one action list applied to a directory must change every output,
leave every original untouched, refuse to write into the input folder, and
accept all three recorded step encodings ([id, params], {command, params},
bare id).
"""

from json import dumps
from pathlib import Path
from shutil import copyfile
from subprocess import run
import sys

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "qa/fixtures/photocraft-hat-teal.png"
CLI = ROOT / ".tools/photocraft-0.6.0/desktop/photocraft-0.6.0-windows-x64-portable/photocraft-cli.exe"
OUT = ROOT / ".tools/photocraft-batch-qa"

# 与 apps/api 的 PHOTOCRAFT_BATCH_STEP_OPERATIONS 对应的整图配方：
# 先调效果，最后动画布（画布操作必须在最后一步）。
ACTIONS = [
    ["layer.newAdjustmentLayer.brightnessContrast", {"brightness": 12}],
    {"command": "image.imageRotation.flipCanvasHorizontal", "params": {}},
    "image.imageRotation.90cw",
]


def mean_luminance(image: Image.Image) -> float:
    gray = image.convert("L")
    histogram = gray.histogram()
    total = sum(histogram)
    return sum(index * count for index, count in enumerate(histogram)) / total


def main() -> None:
    if not CLI.exists():
        print(f"SKIP: pinned PhotoCraft CLI not found at {CLI}")
        return
    work = OUT / "run"
    inbox = work / "in"
    outbox = work / "out"
    inbox.mkdir(parents=True, exist_ok=True)
    outbox.mkdir(parents=True, exist_ok=True)
    for stale in outbox.iterdir():
        stale.unlink()

    names = ["hat-a.png", "hat-b.png", "hat-c.png"]
    originals = {}
    for name in names:
        target = inbox / name
        copyfile(SOURCE, target)
        originals[name] = target.read_bytes()
    actions_path = work / "actions.json"
    actions_path.write_text(dumps(ACTIONS), encoding="utf-8")

    # 1. 输出目录等于输入目录必须被拒绝（保护原始 Asset 的硬约束）。
    refused = run(
        [str(CLI), "batch", "--actions", str(actions_path),
         "--in", str(inbox), "--out", str(inbox)],
        capture_output=True, text=True, timeout=600,
    )
    assert refused.returncode != 0, "batch accepted --out == --in"
    assert "in-place" in (refused.stderr + refused.stdout), refused.stderr + refused.stdout

    # 2. 正常批量：目录内每张图都套用同一动作列表。
    completed = run(
        [str(CLI), "batch", "--actions", str(actions_path),
         "--in", str(inbox), "--out", str(outbox)],
        capture_output=True, text=True, timeout=600,
    )
    assert completed.returncode == 0, completed.stderr[-2000:]

    source_image = Image.open(SOURCE).convert("RGB")
    for name in names:
        produced = outbox / name
        assert produced.exists(), f"missing batch output {name}"
        # 原图字节级不动。
        assert (inbox / name).read_bytes() == originals[name], f"original {name} was modified"

        output = Image.open(produced).convert("RGB")
        # 配方语义逐条验证：翻转 + 顺时针旋转 = 镜像后再转 90°（宽高互换）。
        expected_geometry = ImageOps.mirror(source_image).transpose(Image.ROTATE_270)
        assert output.size == expected_geometry.size, (output.size, expected_geometry.size)
        # brightness +12 必须真实生效：输出比同几何变换的基准更亮。
        margin = mean_luminance(expected_geometry)
        assert mean_luminance(output) > margin + 1, (
            name, mean_luminance(output), margin,
        )

    print("PASS: native batch applies a shared action list directory-wide, "
          "keeps originals immutable, refuses in-place output, and accepts all step encodings")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
