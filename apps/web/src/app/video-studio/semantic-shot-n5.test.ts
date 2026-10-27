import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSemanticShot,
  type SemanticDraftShot,
  validateSemanticShot,
} from "./semantic-storyboard";

// N5（交接单 2026-10-27）：素材位 intent——模型只提出素材种类与叙事用途，
// 不给 URL/资产 ID；编译成「待绑定」占位镜头（诚实的未完成态），绑定走
// 既有媒体臂（模板选媒体→素材下拉→mediaClip 修订）。

const SLOT_IR: SemanticDraftShot = {
  intent: "media-slot-explainer",
  title: "产品整体展示",
  narrationText: "先看产品全貌",
  durationMs: 3000,
  slotKind: "产品整体照片",
  purpose: "开场建立产品第一印象",
};

test("N5 media-slot：合法 IR 校验并编译为诚实的待绑定位镜头", () => {
  const v = validateSemanticShot(SLOT_IR);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const c = compileSemanticShot(v.shot, 5030);
  // 占位是文字镜头：标题/副标题说明这是什么素材位，不冒充真实素材。
  assert.equal(c.plan.spec.componentId, "text-animation");
  const params = c.plan.spec.params as { title: string; subtitle: string };
  assert.match(params.title, /素材位/);
  assert.match(params.title, /产品整体照片/);
  assert.match(params.subtitle, /待绑定|开场建立/);
  // 确认卡如实预告：待绑定素材 + 种类 + 用途。
  assert.match(c.plan.renderHint, /待绑定/);
  assert.match(c.plan.renderHint, /产品整体照片/);
  assert.match(c.plan.renderHint, /开场建立/);
  // 描述带【素材位】前缀：版本列表一眼可辨，未绑定不冒充完成。
  assert.match(c.description, /【素材位】/);
});

test("N5 media-slot：字段形状校验（种类/用途长度、未知字段拒绝）", () => {
  const r1 = validateSemanticShot({ ...SLOT_IR, slotKind: "" });
  assert.ok(!r1.ok && r1.errors.some((e) => e.includes("slotKind")));
  const r2 = validateSemanticShot({
    ...SLOT_IR,
    purpose: "一".repeat(61),
  });
  assert.ok(!r2.ok && r2.errors.some((e) => e.includes("purpose")));
  const r3 = validateSemanticShot({
    ...SLOT_IR,
    assetUrl: "https://e.com/a.png",
  });
  assert.ok(!r3.ok && r3.errors.some((e) => e.includes("assetUrl")));
});

test("N5 media-slot：URL/资产 ID 类字段名拒绝并给绑定指引", () => {
  const bad = validateSemanticShot({
    ...SLOT_IR,
    assetId: "media-123",
  });
  assert.ok(!bad.ok);
  assert.ok(
    bad.errors.some((e) => /素材|绑定|图解/.test(e)),
    bad.errors.join("; "),
  );
});
