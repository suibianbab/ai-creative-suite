"""M3 open-vocabulary part grounding service (grounding cascade level 3).

Loopback-only development service, same shape as local_mask_provider.py:
the PhotoCraft dev bridge is its only caller. Given an image and a Chinese
noun phrase (屋顶 / 花瓣 / 左耳 …), it returns ranked region candidates:

  SAM (vit_b quant ONNX, cached encoder) decodes a coarse point grid into
  individual region masks → dedupe by IoU → Chinese-CLIP (rn50) ranks each
  region crop against the phrase → top-K with softmax confidences, bounds,
  a conservative lasso outline (fallback), and the REAL pixel mask as
  mask_png_b64 the confirm path feeds into select.loadSelection
  (τ_auto rule lives with the caller).

Coordinate contract (C 项): bounds / outline / mask_png_b64 all live in the
response width×height space — the image after exif_transpose and LANCZOS
resize to longest edge ≤ 1024, never resized again. mask_png_b64 is a
base64-encoded strict 0/255 8-bit grayscale PNG (255 = selected) at exactly
that size; grounding-contract.mjs validates the IHDR dims, the bridge
re-validates against the PhotoCraft document before select.loadSelection,
and the consumer rescales with smoothing + a ≥128 threshold. outline stays
as the lasso fallback whenever the mask path is unavailable.

Box-constrained mode (D 项入口): optional X-Acs-Prompt-Box header carries
[ x1, y1, x2, y2 ] as fractions of the response width×height (EXIF is
already normalized on both sides, browser naturalWidth included). Instead
of the 8×8 grid the service then decodes box-prompt variants (box / box+
center / box+center+quad points / center point — same cached embedding,
same vit_b.quant model). Returned masks are clipped to the user box before
filtering, ranking, outline and PNG encoding. A box is a hard editing scope:
pixels outside it must never be changed. Same filters, dedupe, CLIP ranking, contract and
response shape as grid mode; used by the disambiguation entry
(方位词/多实例 → 用户点击/画框限定位置 → 重新圈选), never a default switch.

Exclude points (蒙版代数的交互形态, box mode only): optional
X-Acs-Exclude-Points header carries 1-4 [x,y] fraction pairs marking
regions the candidate wrongly includes (花蕊 inside 花瓣, 猫脸 inside 猫头).
Each becomes a SAM background-labeled point (label 0) appended to every
box-prompt variant, so the decoder pulls the mask away from the clicked
spot — boolean mask subtraction without a second segmentation pass. Only
valid together with a prompt box (422 otherwise); the box stays the hard
scope, exclusion is a soft signal the decoder weighs.

Ranking (重排序): X-Acs-Rank selects the candidate order — "clip" (default,
current behavior: Chinese-CLIP cosine only) or "ensemble" (z-scored
clip_score + sam_score, 0.7/0.3). CLIP alone ranks a correct mask low when
the crop is visually ambiguous (花朵 case: top-1 0.000 / best 0.986 box
IoU); SAM's own IoU score is an independent signal from the same decode.
Report-only experiments decide whether callers adopt ensemble; the default
order never changes silently. Each candidate now also exposes its
sam_score so evaluations can re-rank offline.

Never persists or modifies uploaded originals. Not a production upload API.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[2]
MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 25_000_000
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
PATH = "/v1/candidates"
GRID = 8  # 8×8 point grid → up to 64 single-point decodes per cached embedding
MIN_AREA_RATIO = 0.002
MAX_AREA_RATIO = 0.6
IOU_DEDUPE = 0.7
MAX_REGIONS_FOR_CLIP = 24
OUTLINE_BUDGET = 48


def iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


def _dedupe(regions: list[dict]) -> list[dict]:
    """IoU 贪心 NMS：SAM 分高者优先保留，输出 ≤MAX_REGIONS_FOR_CLIP。"""
    regions.sort(key=lambda item: item["sam_score"], reverse=True)
    kept: list[dict] = []
    for region in regions:
        if any(iou(region["mask"], other["mask"]) > IOU_DEDUPE for other in kept):
            continue
        kept.append(region)
        if len(kept) >= MAX_REGIONS_FOR_CLIP:
            break
    return kept


def _clip_mask_to_box(mask: np.ndarray, box: list[float]) -> np.ndarray:
    """Keep only pixels inside the user-drawn normalized box."""
    height, width = mask.shape
    x1, y1, x2, y2 = box
    left = max(0, min(width, round(x1 * width)))
    right = max(left, min(width, round(x2 * width)))
    top = max(0, min(height, round(y1 * height)))
    bottom = max(top, min(height, round(y2 * height)))
    clipped = np.zeros_like(mask, dtype=bool)
    clipped[top:bottom, left:right] = mask[top:bottom, left:right]
    return clipped


def _box_spill_ratio(mask: np.ndarray, clipped: np.ndarray) -> float:
    """Reject a whole-object proposal that a small part box merely chops off."""
    total = int(mask.sum())
    return (total - int(clipped.sum())) / total if total else 1.0


MAX_EXCLUDE_POINTS = 4
RANK_MODES = ("clip", "ensemble")
ENSEMBLE_CLIP_WEIGHT = 0.7


def parse_exclude_points(raw_header: str) -> tuple[list[list[float]] | None, str]:
    """X-Acs-Exclude-Points 头解析（box 模式专用）。

    返回 (points, None) 或 (None, 错误消息)：1-4 个 [x,y]（0..1 归一化，
    响应 width/height 空间）。格式可疑一律报错，不静默忽略——用户点了
    「剔除这块」却照旧返回含它的候选，比报错更糟。
    """
    if not raw_header:
        return [], ""
    try:
        raw = json.loads(raw_header)
    except ValueError:
        return None, "X-Acs-Exclude-Points must be JSON [[x,y], …]"
    if not isinstance(raw, list) or not (1 <= len(raw) <= MAX_EXCLUDE_POINTS):
        return (
            None,
            f"X-Acs-Exclude-Points must be 1-{MAX_EXCLUDE_POINTS} [x,y] pairs",
        )
    for item in raw:
        if (
            not isinstance(item, list)
            or len(item) != 2
            or not all(isinstance(v, (int, float)) for v in item)
            or not (0.0 <= float(item[0]) <= 1.0 and 0.0 <= float(item[1]) <= 1.0)
        ):
            return None, "X-Acs-Exclude-Points entries must be [x, y] in [0, 1]"
    return [[float(x), float(y)] for x, y in raw], ""


def box_prompt_variants(
    box_px: tuple[int, int, int, int],
    exclude_points_px: list[tuple[float, float]],
) -> list[list[dict]]:
    """box 提示变体（D 项 + 剔除点）：框 / 框+中心 / 框+中心+四分点 / 中心，
    每个变体再附加全部负点（SAM label 0 = 背景，见 get_input_points 直通）。
    纯函数供单测钉住提示结构——这是蒙版代数「候选 − 误选区域」的服务端形态。"""
    px1, py1, px2, py2 = box_px
    rect = {"type": "rectangle", "data": [px1, py1, px2, py2]}
    cx, cy = round((px1 + px2) / 2), round((py1 + py2) / 2)
    center = {"type": "point", "label": 1, "data": [cx, cy]}
    qx1 = round(px1 + (px2 - px1) * 0.25)
    qx2 = round(px1 + (px2 - px1) * 0.75)
    qy1 = round(py1 + (py2 - py1) * 0.25)
    qy2 = round(py1 + (py2 - py1) * 0.75)
    quad = [
        {"type": "point", "label": 1, "data": [qx, qy]}
        for qx, qy in ((qx1, qy1), (qx2, qy1), (qx1, qy2), (qx2, qy2))
    ]
    variants = [[rect], [rect, center], [rect, center, *quad], [center]]
    negatives = [
        {"type": "point", "label": 0, "data": [round(x), round(y)]}
        for x, y in exclude_points_px
    ]
    if negatives:
        variants = [variant + negatives for variant in variants]
    return variants


def clamp01(value: float) -> float:
    """SAM decoder 的 iou 预测头输出名义上在 [0,1]，但量化后实测会轻微越界
    （帽顶网格点候选 1.0055）；NaN 时比较门（score < 0.6）恒 False 会放行。
    契约把 sam_score 钉死在 [0,1] 内有限数——在唯一出口 _decode_prompt 夹紧。"""
    if math.isnan(value):
        return 0.0
    return min(max(value, 0.0), 1.0)


def ensemble_order_key(clip_z: float, sam_z: float) -> float:
    """ensemble 排序键 = 0.7·z(clip) + 0.3·z(sam)（z 分数按本批候选算，
    纯函数独立可测；单候选批次 z=0，退化为 clip 顺序）。"""
    return ENSEMBLE_CLIP_WEIGHT * clip_z + (1.0 - ENSEMBLE_CLIP_WEIGHT) * sam_z


def _z_scores(values: list[float]) -> list[float]:
    if not values:
        return []
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = variance**0.5
    if std < 1e-9:
        return [0.0 for _ in values]
    return [(v - mean) / std for v in values]


def rank_regions(regions: list[dict], rank_mode: str) -> list[dict]:
    """候选排序：clip = 现行为（CLIP 余弦降序，原位排序）；ensemble = z 归一
    后 0.7·clip + 0.3·sam（显式配对列表，不给排序键塞 index 反模式）。排序
    不改变区域内容，只决定环上顺序与 top-k 截断。"""
    if rank_mode not in RANK_MODES:
        raise ValueError(f"unknown rank mode: {rank_mode}")
    if rank_mode == "clip":
        regions.sort(key=lambda item: item["clip_score"], reverse=True)
        return regions
    clip_z = _z_scores([item["clip_score"] for item in regions])
    sam_z = _z_scores([item["sam_score"] for item in regions])
    pairs = sorted(
        zip(clip_z, sam_z, regions),
        key=lambda pair: -ensemble_order_key(pair[0], pair[1]),
    )
    return [region for _, _, region in pairs]


def _decode_prompt(session, embeddings, transform, original_size, prompts):
    """单次 decoder 提示解码（网格点与 box 提示共用；draft-grounding-masks.py
    同机制）：返回 (bool 蒙版[原图分辨率], SAM 分数)。decoder 输出 logits，
    >0 才是选中。"""
    from rembg.sessions.sam import apply_coords, get_input_points, transform_masks

    input_size = (684, 1024)
    target_size = 1024
    input_points, input_labels = get_input_points(prompts)
    coords = np.concatenate([input_points, np.array([[0.0, 0.0]])], axis=0)[None, :, :]
    labels = np.concatenate([input_labels, np.array([-1])], axis=0)[None, :].astype(np.float32)
    coords = apply_coords(coords, input_size, target_size).astype(np.float32)
    coords = np.concatenate([coords, np.ones((1, coords.shape[1], 1), dtype=np.float32)], axis=2)
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
    best = int(np.argmax(outputs[1][0]))
    score = float(outputs[1][0][best])
    # transform_masks 返回 (1, N, H, W)：批 0 的第 best 张蒙版。
    batch = masks[0]
    raw = batch[best] if best < len(batch) else batch[0]
    return raw > 0, clamp01(score)


def comb_outline(mask: np.ndarray, budget: int = OUTLINE_BUDGET) -> list[list[int]]:
    """Conservative enclosing polygon: left edge top→bottom, right edge back up.

    Keeps the mask shape (unlike a plain bbox) while staying a valid lasso
    polygon; points thinned to the budget. The ring + mask brush refine it.
    """
    height, width = mask.shape
    rows = np.any(mask, axis=1)
    if not rows.any():
        return []
    top = int(np.argmax(rows))
    bottom = height - int(np.argmax(rows[::-1])) - 1
    step = max(1, (bottom - top + 1) // max(1, budget // 2))
    left_side: list[list[int]] = []
    right_side: list[list[int]] = []
    for y in range(top, bottom + 1, step):
        row = mask[y]
        cols = np.flatnonzero(row)
        if cols.size == 0:
            continue
        left_side.append([int(cols[0]), int(y)])
        right_side.append([int(cols[-1]), int(y)])
    outline = left_side + right_side[::-1]
    return outline if len(outline) >= 3 else []


def mask_png_b64(mask: np.ndarray) -> str:
    """候选真实像素蒙版（C 项）：bool → 0/255 灰度 PNG → base64。

    坐标系 = 返回图（exif 转置后、最长边 ≤1024 LANCZOS），与
    bounds/outline 同空间；grounding-contract.mjs 校验 IHDR 尺寸一致，
    桥端再与 PhotoCraft 文档尺寸强校验后走 select.loadSelection。
    """
    buffer = io.BytesIO()
    Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L").save(
        buffer, format="PNG"
    )
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class CandidateHandler(BaseHTTPRequestHandler):
    sam_session = None
    clip_model = None
    clip_processor = None
    clip_model_id = "OFA-Sys/chinese-clip-vit-base-patch16"
    model_limit = 1024
    top_k = 3
    infer_lock = threading.Lock()
    protocol_version = "HTTP/1.1"

    def _origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            self.send_error(403, "Origin is not allowed")
            return None
        return origin or ""

    def _headers(self, status: int, content_type: str, length: int, origin: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

    def _error(self, status: int, message: str, origin: str) -> None:
        body = message.encode("utf-8")
        self._headers(status, "text/plain; charset=utf-8", len(body), origin)
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        origin = self._origin()
        if origin is None:
            return
        if self.path != PATH:
            self._error(404, "Not found", origin)
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Acs-Phrase-B64, X-Acs-Prompt-Box, "
                "X-Acs-Exclude-Points, X-Acs-Rank",
            )
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        origin = self._origin()
        if origin is None:
            return
        if self.path != "/health":
            self._error(404, "Not found", origin)
            return
        body = "ready parts-candidates sam=vit_b.quant clip=chinese-clip-vit-b16\n".encode()
        self._headers(200, "text/plain; charset=utf-8", len(body), origin)
        self.wfile.write(body)

    def _embed(self, image: Image.Image):
        """encoder 一次（网格 64 点与 box 变体共用同一 embedding）。"""
        from rembg.sessions.sam import warp_affine

        session = self.sam_session
        input_size = (684, 1024)
        rgb = np.asarray(image.convert("RGB"))
        original_size = rgb.shape[:2]
        scale = min(input_size[1] / original_size[1], input_size[0] / original_size[0])
        transform = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]])
        model_image = warp_affine(rgb, transform[:2], input_size).astype(np.float32)
        embeddings = session.encoder.run(
            None, {session.encoder.get_inputs()[0].name: model_image}
        )[0]
        return session, embeddings, transform, original_size

    def _sam_regions(self, image: Image.Image) -> list[dict]:
        session, embeddings, transform, original_size = self._embed(image)
        height, width = image.height, image.width
        regions: list[dict] = []
        for gy in range(1, GRID + 1):
            for gx in range(1, GRID + 1):
                x = int(width * gx / (GRID + 1))
                y = int(height * gy / (GRID + 1))
                prompts = [{"type": "point", "label": 1, "data": [x, y]}]
                mask, score = _decode_prompt(
                    session, embeddings, transform, original_size, prompts
                )
                area_ratio = float(mask.sum()) / (width * height)
                if score < 0.6 or not (MIN_AREA_RATIO <= area_ratio <= MAX_AREA_RATIO):
                    continue
                regions.append({"mask": mask, "sam_score": score, "area_ratio": area_ratio})
        return _dedupe(regions)

    def _box_regions(
        self,
        image: Image.Image,
        box: list[float],
        exclude_points: list[list[float]] | None = None,
    ) -> list[dict]:
        """D 项入口：用户点击/画框限定后的 box 提示候选（同模型同契约）。

        变体来自 GT 起草（draft-grounding-masks.py）的两条实测结论：纯点提示
        在蓬毛/复杂纹理上退化成大团块，纯框提示只抓框内最显著核——框+中心、
        框+多点组合能把 SAM 拉满目标整体。剔除点（蒙版代数：候选 − 误选区域）
        以 SAM 负点（label 0）附加到每个变体，decoder 直接把蒙版从误选处拉开。
        所有变体先裁到用户画框内，再送 CLIP 排序，环上由用户确认，不在此默默
        选边。画框是编辑范围硬边界。
        """
        session, embeddings, transform, original_size = self._embed(image)
        height, width = image.height, image.width
        x1, y1, x2, y2 = box
        px1, py1 = round(x1 * width), round(y1 * height)
        px2, py2 = round(x2 * width), round(y2 * height)
        exclude_px = [
            (x * width, y * height) for x, y in (exclude_points or [])
        ]
        variants = box_prompt_variants((px1, py1, px2, py2), exclude_px)
        regions: list[dict] = []
        for prompts in variants:
            mask, score = _decode_prompt(
                session, embeddings, transform, original_size, prompts
            )
            clipped = _clip_mask_to_box(mask, box)
            # A clipped cat head still looks like a rectangular ear selection.
            # Do not offer it as a candidate for direct confirmation; the user
            # should use PhotoCraft's manual outline/mask refinement instead.
            if _box_spill_ratio(mask, clipped) > 0.25:
                continue
            mask = clipped
            area_ratio = float(mask.sum()) / (width * height)
            if score < 0.6 or not (MIN_AREA_RATIO <= area_ratio <= MAX_AREA_RATIO):
                continue
            regions.append({"mask": mask, "sam_score": score, "area_ratio": area_ratio})
        return _dedupe(regions)

    def _clip_rank(
        self, image: Image.Image, regions: list[dict], phrase: str
    ) -> list[dict]:
        import torch

        if self.clip_model is None or self.clip_processor is None:
            # 延迟加载：SAM 网格完成（其大块临时内存已释放）后再进驻 CLIP
            # 权重，降低同驻峰值内存。
            from transformers import ChineseCLIPModel, ChineseCLIPProcessor

            self.clip_model = ChineseCLIPModel.from_pretrained(self.clip_model_id)
            self.clip_processor = ChineseCLIPProcessor.from_pretrained(
                self.clip_model_id
            )

        crops: list[Image.Image] = []
        for region in regions:
            mask = region["mask"]
            rows = np.any(mask, axis=1)
            cols = np.any(mask, axis=0)
            y0, y1 = int(np.argmax(rows)), mask.shape[0] - int(np.argmax(rows[::-1]))
            x0, x1 = int(np.argmax(cols)), mask.shape[1] - int(np.argmax(cols[::-1]))
            if x1 - x0 < 8 or y1 - y0 < 8:
                region["clip_score"] = 0.0
                crops.append(Image.new("RGB", (224, 224)))
                continue
            crop = image.crop((x0, y0, x1, y1))
            # Zero the background inside the bbox so CLIP sees the region, not
            # its neighborhood (standard zero-shot region matching practice).
            local = np.asarray(crop.convert("RGB")).copy()
            local[~mask[y0:y1, x0:x1]] = 255
            crops.append(Image.fromarray(local))
        inputs = self.clip_processor(
            text=[f"一张{phrase}的照片", f"一张照片"], images=crops, return_tensors="pt", padding=True
        )
        with torch.no_grad():
            outputs = self.clip_model(**inputs)
            # Normalized embeds → cosine similarity per region against the
            # phrase text (column 0); softmax over regions becomes confidence.
            image_feats = outputs.image_embeds
            text_feats = outputs.text_embeds
            image_feats = image_feats / image_feats.norm(dim=-1, keepdim=True)
            text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)
            sims = (image_feats @ text_feats.T)[:, 0].tolist()
        for region, score in zip(regions, sims):
            region["clip_score"] = float(score)
        return regions

    def do_POST(self) -> None:
        origin = self._origin()
        if origin is None:
            return
        if self.path != PATH:
            self._error(404, "Not found", origin)
            return
        mime_type = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if mime_type not in ALLOWED_TYPES:
            self._error(415, "PNG, JPEG or WebP required", origin)
            return
        phrase_b64 = self.headers.get("X-Acs-Phrase-B64", "")
        try:
            phrase = base64.b64decode(phrase_b64).decode("utf-8").strip()
        except (ValueError, UnicodeDecodeError):
            phrase = ""
        if not phrase or len(phrase) > 40:
            self._error(422, "X-Acs-Phrase-B64 must decode to a 1-40 char phrase", origin)
            return
        # D 项入口：可选画框限定（归一化 [x1,y1,x2,y2]，响应 width/height 空间；
        # EXIF 两侧已归一，浏览器 naturalWidth 同口径）。格式可疑一律 422，
        # 不静默退回网格模式——入口限定与无限定是不同的候选语义。
        box: list[float] | None = None
        box_header = self.headers.get("X-Acs-Prompt-Box", "")
        if box_header:
            try:
                raw_box = json.loads(box_header)
            except ValueError:
                raw_box = None
            if (
                not isinstance(raw_box, list)
                or len(raw_box) != 4
                or not all(isinstance(v, (int, float)) for v in raw_box)
            ):
                self._error(
                    422,
                    "X-Acs-Prompt-Box must be JSON [x1, y1, x2, y2] in [0, 1]",
                    origin,
                )
                return
            x1, y1, x2, y2 = (float(v) for v in raw_box)
            if not (
                0.0 <= x1 < x2 <= 1.0
                and 0.0 <= y1 < y2 <= 1.0
                and x2 - x1 >= 0.02
                and y2 - y1 >= 0.02
            ):
                self._error(422, "X-Acs-Prompt-Box too small or out of range", origin)
                return
            box = [x1, y1, x2, y2]
        # 剔除点（蒙版代数交互）：仅在画框限定模式下有意义——无框网格候选
        # 本来就未承诺避开任何区域，带点请求是无意义的组合，422 而非忽略。
        exclude_header = self.headers.get("X-Acs-Exclude-Points", "")
        if exclude_header and not box:
            self._error(
                422,
                "X-Acs-Exclude-Points requires X-Acs-Prompt-Box (box mode only)",
                origin,
            )
            return
        exclude_points, exclude_error = parse_exclude_points(exclude_header)
        if exclude_points is None:
            self._error(422, exclude_error, origin)
            return
        # 重排序：clip = 现行为默认；ensemble = 0.7·z(clip)+0.3·z(sam)。
        # 未知值 422，不静默退回 clip——评测与生产都要知道自己用的哪种序。
        rank_mode = self.headers.get("X-Acs-Rank", "") or "clip"
        if rank_mode not in RANK_MODES:
            self._error(422, f"X-Acs-Rank must be one of {RANK_MODES}", origin)
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._error(411, "Content-Length required", origin)
            return
        if length < 1 or length > MAX_BYTES:
            self._error(413, "Image exceeds 25 MB limit", origin)
            return
        if not self.infer_lock.acquire(blocking=False):
            self._error(429, "Parts candidate service is busy; retry shortly", origin)
            return
        started = time.time()
        try:
            self.connection.settimeout(120)
            source = self.rfile.read(length)
            try:
                with Image.open(io.BytesIO(source)) as decoded:
                    if decoded.width * decoded.height > MAX_PIXELS:
                        self._error(413, "Image exceeds 25 megapixel limit", origin)
                        return
                    image = ImageOps.exif_transpose(decoded).convert("RGB")
            except (UnidentifiedImageError, OSError, ValueError):
                self._error(422, "Image could not be decoded", origin)
                return
            # SAM runs at model limit; CLIP crops come from the same scale.
            scale = min(1.0, self.model_limit / max(image.size))
            if scale < 1.0:
                image = image.resize(
                    (round(image.width * scale), round(image.height * scale)),
                    Image.Resampling.LANCZOS,
                )
            regions = (
                self._box_regions(image, box, exclude_points)
                if box
                else self._sam_regions(image)
            )
            if not regions:
                # 契约：正常与 no-regions 响应都带有限正数的 width/height
                # （grounding-eval 严格校验按同一契约执行；浏览器端
                # findPartCandidates 也依赖这两个字段换算坐标）。
                body = json.dumps(
                    {
                        "candidates": [],
                        "reason": "no-regions",
                        "width": image.width,
                        "height": image.height,
                        "took_ms": round((time.time() - started) * 1000),
                    }
                ).encode("utf-8")
                self._headers(200, "application/json", len(body), origin)
                self.wfile.write(body)
                return
            ranked = rank_regions(
                self._clip_rank(image, regions, phrase), rank_mode
            )[: self.top_k]
            scores = [region["clip_score"] for region in ranked]
            peak = max(abs(s) for s in scores) or 1.0
            exps = [math.exp(s / peak * 8) for s in scores]
            total = sum(exps) or 1.0
            candidates = []
            for index, region in enumerate(ranked):
                mask = region["mask"]
                rows = np.any(mask, axis=1)
                cols = np.any(mask, axis=0)
                y0 = int(np.argmax(rows))
                y1 = mask.shape[0] - int(np.argmax(rows[::-1]))
                x0 = int(np.argmax(cols))
                x1 = mask.shape[1] - int(np.argmax(cols[::-1]))
                outline = comb_outline(mask)
                candidates.append(
                    {
                        "index": index + 1,
                        "score": round(exps[index] / total, 4),
                        "clip_score": round(region["clip_score"], 4),
                        # 重排序证据链：SAM 自身 IoU 分随候选透出，评测端可离线
                        # 复算 clip/ensemble 两种序（X-Acs-Rank 只改服务端排序）。
                        "sam_score": round(region["sam_score"], 4),
                        "bounds": [x0, y0, x1 - x0, y1 - y0],
                        "outline": outline,
                        "mask_png_b64": mask_png_b64(mask),
                        "area_ratio": round(region["area_ratio"], 4),
                    }
                )
            body = json.dumps(
                {
                    "phrase": phrase,
                    "width": image.width,
                    "height": image.height,
                    "candidates": candidates,
                    "rank": rank_mode,
                    "took_ms": round((time.time() - started) * 1000),
                }
            ).encode("utf-8")
            self._headers(200, "application/json", len(body), origin)
            self.wfile.write(body)
        except TimeoutError:
            self._error(408, "Image upload timed out", origin)
        except Exception as error:  # noqa: BLE001 - dev service, log and 500
            import traceback

            self.log_error(
                "Candidates inference failed: %s\n%s", error, traceback.format_exc()
            )
            self._error(500, "Parts candidate inference failed", origin)
        finally:
            self.infer_lock.release()

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


def main() -> None:
    global GRID
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4104)
    parser.add_argument("--grid", type=int, default=GRID)
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--max-model-size", type=int, default=1024)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    os.environ.setdefault("REMBG_HOME", str((ROOT / ".tools/rembg-models").resolve()))
    os.environ.setdefault("HF_HUB_CACHE", str((ROOT / ".tools/hf-cache").resolve()))
    # 模型已在本地缓存；离线模式避免 huggingface.co 网络抖动拖慢/阻断启动。
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    GRID = args.grid
    import onnxruntime as ort
    from rembg import new_session

    # 关闭 ORT 内存竞技场/执行模式缓存：SAM encoder 的临时大块分配在低空闲
    # 内存机器上更稳（首次请求会稍慢，可接受——本服务单飞推理）。
    sess_opts = ort.SessionOptions()
    sess_opts.enable_cpu_mem_arena = False
    sess_opts.enable_mem_pattern = False
    CandidateHandler.sam_session = new_session(
        "sam", sam_quant=True, sess_opts=sess_opts
    )
    # CLIP 延迟到首个请求加载（见 _clip_rank），启动即就绪。
    CandidateHandler.model_limit = args.max_model_size
    CandidateHandler.top_k = args.top_k
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CandidateHandler)
    print(
        f"Parts candidates listening on http://127.0.0.1:{args.port} "
        f"(grid={args.grid}×{args.grid}, top-k={args.top_k})",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
