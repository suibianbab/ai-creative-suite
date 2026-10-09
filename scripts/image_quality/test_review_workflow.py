"""Integrity checks for the local image QA record."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from review_workflow import CATEGORIES, ingest_manifest, make_review, summary_markdown, validate_review


class ReviewWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        originals = self.root / "originals"
        originals.mkdir()
        cases = []
        for index, category in enumerate(sorted(CATEGORIES)):
            label = f"product-{index}"
            filename = f"{label}.png"
            Image.new("RGB", (40 + index, 50 + index), (index * 20, 60, 100)).save(originals / filename)
            cases.append({
                "case": label,
                "title": label,
                "category": category,
                "filename": filename,
                "rights_confirmed": True,
                "rights_basis": "Owned synthetic test image",
            })
        (self.root / "intake.json").write_text(json.dumps({"cases": cases}), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_ingest_and_review_bind_to_unchanged_originals(self) -> None:
        ingest_manifest(self.root)
        review = make_review(self.root, "ecommerce")
        manifest = validate_review(self.root, review)
        self.assertEqual(len(manifest["cases"]), 5)
        Image.new("RGB", (40, 50), "red").save(self.root / "originals" / "product-0.png")
        with self.assertRaisesRegex(ValueError, "checksum changed"):
            validate_review(self.root, review)

    def test_missing_rights_and_outputs_block_acceptance(self) -> None:
        intake = json.loads((self.root / "intake.json").read_text(encoding="utf-8"))
        intake["cases"][0]["rights_confirmed"] = False
        (self.root / "intake.json").write_text(json.dumps(intake), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "rights confirmation"):
            ingest_manifest(self.root)
        intake["cases"][0]["rights_confirmed"] = True
        (self.root / "intake.json").write_text(json.dumps(intake), encoding="utf-8")
        ingest_manifest(self.root)
        review = make_review(self.root, "ecommerce")
        manifest = validate_review(self.root, review)
        report = summary_markdown(review, manifest, self.root)
        self.assertIn("Not ready for publication review", report)
        self.assertIn("missing scenes/product-0-branded.png", report)

    def test_review_rejects_changed_case_identity(self) -> None:
        ingest_manifest(self.root)
        review = make_review(self.root, "ecommerce")
        review["cases"][0]["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            validate_review(self.root, review)


if __name__ == "__main__":
    unittest.main()
