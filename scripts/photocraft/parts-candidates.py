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
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Acs-Phrase-B64")
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

    def _sam_regions(self, image: Image.Image) -> list[dict]:
        from rembg.sessions.sam import apply_coords, get_input_points, transform_masks, warp_affine

        session = self.sam_session
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

        height, width = image.height, image.width
        regions: list[dict] = []
        for gy in range(1, GRID + 1):
            for gx in range(1, GRID + 1):
                x = int(width * gx / (GRID + 1))
                y = int(height * gy / (GRID + 1))
                prompts = [{"type": "point", "label": 1, "data": [x, y]}]
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
                mask = raw > 0
                area_ratio = float(mask.sum()) / (width * height)
                if score < 0.6 or not (MIN_AREA_RATIO <= area_ratio <= MAX_AREA_RATIO):
                    continue
                regions.append({"mask": mask, "sam_score": score, "area_ratio": area_ratio})
        # Dedupe by IoU, keep the higher-SAM-score survivor (greedy NMS).
        regions.sort(key=lambda item: item["sam_score"], reverse=True)
        kept: list[dict] = []
        for region in regions:
            if any(iou(region["mask"], other["mask"]) > IOU_DEDUPE for other in kept):
                continue
            kept.append(region)
            if len(kept) >= MAX_REGIONS_FOR_CLIP:
                break
        return kept

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
        regions.sort(key=lambda item: item["clip_score"], reverse=True)
        return regions[: self.top_k]

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
            regions = self._sam_regions(image)
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
            ranked = self._clip_rank(image, regions, phrase)
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
