"""Loopback-only development background-removal provider.

Returns a grayscale alpha mask. Never persists or modifies uploaded originals.
This is not a production upload API: it has no users, tenants, or job queue.
"""

from __future__ import annotations

import argparse
import io
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 25_000_000
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
PATH = "/v1/masks/remove-background"


class MaskHandler(BaseHTTPRequestHandler):
    session = None
    model_name = ""
    model_limit = 1600
    infer_lock = threading.Lock()

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
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        origin = self._origin()
        if origin is None:
            return
        if self.path != "/health":
            self._error(404, "Not found", origin)
            return
        body = f"ready model={self.model_name}\n".encode("utf-8")
        self._headers(200, "text/plain; charset=utf-8", len(body), origin)
        self.wfile.write(body)

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
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._error(411, "Content-Length required", origin)
            return
        if length < 1 or length > MAX_BYTES:
            self._error(413, "Image exceeds 25 MB limit", origin)
            return
        if not self.infer_lock.acquire(blocking=False):
            self._error(429, "Mask provider is busy; retry shortly", origin)
            return
        try:
            self.connection.settimeout(65)
            source = self.rfile.read(length)
            try:
                with Image.open(io.BytesIO(source)) as decoded:
                    width, height = decoded.size
                    if width * height > MAX_PIXELS:
                        self._error(413, "Image exceeds 25 megapixel limit", origin)
                        return
                    image = ImageOps.exif_transpose(decoded).convert("RGB")
            except (UnidentifiedImageError, OSError, ValueError):
                self._error(422, "Image could not be decoded", origin)
                return
            from rembg import remove

            scale = min(1.0, self.model_limit / max(image.size))
            model_size = (round(image.width * scale), round(image.height * scale))
            model_input = image.resize(model_size, Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            model_input.save(buffer, format="PNG")
            mask_bytes = remove(buffer.getvalue(), session=self.session, only_mask=True)
            mask = Image.open(io.BytesIO(mask_bytes)).convert("L")
            mask = mask.resize(image.size, Image.Resampling.LANCZOS)
            result = io.BytesIO()
            mask.save(result, format="PNG")
            body = result.getvalue()
            self._headers(200, "image/png", len(body), origin)
            self.wfile.write(body)
        except TimeoutError:
            self._error(408, "Image upload timed out", origin)
        except Exception as error:
            self.log_error("Inference failed: %s", error)
            self._error(500, "Mask inference failed", origin)
        finally:
            self.infer_lock.release()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4101)
    parser.add_argument("--model", default="birefnet-general-lite")
    parser.add_argument("--max-model-size", type=int, default=1600)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    if args.max_model_size < 256 or args.max_model_size > 4096:
        parser.error("max-model-size must be between 256 and 4096")
    os.environ["REMBG_HOME"] = str((Path(".tools") / "rembg-models").resolve())
    from rembg import new_session

    MaskHandler.session = new_session(args.model)
    MaskHandler.model_name = args.model
    MaskHandler.model_limit = args.max_model_size
    server = ThreadingHTTPServer(("127.0.0.1", args.port), MaskHandler)
    print(f"Local mask provider listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
