// P2-2 批量配方前端纯逻辑单测：单图确认环通过的计划 → 可跨目录复用的配方
// 步骤。与服务端 PHOTOCRAFT_BATCH_STEP_OPERATIONS / validatedBatchRecipeSteps
// 的约束对齐由 API 集成测试覆盖（image-project-http.integration.ts 批量场景），
// 这里钉住客户端拒绝原因与步骤描述的可读性。
import assert from "node:assert/strict";
import test from "node:test";
import {
  batchStepsFromConfirmedPlans,
  deriveBatchRequestKey,
  describePhotoCraftBatchStep,
  PHOTO_CRAFT_BATCH_PROJECT_LIMIT,
  PHOTO_CRAFT_BATCH_STEP_OPERATIONS,
} from "./batch-recipe";
import type { PhotoCraftInstructionPlan } from "./instruction";

function wholeImageAdjust(
  adjustment: Extract<
    PhotoCraftInstructionPlan,
    { operation: "adjust" }
  >["adjustment"] = "brightness",
  amount = 12,
): PhotoCraftInstructionPlan {
  return {
    operation: "adjust",
    adjustment,
    amount,
    target: "whole-image",
    protectLabel: false,
  };
}

const orientPlan = (
  mode: Extract<PhotoCraftInstructionPlan, { operation: "orient" }>["mode"],
): PhotoCraftInstructionPlan => ({
  operation: "orient",
  target: "whole-image",
  protectLabel: false,
  mode,
});

test("whole-image adjustments become batch steps with their amount", () => {
  const draft = batchStepsFromConfirmedPlans([
    wholeImageAdjust("brightness", 12),
    wholeImageAdjust("contrast", -8),
  ]);
  assert.equal(draft.error, null);
  assert.deepEqual(draft.steps, [
    { operation: "adjust-brightness", params: { amount: 12 } },
    { operation: "adjust-contrast", params: { amount: -8 } },
  ]);
});

test("levels plans carry inBlack/inWhite/gamma into the recipe", () => {
  const draft = batchStepsFromConfirmedPlans([
    {
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: 12,
      inWhite: 235,
      gamma: 1.2,
    },
  ]);
  assert.equal(draft.error, null);
  assert.deepEqual(draft.steps, [
    { operation: "levels", params: { inBlack: 12, inWhite: 235, gamma: 1.2 } },
  ]);
});

test("canvas operations are kept but must be the last step", () => {
  const ok = batchStepsFromConfirmedPlans([
    wholeImageAdjust("brightness", 10),
    orientPlan("flip-horizontal"),
  ]);
  assert.equal(ok.error, null);
  assert.equal(ok.steps!.at(-1)!.operation, "flip-horizontal");
  const misplaced = batchStepsFromConfirmedPlans([
    orientPlan("rotate-cw"),
    wholeImageAdjust("brightness", 10),
  ]);
  assert.equal(misplaced.steps, null);
  assert.match(misplaced.error, /最后一步/);
});

test("plans bound to one image are rejected with readable reasons", () => {
  const masked = batchStepsFromConfirmedPlans([
    {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "selected-area",
      protectLabel: false,
    },
  ]);
  assert.equal(masked.steps, null);
  assert.match(masked.error!, /局部调整/);
  const protect = batchStepsFromConfirmedPlans([
    {
      operation: "adjust",
      adjustment: "brightness",
      amount: 10,
      target: "whole-image",
      protectLabel: true,
    },
  ]);
  assert.equal(protect.steps, null);
  assert.match(protect.error!, /标签保护/);
  const recolor = batchStepsFromConfirmedPlans([
    {
      operation: "recolor",
      color: "blue",
      target: "subject",
      protectLabel: false,
    },
  ]);
  assert.equal(recolor.steps, null);
  assert.match(recolor.error!, /换色/);
  const layer = batchStepsFromConfirmedPlans([
    {
      operation: "layer-action",
      target: "whole-image",
      protectLabel: false,
      action: "duplicate",
    },
  ]);
  assert.equal(layer.steps, null);
  assert.match(layer.error, /图层操作/);
});

test("out-of-range amounts and empty or oversized sequences are refused", () => {
  const zero = batchStepsFromConfirmedPlans([
    wholeImageAdjust("brightness", 0),
  ]);
  assert.equal(zero.steps, null);
  assert.match(zero.error!, /超出批量配方允许范围/);
  const tooBig = batchStepsFromConfirmedPlans([
    wholeImageAdjust("brightness", 51),
  ]);
  assert.equal(tooBig.steps, null);
  assert.match(tooBig.error!, /超出/);
  assert.match(batchStepsFromConfirmedPlans([]).error!, /单图/);
  const five = Array.from({ length: 5 }, () => wholeImageAdjust());
  assert.match(batchStepsFromConfirmedPlans(five).error!, /最多 4 个步骤/);
});

test("step descriptions stay human-readable in the confirm dialog", () => {
  assert.equal(
    describePhotoCraftBatchStep({
      operation: "adjust-brightness",
      params: { amount: 12 },
    }),
    "亮度 +12",
  );
  assert.equal(
    describePhotoCraftBatchStep({
      operation: "adjust-contrast",
      params: { amount: -8 },
    }),
    "对比度 -8",
  );
  assert.equal(
    describePhotoCraftBatchStep({ operation: "flip-horizontal", params: {} }),
    "水平翻转",
  );
  assert.equal(
    describePhotoCraftBatchStep({
      operation: "levels",
      params: { inBlack: 12, inWhite: 235, gamma: 1.2 },
    }),
    "色阶（黑场 12、白场 235、伽马 1.2）",
  );
});

test("operation catalog and project limit mirror the server contract", () => {
  assert.equal(PHOTO_CRAFT_BATCH_STEP_OPERATIONS.length, 13);
  assert.equal(
    (PHOTO_CRAFT_BATCH_STEP_OPERATIONS as readonly string[]).includes(
      "masked-adjust-brightness",
    ),
    false,
    "蒙版操作不得进入批量配方",
  );
  assert.equal(PHOTO_CRAFT_BATCH_PROJECT_LIMIT, 200);
});

// R3（codex 第二轮复审）：请求键绑定确认内容快照——同一内容重试/恢复同键
// （幂等防重复扣费），内容或批次序号变化才换键。
test("batch request keys are deterministic per confirmation content and attempt", () => {
  const confirmationId = "01234567-89ab-4cd2-8efa-123456789012";
  const targets = ["bbbb-project", "aaaa-project"];
  const key = deriveBatchRequestKey({
    confirmationId,
    projectIds: targets,
    attempt: 0,
  });
  assert.match(key, /^browser-batch-[0-9a-f]{16}$/);
  // 同一内容（含目标顺序无关：规范化排序）重复派生 → 同键。
  assert.equal(
    deriveBatchRequestKey({
      confirmationId,
      projectIds: [...targets].reverse(),
      attempt: 0,
    }),
    key,
  );
  // 换确认引用（配方变了）→ 换键。
  assert.notEqual(
    deriveBatchRequestKey({
      confirmationId: "98765432-10ab-4cd2-8efa-1234567890ab",
      projectIds: targets,
      attempt: 0,
    }),
    key,
  );
  // 换目标清单 → 换键。
  assert.notEqual(
    deriveBatchRequestKey({
      confirmationId,
      projectIds: [targets[0]!],
      attempt: 0,
    }),
    key,
  );
  // 明确「再跑一批」（attempt+1）→ 换键；新内容重试仍稳定。
  const rerun = deriveBatchRequestKey({
    confirmationId,
    projectIds: targets,
    attempt: 1,
  });
  assert.notEqual(rerun, key);
  assert.equal(
    deriveBatchRequestKey({ confirmationId, projectIds: targets, attempt: 1 }),
    rerun,
  );
});
