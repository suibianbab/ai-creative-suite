"""剔除点（蒙版代数）与 ensemble 重排序的纯函数测试。

提示结构（box_prompt_variants / parse_exclude_points）与排序键
（rank_regions / ensemble_order_key）在此钉住：SAM 负点是 label 0、
框模式仍为硬边界、默认 clip 序不变——这是交互与服务契约的回归底线。
"""

import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "parts_candidates", Path(__file__).with_name("parts-candidates.py")
)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class ParseExcludePointsTest(unittest.TestCase):
    def test_empty_header_means_no_points(self):
        points, error = module.parse_exclude_points("")
        self.assertEqual((points, error), ([], ""))

    def test_valid_pairs_normalized(self):
        points, error = module.parse_exclude_points("[[0.5, 0.25], [0, 1]]")
        self.assertEqual(points, [[0.5, 0.25], [0.0, 1.0]])
        self.assertEqual(error, "")

    def test_rejects_bad_json_count_and_range(self):
        for header in ("not json", "[]", "[[0.5,0.5]]"*3 + "[[0.1,0.1]]", "[[1.5,0.5]]", "[[0.5]]", "[[0.5,0.5,0.5]]"):
            points, error = module.parse_exclude_points(header)
            self.assertIsNone(points, header)
            self.assertTrue(error, header)

    def test_rejects_five_points(self):
        points, error = module.parse_exclude_points(
            "[[0.1,0.1],[0.2,0.2],[0.3,0.3],[0.4,0.4],[0.5,0.5]]"
        )
        self.assertIsNone(points)
        self.assertIn("1-4", error)


class BoxPromptVariantsTest(unittest.TestCase):
    def test_four_base_variants_without_excludes(self):
        variants = module.box_prompt_variants((100, 200, 300, 400), [])
        self.assertEqual(len(variants), 4)
        self.assertEqual(variants[0][0]["type"], "rectangle")
        self.assertEqual(variants[1][1]["type"], "point")
        self.assertEqual(variants[1][1]["label"], 1)
        # 框+中心+四分点变体共 6 个标记（rect 1 + center 1 + quad 4）。
        self.assertEqual(len(variants[2]), 6)
        self.assertEqual(variants[3][0]["type"], "point")

    def test_excludes_append_negative_points_to_every_variant(self):
        variants = module.box_prompt_variants(
            (100, 200, 300, 400), [(200.4, 300.6)]
        )
        for variant in variants:
            self.assertEqual(variant[-1]["type"], "point")
            self.assertEqual(variant[-1]["label"], 0)
            self.assertEqual(variant[-1]["data"], [200, 301])
        # 中心单点变体 = 1 正点 + 1 负点，仍是合法 SAM 提示。
        self.assertEqual(len(variants[3]), 2)

    def test_rectangle_data_unchanged_by_excludes(self):
        without = module.box_prompt_variants((10, 20, 30, 40), [])
        with_excludes = module.box_prompt_variants((10, 20, 30, 40), [(0.9, 0.9)])
        self.assertEqual(without[0][0], with_excludes[0][0])


class RankRegionsTest(unittest.TestCase):
    def test_clip_mode_keeps_current_clip_order_in_place(self):
        regions = [
            {"mask": None, "sam_score": 0.9, "clip_score": 0.20},
            {"mask": None, "sam_score": 0.7, "clip_score": 0.30},
            {"mask": None, "sam_score": 0.8, "clip_score": 0.25},
        ]
        ranked = module.rank_regions(regions, "clip")
        self.assertIs(ranked, regions)
        self.assertEqual(
            [r["clip_score"] for r in ranked], [0.30, 0.25, 0.20]
        )

    def test_ensemble_promotes_high_sam_low_clip_region(self):
        # 四候选池（排序发生在 top-k 截断前的整池上）：C 的 CLIP 略低于 A，
        # 但 SAM 高出一个身位——0.7/0.3 权重下 z(sam) 应把 C 顶到首位。
        # 验算：z_clip≈[0.99, 0.55, 0.11, -1.65]，z_sam≈[-0.58, -0.51, 1.73,
        # -0.64] → key(A)≈0.52 < key(C)≈0.60。
        regions = [
            {"mask": None, "sam_score": 0.61, "clip_score": 0.26},
            {"mask": None, "sam_score": 0.62, "clip_score": 0.25},
            {"mask": None, "sam_score": 0.95, "clip_score": 0.24},
            {"mask": None, "sam_score": 0.60, "clip_score": 0.20},
        ]
        ranked = module.rank_regions(regions, "ensemble")
        self.assertEqual(ranked[0]["sam_score"], 0.95)

    def test_ensemble_keeps_clear_clip_order(self):
        # CLIP 差距大到 SAM 拉不回来（真实「花朵」案的正确形态）。
        regions = [
            {"mask": None, "sam_score": 0.70, "clip_score": 0.30},
            {"mask": None, "sam_score": 0.99, "clip_score": 0.10},
        ]
        ranked = module.rank_regions(regions, "ensemble")
        self.assertEqual(ranked[0]["clip_score"], 0.30)

    def test_ensemble_two_candidates_follow_clip_sign(self):
        # n=2 时 z 恒为 ±1，ensemble 退化为加权符号比较——CLIP 领先即领先
        # （0.7>0.3）；把该退化行为钉住，避免误读「两候选时 SAM 可翻盘」。
        regions = [
            {"mask": None, "sam_score": 0.95, "clip_score": 0.24},
            {"mask": None, "sam_score": 0.62, "clip_score": 0.26},
        ]
        ranked = module.rank_regions(regions, "ensemble")
        self.assertEqual(ranked[0]["clip_score"], 0.26)

    def test_ensemble_single_candidate_degenerates(self):
        regions = [{"mask": None, "sam_score": 0.8, "clip_score": 0.2}]
        self.assertEqual(
            module.rank_regions(regions, "ensemble"), regions
        )

    def test_unknown_mode_raises(self):
        with self.assertRaises(ValueError):
            module.rank_regions([], "sam")


class ZScoresTest(unittest.TestCase):
    def test_constant_values_map_to_zero(self):
        self.assertEqual(module._z_scores([0.3, 0.3, 0.3]), [0.0, 0.0, 0.0])
        self.assertEqual(module._z_scores([]), [])

    def test_mean_zero_variance_one(self):
        z = module._z_scores([0.1, 0.3])
        self.assertAlmostEqual(sum(z), 0.0, places=12)


class Clamp01Test(unittest.TestCase):
    """sam_score 契约回归：SAM iou 头量化后实测可轻微 >1（帽顶网格点
    1.0055，IMG-055 第四臂 ensemble 序把它带进 top-3 才暴露）——夹紧在
    _decode_prompt 唯一出口，NaN 归 0 让 score<0.6 门拦下而非放行。"""

    def test_slightly_above_one_clamps(self):
        self.assertEqual(module.clamp01(1.0055), 1.0)
        self.assertEqual(module.clamp01(1.0), 1.0)

    def test_negative_and_normal_pass_through(self):
        self.assertEqual(module.clamp01(-0.1), 0.0)
        self.assertEqual(module.clamp01(0.42), 0.42)
        self.assertEqual(module.clamp01(0.0), 0.0)

    def test_nan_maps_to_zero_not_passed_through(self):
        self.assertEqual(module.clamp01(float("nan")), 0.0)

    def test_infinity_bounded(self):
        self.assertEqual(module.clamp01(float("inf")), 1.0)
        self.assertEqual(module.clamp01(float("-inf")), 0.0)


if __name__ == "__main__":
    unittest.main()
