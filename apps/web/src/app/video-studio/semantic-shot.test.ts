import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticShot,
  validateSemanticShot,
} from "./semantic-storyboard";

// N2（交接单 2026-10-27）：单镜修改复用整片 IR 的逐镜校验与编译——
// validateSemanticShot / compileSemanticShot 是从 validateSemanticDraft /
// compileSemanticDraft 抽出的同一套规则（严格键集合、预算、确定性延长），
// 保证「AI 修改此镜头」与整片规划行为同源。
test("validateSemanticShot：合法单镜通过", () => {
  const v = validateSemanticShot({
    intent: "cycle-explainer",
    title: "水循环三阶段",
    narrationText: "水循环不停",
    durationMs: 5000,
    cycleSteps: ["蒸发", "凝结", "降水"],
  });
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
});

test("validateSemanticShot：未知/资产字段拒绝并给素材指引", () => {
  const bad = validateSemanticShot({
    intent: "cycle-explainer",
    title: "T",
    narrationText: "旁白",
    durationMs: 5000,
    cycleSteps: ["蒸发", "凝结", "降水"],
    assetUrl: "https://e.com/a.png",
  });
  assert.ok(!bad.ok);
  assert.ok(
    bad.errors.some((e) => e.includes("assetUrl") && /素材|照片/.test(e)),
    bad.errors.join("; "),
  );
});

test("validateSemanticShot：旁白超绝对上限拒绝", () => {
  const bad = validateSemanticShot({
    intent: "title",
    title: "T",
    narrationText: "一二三四五六七八九十一二三四五六七八九",
    durationMs: 6000,
  });
  assert.ok(!bad.ok);
  assert.ok(
    bad.errors.some((e) => e.includes("旁白")),
    bad.errors.join("; "),
  );
});

test("compileSemanticShot：产出候选（renderHint 含屏幕文字、时长延长口径一致）", () => {
  const c = compileSemanticShot(
    {
      intent: "flow-explainer",
      title: "凝结过程",
      narrationText: "水汽遇冷变成云",
      durationMs: 2500,
      flowSteps: ["水汽上升", "遇冷凝结", "聚成云滴"],
    },
    7777,
  );
  assert.equal(c.plan.spec.componentId, "flow-steps");
  // 7 字旁白预算 400+300×7=2500 → 时长 ≥2500（确定性延长，同整片口径）。
  assert.ok(c.plan.spec.durationMs >= 2500);
  assert.match(c.plan.renderHint, /凝结过程/);
  assert.match(c.plan.renderHint, /水汽上升/);
  assert.equal(c.narrationText, "水汽遇冷变成云");
});
