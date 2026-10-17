// M2 默认策略表（§5）单测：程度词幅度、方向/种类推断、目标解析优先级，
// 以及 L2 缺口 → L3b 默认补全的分拣规则（参数缺口补全；目标缺口归
// grounding；歧义/能力缺口不在此处理）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustDirectionFromText,
  adjustmentKindFromText,
  completePlanFromGaps,
  defaultStrategies,
  degreeAmountFromText,
  planTargetFromText,
  strategyFor,
} from "./default-strategy";
import { analyzeNLInstructionGaps } from "./instruction-ir";

test("degree amounts follow the default strategy table", () => {
  assert.equal(degreeAmountFromText("把主体提亮一点").amount, 10);
  assert.equal(degreeAmountFromText("背景明显调暗一些").amount, 25);
  assert.equal(degreeAmountFromText("稍微提亮").amount, 10);
  // 裸动词（无程度词）也走默认 10：绝不向用户追问数字。
  assert.equal(degreeAmountFromText("把主体提亮").amount, 10);
  assert.equal(degreeAmountFromText("把主体提亮").rule, "未说明幅度→10");
});

test("adjust direction comes from the verb, defaulting to brighten", () => {
  assert.equal(adjustDirectionFromText("把背景调暗"), -1);
  assert.equal(adjustDirectionFromText("主体压低一点"), -1);
  assert.equal(adjustDirectionFromText("把主体提亮"), 1);
  assert.equal(adjustDirectionFromText("更鲜艳一点"), 1);
});

test("adjustment kind resolves from domain nouns", () => {
  assert.equal(adjustmentKindFromText("饱和度提高一点"), "saturation");
  assert.equal(adjustmentKindFromText("自然饱和度强一点"), "vibrance");
  assert.equal(adjustmentKindFromText("暗部提亮一些"), "shadows");
  assert.equal(adjustmentKindFromText("高光压低"), "highlights");
  assert.equal(adjustmentKindFromText("对比度增强"), "contrast");
  assert.equal(adjustmentKindFromText("曝光提高一点"), "exposure");
  assert.equal(adjustmentKindFromText("把主体提亮"), "brightness");
});

test("target resolution prefers 背景 over 主体-family nouns", () => {
  assert.equal(planTargetFromText("把商品背景换成灰色"), "background");
  assert.equal(planTargetFromText("把主体提亮"), "subject");
  assert.equal(planTargetFromText("帽沿换成蓝色"), "brim");
  assert.equal(planTargetFromText("整张照片提亮一点"), "whole-image");
  assert.equal(planTargetFromText("把屋顶换成红色"), null);
});

test("every planner operation has a default strategy entry", () => {
  const operations = [
    "recolor",
    "adjust",
    "crop",
    "heal",
    "text",
    "canvas-size",
    "image-size",
    "orient",
    "layer-action",
    "levels",
    "text-style",
    "drop-shadow",
  ];
  for (const operation of operations)
    assert.ok(strategyFor(operation), `${operation} 缺默认策略行`);
  assert.equal(defaultStrategies.length, operations.length);
});

test("param-only gaps complete into a default plan with provenance", () => {
  const gaps = analyzeNLInstructionGaps("把主体亮度提高");
  assert.ok(gaps.every((gap) => gap.kind === "param"));
  const completion = completePlanFromGaps("把主体亮度提高", gaps);
  assert.ok(completion);
  assert.deepEqual(completion.plan, {
    operation: "adjust",
    adjustment: "brightness",
    amount: 10,
    target: "subject",
    protectLabel: false,
  });
  assert.deepEqual(completion.defaulted, [
    { slot: "amount", value: 10, rule: "未说明幅度→10" },
  ]);
});

test("recolor without a color never default-completes (semantic slot)", () => {
  // 补充B（codex 审核 2026-10-16）：目标颜色是语义必需槽，不再默认灰色
  // （静默换成灰色 = 猜错用户意图的直接来源）。缺口如实返回，由界面弹
  // 选色行，点选后原话拼接重解析；默认策略表 recolor 行 required 含 color。
  const text = "把主体换个颜色";
  const gaps = analyzeNLInstructionGaps(text);
  assert.ok(gaps.some((gap) => gap.slot === "color"));
  assert.equal(completePlanFromGaps(text, gaps), null);
  const recolor = strategyFor("recolor");
  assert.ok(recolor);
  assert.deepEqual(recolor.defaults, {});
  assert.deepEqual(recolor.required, ["color"]);
});

test("target gaps and non-param gaps never default-complete", () => {
  // 目标缺口属于 grounding（L3a），不猜。
  assert.equal(
    completePlanFromGaps(
      "把屋顶提亮一点",
      analyzeNLInstructionGaps("把屋顶提亮一点"),
    ),
    null,
  );
  // 操作歧义是唯一允许追问的情况。
  const ambiguous = analyzeNLInstructionGaps("把主体换成红色然后裁剪");
  assert.ok(ambiguous.some((gap) => gap.kind !== "param"));
  assert.equal(completePlanFromGaps("把主体换成红色然后裁剪", ambiguous), null);
  // 整图换色不在能力内，不默认。
  const whole = analyzeNLInstructionGaps("把整张图片换个颜色");
  assert.ok(whole.length > 0);
  assert.equal(completePlanFromGaps("把整张图片换个颜色", whole), null);
});
