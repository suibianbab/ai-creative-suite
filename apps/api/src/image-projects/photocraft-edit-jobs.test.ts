import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHOTOCRAFT_BATCH_PROJECT_LIMIT,
  PHOTOCRAFT_BATCH_SAMPLE_RATE,
  PhotoCraftJobValidationError,
  sampleBatchJobIds,
  validatedPhotoCraftJobParams,
} from "./photocraft-edit-jobs.js";

test("adjustment jobs accept only bounded numerical parameters", () => {
  assert.deepEqual(
    validatedPhotoCraftJobParams("adjust-brightness", { amount: 15 }),
    { amount: 15 },
  );
  assert.deepEqual(
    validatedPhotoCraftJobParams("levels", {
      inBlack: 20,
      inWhite: 235,
      gamma: 1.2,
    }),
    { inBlack: 20, inWhite: 235, gamma: 1.2 },
  );
  for (const params of [
    { amount: 0 },
    { amount: 51 },
    { amount: 10, command: "paint.erase" },
    { amount: "15" },
    { amount: Number.POSITIVE_INFINITY },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("adjust-brightness", params),
      PhotoCraftJobValidationError,
    );
  for (const params of [
    { inBlack: 235, inWhite: 20, gamma: 1.2 },
    { inBlack: 20, inWhite: 235, gamma: 0 },
    { inBlack: 20, inWhite: 235, gamma: 1.2, path: "C:\\" },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("levels", params),
      PhotoCraftJobValidationError,
    );
  assert.throws(
    () => validatedPhotoCraftJobParams("rotate-cw", { amount: 10 }),
    PhotoCraftJobValidationError,
  );
});

test("masked adjustments accept bounded native selections and reject arbitrary command payloads", () => {
  const input = {
    amount: 18,
    selection: { kind: "rect", rect: [10, 20, 60, 70] },
  };
  assert.deepEqual(
    validatedPhotoCraftJobParams("masked-adjust-brightness", input),
    { ...input, edgeShift: 0, edgeFeather: 0, patches: [] },
  );
  assert.deepEqual(
    validatedPhotoCraftJobParams("masked-adjust-contrast", {
      amount: -12,
      selection: { kind: "existing" },
      edgeFeather: 2,
    }),
    {
      amount: -12,
      selection: { kind: "existing" },
      edgeShift: 0,
      edgeFeather: 2,
      patches: [],
    },
  );
  for (const params of [
    { ...input, command: "file.open" },
    { ...input, selection: { kind: "rect", rect: [10, 20, 0, 70] } },
    {
      ...input,
      selection: {
        kind: "lasso",
        points: [
          [1, 2],
          [3, 4],
        ],
      },
    },
    {
      ...input,
      selection: { kind: "object", rect: [1, 2, 3, 4], path: "C:\\" },
    },
    { ...input, edgeShift: 65 },
    {
      ...input,
      patches: [
        {
          mode: "replace",
          points: [
            [1, 2],
            [3, 4],
            [5, 6],
          ],
        },
      ],
    },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("masked-adjust-brightness", params),
      PhotoCraftJobValidationError,
    );
});

test("batch recipes accept 1-4 whole-image steps and reject masked or out-of-order canvas ops", () => {
  assert.deepEqual(
    validatedPhotoCraftJobParams("batch-recipe", {
      steps: [
        { operation: "adjust-brightness", params: { amount: 12 } },
        { operation: "rotate-cw" },
      ],
    }),
    {
      steps: [
        { operation: "adjust-brightness", params: { amount: 12 } },
        { operation: "rotate-cw", params: {} },
      ],
    },
  );
  // 单步（无 params 键）与多步混合均可。
  assert.deepEqual(
    validatedPhotoCraftJobParams("batch-recipe", {
      steps: [{ operation: "flip-horizontal" }],
    }),
    { steps: [{ operation: "flip-horizontal", params: {} }] },
  );
  for (const params of [
    // 空 / 超过 4 步
    { steps: [] },
    {
      steps: [
        { operation: "adjust-contrast", params: { amount: 5 } },
        { operation: "adjust-contrast", params: { amount: 5 } },
        { operation: "adjust-contrast", params: { amount: 5 } },
        { operation: "adjust-contrast", params: { amount: 5 } },
        { operation: "adjust-contrast", params: { amount: 5 } },
      ],
    },
    // 白名单外：蒙版操作（含选区几何）、生成、图层操作
    {
      steps: [
        {
          operation: "masked-adjust-brightness",
          params: {
            amount: 9,
            selection: { kind: "rect", rect: [1, 2, 3, 4] },
          },
        },
      ],
    },
    {
      steps: [
        {
          operation: "generate-local",
          params: { prompt: "x", selection: { kind: "existing" } },
        },
      ],
    },
    { steps: [{ operation: "hide-layer" }] },
    // 步内参数仍按单操作规则校验
    { steps: [{ operation: "adjust-brightness", params: { amount: 0 } }] },
    // 画布操作不在最后一步
    {
      steps: [
        { operation: "rotate-180" },
        { operation: "adjust-brightness", params: { amount: 6 } },
      ],
    },
    // 步对象夹带任意命令负载
    { steps: [{ operation: "adjust-brightness", command: "file.open" }] },
    // 夹带 steps 以外的键
    { steps: [{ operation: "flip-vertical" }], amount: 3 },
  ])
    assert.throws(
      () => validatedPhotoCraftJobParams("batch-recipe", params),
      PhotoCraftJobValidationError,
    );
});

test("batch sampling is deterministic, rate-bounded and id-order independent", () => {
  const ids = Array.from(
    { length: 50 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  const sample = sampleBatchJobIds(ids);
  // 20% 抽样：50 个 id 按排序等距取每第 5 个 → 10 个。
  assert.equal(sample.length, Math.round(50 * PHOTOCRAFT_BATCH_SAMPLE_RATE));
  // 乱序输入得到同一批样本（排序后等距）。
  assert.deepEqual(sample, sampleBatchJobIds([...ids].reverse()));
  // 重复调用结果稳定。
  assert.deepEqual(sample, sampleBatchJobIds(ids));
  // 空输入与边界 rate。
  assert.deepEqual(sampleBatchJobIds([]), []);
  assert.equal(sampleBatchJobIds(["a"]).length, 1);
  assert.equal(sampleBatchJobIds(ids, 1).length, 50);
  // rate 下限 0.01：50 个 id 仍抽中首个。
  assert.equal(sampleBatchJobIds(ids, 0).length, 1);
  // 上限封顶：单元素目录全量抽样。
  assert.deepEqual(sampleBatchJobIds(["only"]), ["only"]);
});

test("batch project ids are bounded by the directory limit", () => {
  assert.ok(PHOTOCRAFT_BATCH_PROJECT_LIMIT >= 50);
  assert.ok(Number.isInteger(PHOTOCRAFT_BATCH_PROJECT_LIMIT));
});
