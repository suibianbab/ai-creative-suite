"""The user box is a hard boundary for every candidate mask."""

import importlib.util
from pathlib import Path
import unittest

import numpy as np


spec = importlib.util.spec_from_file_location(
    "parts_candidates", Path(__file__).with_name("parts-candidates.py")
)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class BoxMaskTest(unittest.TestCase):
    def test_clips_both_ears_and_forehead_to_drawn_box(self):
        mask = np.ones((10, 20), dtype=bool)
        clipped = module._clip_mask_to_box(mask, [0.1, 0.2, 0.4, 0.6])
        expected = np.zeros((10, 20), dtype=bool)
        expected[2:6, 2:8] = True
        np.testing.assert_array_equal(clipped, expected)

    def test_preserves_holes_inside_box(self):
        mask = np.ones((10, 20), dtype=bool)
        mask[3, 4] = False
        clipped = module._clip_mask_to_box(mask, [0.1, 0.2, 0.4, 0.6])
        self.assertFalse(clipped[3, 4])
        self.assertTrue(clipped[2, 2])
        self.assertFalse(clipped[1, 2])

    def test_rejects_whole_object_chopped_to_small_part_box(self):
        mask = np.ones((10, 20), dtype=bool)
        clipped = module._clip_mask_to_box(mask, [0.1, 0.2, 0.4, 0.6])
        self.assertGreater(module._box_spill_ratio(mask, clipped), 0.25)
        mostly_inside = np.zeros((10, 20), dtype=bool)
        mostly_inside[2:6, 2:8] = True
        mostly_inside[1, 4] = True
        bounded = module._clip_mask_to_box(mostly_inside, [0.1, 0.2, 0.4, 0.6])
        self.assertLess(module._box_spill_ratio(mostly_inside, bounded), 0.25)


if __name__ == "__main__":
    unittest.main()
