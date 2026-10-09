"""Fetch a pinned Poly Haven model and its Blender texture dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen


USER_AGENT = "AI-Creative-Suite-QualitySpike/0.1"


def read_url(url: str) -> bytes:
    if not url.startswith(("https://api.polyhaven.com/", "https://dl.polyhaven.org/")):
        raise ValueError(f"Unexpected download host: {url}")
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=90) as response:
        return response.read()


def fetch_file(url: str, destination: Path, expected_md5: str) -> dict:
    data = read_url(url)
    actual_md5 = hashlib.md5(data, usedforsecurity=False).hexdigest()
    if actual_md5 != expected_md5:
        raise ValueError(f"MD5 mismatch: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return {
        "path": destination.name,
        "url": url,
        "bytes": len(data),
        "md5": actual_md5,
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", default="Camera_01")
    parser.add_argument("--resolution", default="2k", choices=("1k", "2k", "4k", "8k"))
    parser.add_argument("--dest", type=Path, required=True)
    args = parser.parse_args()

    root = args.dest.resolve()
    root.mkdir(parents=True, exist_ok=True)
    api_url = f"https://api.polyhaven.com/files/{args.asset_id}"
    listing = json.loads(read_url(api_url))
    chosen = listing["blend"][args.resolution]["blend"]
    blend_url = chosen["url"]
    blend_path = root / Path(blend_url).name
    records = []
    for relative, dependency in sorted(chosen["include"].items()):
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError(f"Unsafe asset path: {relative}")
        record = fetch_file(dependency["url"], target, dependency["md5"])
        record["path"] = relative.replace("\\", "/")
        records.append(record)
        print(f"Verified {relative}: {record['bytes']} bytes", flush=True)
    record = fetch_file(blend_url, blend_path, chosen["md5"])
    record["path"] = blend_path.name
    records.append(record)
    result = {
        "asset_id": args.asset_id,
        "resolution": args.resolution,
        "asset_page": f"https://polyhaven.com/a/{args.asset_id}",
        "api_url": api_url,
        "license": "CC0 per the Poly Haven asset page",
        "files": records,
    }
    (root / "source-manifest.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Saved {len(records)} verified files to {root}")


if __name__ == "__main__":
    main()
