"""Local, source-bound visual QA workflow for image quality spikes.

Creates a review JSON and an offline HTML reviewer. Review notes and timers stay
in the browser until exported, then `validate`/`report` check them against the
unchanged source manifest. This tool never writes to original image files.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image


CATEGORIES = {
    "matte",
    "reflective_electronics",
    "fabric_hair",
    "transparent_packaging",
    "dense_text_logo",
}
CHECKS = (
    "silhouette_edges",
    "interior_holes",
    "transparency",
    "shape_color",
    "logo_text",
    "export_pixels",
    "branded_scene",
    "layouts",
)
ISSUES = (
    "edge_halo",
    "missing_subject",
    "background_remnant",
    "uncut_hole",
    "support_or_shadow",
    "transmission_wrong",
    "shape_changed",
    "color_changed",
    "text_logo_changed",
    "low_resolution",
    "export_wrong",
    "branded_scene_wrong",
    "layout_wrong",
)
TRIAGE = {"pending", "preview_pass", "correction", "fail"}
CHECK_VALUES = {"not_checked", "pass", "issue", "not_applicable"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def case_key(case: dict) -> str:
    return f"{case['case']}-{case['object_id']}" if "object_id" in case else case["case"]


def original_path(root: Path, case: dict) -> Path:
    label = case.get("case")
    filename = case.get("filename")
    if not isinstance(label, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}", label):
        raise ValueError(f"Unsafe case label: {label}")
    if not isinstance(filename, str) or Path(filename).name != filename:
        raise ValueError(f"Unsafe original filename: {filename}")
    return root / "originals" / filename


def ingest_manifest(root: Path) -> Path:
    target = root / "manifest.json"
    if target.exists():
        raise ValueError(f"Manifest already exists: {target}")
    intake = json.loads((root / "intake.json").read_text(encoding="utf-8"))
    cases = intake.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("intake.json needs cases")
    assembled = []
    for case in cases:
        if case.get("category") not in CATEGORIES:
            raise ValueError(f"Unknown category: {case.get('case')}")
        if case.get("rights_confirmed") is not True or not str(case.get("rights_basis", "")).strip():
            raise ValueError(f"Explicit rights confirmation and basis required: {case.get('case')}")
        source = original_path(root, case)
        if not source.is_file():
            raise ValueError(f"Original missing: {source}")
        with Image.open(source) as image:
            width, height = image.size
        assembled.append({
            **case,
            "width": width,
            "height": height,
            "bytes": source.stat().st_size,
            "sha256": digest(source),
        })
    if len({case["case"] for case in assembled}) != len(assembled):
        raise ValueError("Duplicate case labels")
    if CATEGORIES - {case["category"] for case in assembled}:
        raise ValueError("Intake needs all five required ecommerce categories")
    write_json(target, {"source": intake.get("source", "Ecommerce product originals"), "cases": assembled})
    return target


def load_manifest(root: Path, kind: str) -> tuple[dict, str]:
    path = root / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Manifest needs at least one case")
    keys = [case_key(case) for case in cases]
    if len(set(keys)) != len(keys):
        raise ValueError("Case keys must be unique")
    for case in cases:
        source = original_path(root, case)
        if not source.is_file() or digest(source) != case.get("sha256"):
            raise ValueError(f"Original missing or checksum changed: {source}")
        with Image.open(source) as image:
            width, height = image.size
        if case.get("width") != width or case.get("height") != height:
            raise ValueError(f"Manifest dimensions do not match: {source}")
        if kind == "ecommerce":
            if case.get("category") not in CATEGORIES:
                raise ValueError(f"Unknown ecommerce category: {case_key(case)}")
            if case.get("rights_confirmed") is not True or not str(case.get("rights_basis", "")).strip():
                raise ValueError(f"Rights evidence required: {case_key(case)}")
    if kind == "ecommerce" and CATEGORIES - {case["category"] for case in cases}:
        raise ValueError("Ecommerce set needs all five required categories")
    return manifest, digest(path)


def review_path(root: Path) -> Path:
    return root / "review.json"


def make_review(root: Path, kind: str) -> dict:
    manifest, manifest_sha = load_manifest(root, kind)
    return {
        "schema_version": 2,
        "dataset_kind": kind,
        "manifest_sha256": manifest_sha,
        "created_at": now(),
        "cases": [
            {
                "key": case_key(case),
                "source_sha256": case["sha256"],
                "category": case.get("category"),
                "triage": "pending",
                "checks": {name: "not_checked" for name in CHECKS},
                "issues": [],
                "manual_correction_seconds": None,
                "notes": "",
                "reviewer": "",
                "reviewed_at": None,
            }
            for case in manifest["cases"]
        ],
    }


def validate_review(root: Path, review: dict) -> dict:
    kind = review.get("dataset_kind")
    if review.get("schema_version") != 2 or kind not in {"proxy", "ecommerce"}:
        raise ValueError("Unsupported review schema or dataset kind")
    manifest, manifest_sha = load_manifest(root, kind)
    if review.get("manifest_sha256") != manifest_sha:
        raise ValueError("Manifest changed after review initialization")
    expected = {case_key(case): case for case in manifest["cases"]}
    rows = review.get("cases")
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise ValueError("Review case count does not match manifest")
    if len({row.get("key") for row in rows}) != len(rows):
        raise ValueError("Duplicate review keys")
    for row in rows:
        key = row.get("key")
        case = expected.get(key)
        if case is None or row.get("source_sha256") != case["sha256"]:
            raise ValueError(f"Review source identity mismatch: {key}")
        if row.get("category") != case.get("category"):
            raise ValueError(f"Review category mismatch: {key}")
        if row.get("triage") not in TRIAGE:
            raise ValueError(f"Invalid triage: {key}")
        checks = row.get("checks")
        if not isinstance(checks, dict) or set(checks) != set(CHECKS) or set(checks.values()) - CHECK_VALUES:
            raise ValueError(f"Invalid checks: {key}")
        issues = row.get("issues")
        if not isinstance(issues, list) or len(issues) != len(set(issues)) or set(issues) - set(ISSUES):
            raise ValueError(f"Invalid issue codes: {key}")
        seconds = row.get("manual_correction_seconds")
        if seconds is not None and (isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or seconds < 0):
            raise ValueError(f"Invalid correction time: {key}")
        if not isinstance(row.get("notes"), str) or not isinstance(row.get("reviewer"), str):
            raise ValueError(f"Invalid notes or reviewer: {key}")
        if row.get("triage") != "pending" and not row.get("reviewed_at"):
            raise ValueError(f"Reviewed case needs timestamp: {key}")
    return manifest


def load_review(root: Path) -> tuple[dict, dict]:
    review = json.loads(review_path(root).read_text(encoding="utf-8"))
    return review, validate_review(root, review)


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def make_html(root: Path, review: dict, manifest: dict) -> str:
    data = json.dumps(review, ensure_ascii=False).replace("<", "\\u003c")
    cards = []
    for case in manifest["cases"]:
        key = case_key(case)
        source = f"originals/{case['filename']}"
        white = f"white/{key}.png"
        cutout = f"cutouts/{key}.png"
        cards.append(
            f'<article class="card" data-key="{html.escape(key, quote=True)}">'
            f'<h2>{html.escape(key)} <small>{html.escape(case.get("title", ""))}</small></h2>'
            '<div class="images">'
            f'<figure><img src="{html.escape(source, quote=True)}" alt="原图"><figcaption>原图</figcaption></figure>'
            f'<figure><img src="{html.escape(white, quote=True)}" alt="白底"><figcaption>白底</figcaption></figure>'
            f'<figure class="magenta"><img src="{html.escape(cutout, quote=True)}" alt="高对比"><figcaption>高对比</figcaption></figure>'
            '</div><div class="fields">'
            '<label>分流<select data-field="triage"><option value="pending">待审核</option><option value="preview_pass">预览通过</option><option value="correction">需修正</option><option value="fail">失败</option></select></label>'
            '<label>审核人<input data-field="reviewer" type="text"></label>'
            '<label>异常代码<select data-field="issues" multiple size="5">'
            + "".join(f'<option value="{code}">{code}</option>' for code in ISSUES)
            + '</select></label>'
            + "".join(
                f'<label>{name}<select data-check="{name}"><option value="not_checked">未检查</option><option value="pass">通过</option><option value="issue">有问题</option><option value="not_applicable">不适用</option></select></label>'
                for name in CHECKS
            )
            + '<label class="notes">备注<textarea data-field="notes" rows="2"></textarea></label>'
            '<div class="timer"><button type="button" data-timer>开始修正计时</button><span data-time>未计时</span></div>'
            '</div></article>'
        )
    return """<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image Quality Review</title><style>
body{font:15px system-ui,sans-serif;margin:0;background:#eef2ef;color:#18362b}header{position:sticky;top:0;z-index:2;background:#18362b;color:white;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}header h1{font-size:20px;margin:0 20px 0 0}header button,header label{background:white;color:#18362b;border:0;border-radius:7px;padding:8px 12px;cursor:pointer}header input{display:none}#summary{font-weight:600}main{max-width:1500px;margin:auto;padding:20px}.card{background:white;border-radius:12px;margin-bottom:20px;padding:18px;box-shadow:0 1px 8px #0001}.card h2{font-size:17px;margin:0 0 12px}.card small{font-size:13px;color:#6a7c71;font-weight:400}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}figure{margin:0;background:white;border:1px solid #ddd;min-height:180px;display:flex;align-items:center;justify-content:center;position:relative}figure.magenta{background:#eb2596}figure img{display:block;max-width:100%;max-height:360px;object-fit:contain}figcaption{position:absolute;left:7px;top:7px;background:#18362bd9;color:white;padding:3px 7px;border-radius:4px;font-size:12px}.fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.fields label{font-size:12px;color:#405a4d;display:flex;flex-direction:column;gap:4px}.fields select,.fields input,.fields textarea{font:14px system-ui;min-width:0;border:1px solid #c9d8cf;border-radius:6px;padding:6px}.fields .notes{grid-column:span 3}.timer{display:flex;gap:8px;align-items:center}.timer button{padding:8px;border:1px solid #52946c;border-radius:6px;background:#e9f5eb;cursor:pointer}@media(max-width:900px){.fields{grid-template-columns:repeat(2,minmax(0,1fr))}.fields .notes{grid-column:span 2}}@media(max-width:600px){.images{grid-template-columns:1fr}.fields{grid-template-columns:1fr}.fields .notes{grid-column:span 1}}
</style><header><h1>图片质量人工验收</h1><span id="summary"></span><button id="save" type="button">保存到项目</button><button id="export" type="button">下载审核 JSON</button><button id="copy" type="button">复制审核 JSON</button><label>导入审核 JSON<input id="import" type="file" accept="application/json,.json"></label><span id="saved"></span></header><main>""" + "\n".join(cards) + """</main><script>
const initial = """ + data + """;
const storageKey = 'acs-review-' + initial.manifest_sha256;
let draft = initial;
try { const saved=JSON.parse(localStorage.getItem(storageKey)); if(saved && saved.manifest_sha256===initial.manifest_sha256 && saved.schema_version===2) draft=saved; } catch {}
const rows = new Map(draft.cases.map(row=>[row.key,row]));
function persist(){draft.cases=initial.cases.map(row=>rows.get(row.key));localStorage.setItem(storageKey,JSON.stringify(draft));document.getElementById('saved').textContent='本机草稿已保存；请点保存到项目';summary();}
function summary(){const counts={pending:0,preview_pass:0,correction:0,fail:0};for(const row of rows.values())counts[row.triage]++;document.getElementById('summary').textContent=`待审 ${counts.pending} / 预览通过 ${counts.preview_pass} / 需修正 ${counts.correction} / 失败 ${counts.fail}`;}
function bind(){for(const card of document.querySelectorAll('.card')){const row=rows.get(card.dataset.key);card.querySelector('[data-field="triage"]').value=row.triage;card.querySelector('[data-field="reviewer"]').value=row.reviewer;card.querySelector('[data-field="notes"]').value=row.notes;for(const opt of card.querySelector('[data-field="issues"]').options)opt.selected=row.issues.includes(opt.value);for(const name of Object.keys(row.checks))card.querySelector(`[data-check="${name}"]`).value=row.checks[name];const time=card.querySelector('[data-time]');time.textContent=row.manual_correction_seconds===null?'未计时':`${row.manual_correction_seconds} 秒`;const timer=card.querySelector('[data-timer]');timer.textContent=card.dataset.timerStart?'结束修正计时':'开始修正计时';card.querySelectorAll('[data-field],[data-check]').forEach(el=>el.onchange=()=>{if(el.dataset.check)row.checks[el.dataset.check]=el.value;else if(el.dataset.field==='issues')row.issues=Array.from(el.selectedOptions).map(x=>x.value);else row[el.dataset.field]=el.value;if(row.triage!=='pending')row.reviewed_at=new Date().toISOString();persist();});card.querySelector('[data-field="notes"]').oninput=e=>{row.notes=e.target.value;persist();};timer.onclick=()=>{if(card.dataset.timerStart){const elapsed=Math.round((Date.now()-Number(card.dataset.timerStart))/1000);row.manual_correction_seconds=(row.manual_correction_seconds||0)+elapsed;delete card.dataset.timerStart;timer.textContent='开始修正计时';time.textContent=`${row.manual_correction_seconds} 秒`;persist();}else{card.dataset.timerStart=String(Date.now());timer.textContent='结束修正计时';time.textContent='计时中…';}};}}
document.getElementById('export').onclick=()=>{if(document.querySelector('[data-timer-start]')){alert('请先结束修正计时');return;}const blob=new Blob([JSON.stringify(draft,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='review.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000);};
document.getElementById('save').onclick=async()=>{if(document.querySelector('[data-timer-start]')){alert('请先结束修正计时');return;}try{const response=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});const result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');document.getElementById('saved').textContent='已保存到项目 review.json';}catch(err){alert(err.message+'；请先启动本地审核服务');}};
document.getElementById('copy').onclick=async()=>{if(document.querySelector('[data-timer-start]')){alert('请先结束修正计时');return;}try{await navigator.clipboard.writeText(JSON.stringify(draft,null,2)+'\\n');document.getElementById('saved').textContent='审核 JSON 已复制；请保存为 review.json';}catch{alert('复制失败，请使用下载审核 JSON');}};
document.getElementById('import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const incoming=JSON.parse(await file.text());if(incoming.manifest_sha256!==initial.manifest_sha256||incoming.schema_version!==2||incoming.cases.length!==initial.cases.length)throw Error('素材集或格式不匹配');for(let i=0;i<incoming.cases.length;i++){if(incoming.cases[i].key!==initial.cases[i].key||incoming.cases[i].source_sha256!==initial.cases[i].source_sha256)throw Error('原图身份不匹配');}draft=incoming;rows.clear();for(const row of draft.cases)rows.set(row.key,row);persist();bind();}catch(err){alert(err.message);}e.target.value='';};
bind();summary();
</script></html>"""


def summary_markdown(review: dict, manifest: dict, root: Path) -> str:
    counts = Counter(row["triage"] for row in review["cases"])
    measured = [row["manual_correction_seconds"] for row in review["cases"] if row["manual_correction_seconds"] is not None]
    issue_counts = Counter(code for row in review["cases"] for code in row["issues"])
    lines = [
        "# Image quality review summary",
        "",
        f"Dataset: `{review['dataset_kind']}`; manifest SHA-256: `{review['manifest_sha256']}`.",
        "",
        f"Cases: {len(review['cases'])}; pending {counts['pending']}; preview pass {counts['preview_pass']}; correction {counts['correction']}; fail {counts['fail']}.",
        (
            f"Timed corrections: {len(measured)} cases, {round(sum(measured), 1)} seconds total. "
            "Untimed cases are excluded."
            if measured
            else "Timed corrections: none measured; no manual correction time claim."
        ),
        "",
        "## Exceptions",
        "",
        "| Code | Count |",
        "| --- | ---: |",
    ]
    lines += [f"| {code} | {count} |" for code, count in issue_counts.most_common()]
    if not issue_counts:
        lines.append("| none recorded | 0 |")
    lines += ["", "## Gate", ""]
    if review["dataset_kind"] == "proxy":
        lines.append("Proxy only: cannot satisfy the modern ecommerce acceptance gate.")
    else:
        missing = []
        if counts["pending"]:
            missing.append(f"{counts['pending']} unreviewed cases")
        for row in review["cases"]:
            key = row["key"]
            if row["triage"] != "preview_pass":
                missing.append(f"{key}: not preview-pass")
            if any(value == "not_checked" for value in row["checks"].values()):
                missing.append(f"{key}: incomplete checks")
            if any(value == "issue" for value in row["checks"].values()):
                missing.append(f"{key}: issue in checks")
            for suffix in (f"cutouts/{key}.png", f"white/{key}.png", f"scenes/{key}-branded.png", f"layouts/{key}-square.png", f"layouts/{key}-portrait.png"):
                if not (root / suffix).is_file():
                    missing.append(f"{key}: missing {suffix}")
        if missing:
            lines.append("Not ready for publication review. Remaining items:")
            lines.extend(f"- {item}" for item in missing)
        else:
            lines.append("All recorded checks and required files are present. Final human publication approval is still required.")
    return "\n".join(lines) + "\n"


def serve(root: Path, port: int) -> None:
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def do_POST(self) -> None:
            if self.path != "/api/review":
                self.send_error(404)
                return
            allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
            if self.headers.get("Origin") not in allowed:
                self.send_error(403, "Local review origin required")
                return
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                self.send_error(415, "JSON required")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 1_000_000:
                    raise ValueError("Review body must be 1–1000000 bytes")
                review = json.loads(self.rfile.read(length))
                manifest = validate_review(root, review)
                target = review_path(root)
                previous = target.read_bytes()
                replacement = (json.dumps(review, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
                if replacement != previous:
                    history = root / "review-history"
                    history.mkdir(exist_ok=True)
                    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                    (history / f"review-{stamp}.json").write_bytes(previous)
                    temporary = root / f".review-{stamp}.tmp"
                    temporary.write_bytes(replacement)
                    os.replace(temporary, target)
                    (root / "review-summary.md").write_text(
                        summary_markdown(review, manifest, root), encoding="utf-8"
                    )
                    (root / "review.html").write_text(
                        make_html(root, review, manifest), encoding="utf-8"
                    )
                body = b'{"saved":true}'
                self.send_response(200)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                body = json.dumps({"error": str(error)}).encode("utf-8")
                self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Review server: http://127.0.0.1:{port}/review.html", flush=True)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("ingest", "init", "render", "validate", "report", "serve"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--kind", choices=("proxy", "ecommerce"), default="proxy")
    parser.add_argument("--port", type=int, default=4102)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "ingest":
        print(ingest_manifest(root))
        return
    if args.command == "init":
        path = review_path(root)
        if path.exists():
            raise ValueError(f"Review already exists: {path}")
        write_json(path, make_review(root, args.kind))
        print(path)
        return
    review, manifest = load_review(root)
    if args.command == "validate":
        print(f"Valid review: {len(review['cases'])} unchanged originals")
    elif args.command == "render":
        path = root / "review.html"
        path.write_text(make_html(root, review, manifest), encoding="utf-8")
        print(path)
    elif args.command == "report":
        path = root / "review-summary.md"
        path.write_text(summary_markdown(review, manifest, root), encoding="utf-8")
        print(path)
    elif args.command == "serve":
        serve(root, args.port)


if __name__ == "__main__":
    main()
