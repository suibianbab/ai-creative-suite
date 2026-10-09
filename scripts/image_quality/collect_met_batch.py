"""Freeze a 20-image public-domain proxy batch with source hashes.

The first five cases come from the earlier baseline. The added Met object IDs
are intentionally fixed so subsequent runs do not silently change the set.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
from pathlib import Path

import requests
from PIL import Image


ROOT = Path("artifacts/image-quality-batch-2026-10-09")
BASELINE = Path("artifacts/image-quality-spike-2026-10-09")
ADDITIONS = [
    ("wood-chair", 229),
    ("jewelled-brooch", 1025),
    ("brass-clock", 1454),
    ("frosted-glass-lamp", 4706),
    ("painted-metal-lamp", 4699),
    ("pressed-glass-lamp", 4722),
    ("figured-glass-bottle", 3692),
    ("ceramic-bottle", 646),
    ("gold-necklace", 446753),
    ("woven-handbag", 62209),
    ("steel-helmet", 34339),
    ("ceramic-plate", 326385),
    ("earthenware-plate", 468520),
    ("silk-textile", 450741),
    ("garnet-brooch", 20519),
]


def main() -> None:
    originals = ROOT / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    frozen_manifest = ROOT / "manifest.json"
    if frozen_manifest.exists():
        frozen = json.loads(frozen_manifest.read_text(encoding="utf-8"))
        if len(frozen.get("cases", [])) != 20:
            raise ValueError("Existing batch manifest is incomplete; inspect it before retrying")
        for case in frozen["cases"]:
            source = originals / case["filename"]
            if not source.exists() or hashlib.sha256(source.read_bytes()).hexdigest() != case["sha256"]:
                raise ValueError(f"Frozen source missing or changed: {source}")
        print("Frozen 20-image manifest and original hashes verified; no sources changed")
        return
    baseline = json.loads((BASELINE / "manifest.json").read_text(encoding="utf-8"))
    cases = []
    for case in baseline["cases"]:
        source = BASELINE / "originals" / case["filename"]
        dest = originals / case["filename"]
        if not dest.exists():
            shutil.copyfile(source, dest)
        if hashlib.sha256(dest.read_bytes()).hexdigest() != case["sha256"]:
            raise ValueError(f"Baseline source mismatch: {dest}")
        cases.append(case)

    http = requests.Session()
    for label, object_id in ADDITIONS:
        record_url = f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}"
        record = http.get(record_url, timeout=30).json()
        if record.get("objectID") != object_id or not record.get("isPublicDomain") or not record.get("primaryImage"):
            raise ValueError(f"Public-domain primary image unavailable: {object_id}")
        filename = f"{label}-{object_id}.jpg"
        dest = originals / filename
        if dest.exists():
            raw = dest.read_bytes()
        else:
            response = http.get(record["primaryImage"], timeout=60)
            response.raise_for_status()
            raw = response.content
            if len(raw) > 20_000_000:
                raise ValueError(f"Source exceeds 20 MB: {object_id}")
            dest.write_bytes(raw)
        with Image.open(io.BytesIO(raw)) as image:
            size = image.size
        case = {
            "case": label,
            "object_id": object_id,
            "title": record["title"],
            "object_url": record.get("objectURL") or f"https://www.metmuseum.org/art/collection/search/{object_id}",
            "source_url": record["primaryImage"],
            "is_public_domain": True,
            "credit_line": record.get("creditLine", ""),
            "medium": record.get("medium", ""),
            "filename": filename,
            "width": size[0],
            "height": size[1],
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        cases.append(case)
        print(f"{len(cases):02d} {label} {object_id} {size[0]}x{size[1]}", flush=True)
    if len(cases) != 20:
        raise AssertionError("Expected exactly 20 cases")
    manifest = {
        "source": "The Met Open Access Collection API",
        "license_basis": "Each object record returned isPublicDomain=true and a primaryImage URL; verify object pages before publication",
        "purpose": "Proxy segmentation exception review; not a modern ecommerce acceptance set",
        "cases": cases,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
