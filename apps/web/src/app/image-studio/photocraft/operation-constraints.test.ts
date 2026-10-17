// M3 约束表重构的钉死快照：表驱动引擎必须与旧手写约束逐字等价，
// 新增操作先在 operationMetadata 登记规则，再在此补快照。
import assert from "node:assert/strict";
import test from "node:test";
import type { PhotoCraftInstructionPlan } from "./instruction";
import {
  operationMetadata,
  stepAcceptsProtect,
  validateOperationSequence,
} from "./operation-constraints";

const recolorHat: PhotoCraftInstructionPlan = {
  operation: "recolor",
  color: "red",
  target: "hat",
  protectLabel: false,
};
const adjustSubject: PhotoCraftInstructionPlan = {
  operation: "adjust",
  adjustment: "brightness",
  amount: 10,
  target: "subject",
  protectLabel: false,
};
const brightenWhole: PhotoCraftInstructionPlan = {
  operation: "adjust",
  adjustment: "brightness",
  amount: 10,
  target: "whole-image",
  protectLabel: false,
};
const crop: PhotoCraftInstructionPlan = {
  operation: "crop",
  target: "selected-area",
  protectLabel: false,
};
const rotate: PhotoCraftInstructionPlan = {
  operation: "orient",
  target: "whole-image",
  protectLabel: false,
  mode: "rotate-cw",
};

test("operation metadata covers every planner operation", () => {
  // 与 planner 能力集同步：缺登记的操作会静默绕过约束，因此显式钉死。
  for (const operation of [
    "recolor",
    "adjust",
    "levels",
    "crop",
    "heal",
    "text",
    "canvas-size",
    "image-size",
    "orient",
    "text-style",
    "drop-shadow",
    "layer-action",
  ])
    assert.ok(operationMetadata[operation], `${operation} 缺少约束元数据`);
});

test("valid sequences pass unchanged", () => {
  assert.doesNotThrow(() =>
    validateOperationSequence([recolorHat, brightenWhole]),
  );
  assert.doesNotThrow(() => validateOperationSequence([adjustSubject, crop]));
  assert.doesNotThrow(() => validateOperationSequence([brightenWhole, rotate]));
});

test("geometry changes must come last with the exact legacy message", () => {
  assert.throws(
    () => validateOperationSequence([rotate, brightenWhole]),
    /画布、图片尺寸或方向变更请放在最后一步/,
  );
  assert.throws(
    () => validateOperationSequence([crop, brightenWhole]),
    /裁切请放在最后一步，以保留前面步骤的选区坐标/,
  );
  // crop 作废选区坐标：后续依赖选区的局部步骤被表规则拦截，同一条文案。
  assert.throws(
    () => validateOperationSequence([crop, recolorHat, adjustSubject]),
    /裁切请放在最后一步，以保留前面步骤的选区坐标/,
  );
});

test("standalone and current-layer rules keep their legacy messages", () => {
  assert.throws(
    () =>
      validateOperationSequence([
        { operation: "heal", target: "selected-area", protectLabel: false },
        brightenWhole,
      ]),
    /当前操作请单独执行并检查结果/,
  );
  assert.throws(
    () =>
      validateOperationSequence([
        {
          operation: "layer-action",
          target: "whole-image",
          protectLabel: false,
          action: "duplicate",
        },
        brightenWhole,
      ]),
    /图层复制或显隐请单独执行并检查当前图层/,
  );
  assert.throws(
    () =>
      validateOperationSequence([
        {
          operation: "drop-shadow",
          target: "whole-image",
          protectLabel: false,
          distance: 6,
          size: 8,
          opacity: 60,
        },
        recolorHat,
      ]),
    /文字样式和投影只能组合编辑同一个当前选中图层/,
  );
});

test("only one local selection step per sequence", () => {
  assert.throws(
    () => validateOperationSequence([recolorHat, adjustSubject]),
    /一次复合编辑只能包含一个局部选区步骤；其他局部编辑请另起一轮/,
  );
});

test("protect attaches only to steps that still hold a local selection", () => {
  assert.equal(stepAcceptsProtect(recolorHat), true);
  assert.equal(stepAcceptsProtect(adjustSubject), true);
  assert.equal(stepAcceptsProtect(brightenWhole), false);
  assert.equal(stepAcceptsProtect(crop), false);
  assert.equal(
    stepAcceptsProtect({
      operation: "levels",
      target: "whole-image",
      protectLabel: false,
      inBlack: 20,
      inWhite: 235,
      gamma: 1,
    }),
    false,
  );
});
