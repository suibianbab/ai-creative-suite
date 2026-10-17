// M3 约束表重构（通用语言指令方案 §6 多步指令）：把手写的复合步骤顺序
// 约束改成操作元数据表驱动的小引擎。每个操作声明自己的前置/后置条件
// （如 crop 作废选区坐标 → 只能放最后；图层操作只认当前选中图层），
// 引擎按表校验步骤序列。当前 19 种操作规模下与旧手写约束完全等价
// （错误文案逐字保留，评测集钉死快照）；新增操作时先在此登记元数据。
import type { PhotoCraftInstructionPlan } from "./instruction";

export type OperationMetadata = {
  /** 操作中文名（错误提示与文档用）。 */
  label: string;
  /**
   * 该操作会作废的后续前置条件。例如 crop 改变画布几何 → 作废选区坐标；
   * 引擎据此拒绝「作废之后又依赖」的步骤组合。
   */
  invalidates?: Array<"selection-coords" | "layer-identity">;
  /** 该步骤依赖选区坐标（crop/orient 等几何变更之后不允许出现）。 */
  needsSelectionCoords?: boolean;
  /** 必须是序列最后一步；reason 为面向用户的错误文案。 */
  mustBeLastReason?: string;
  /** 必须单独执行；reason 为面向用户的错误文案。 */
  standaloneReason?: string;
  /** 只认 PhotoCraft 当前选中图层：出现时整个序列只能由同类组成。 */
  currentLayerOnly?: boolean;
  /** protect 清单可以附着到该操作上（保护框本身依赖局部选区语义）。 */
  allowsProtect?: boolean;
};

export const operationMetadata: Record<string, OperationMetadata> = {
  recolor: { label: "换色", needsSelectionCoords: true, allowsProtect: true },
  adjust: { label: "调色", needsSelectionCoords: true, allowsProtect: true },
  levels: {
    label: "色阶",
    mustBeLastReason: "画布、图片尺寸或方向变更请放在最后一步",
    currentLayerOnly: false,
  },
  crop: {
    label: "裁切",
    invalidates: ["selection-coords"],
    mustBeLastReason: "裁切请放在最后一步，以保留前面步骤的选区坐标",
  },
  heal: {
    label: "污点修复",
    standaloneReason: "当前操作请单独执行并检查结果",
    needsSelectionCoords: true,
  },
  text: {
    label: "文字",
    standaloneReason: "当前操作请单独执行并检查结果",
  },
  "canvas-size": {
    label: "画布尺寸",
    mustBeLastReason: "画布、图片尺寸或方向变更请放在最后一步",
    invalidates: ["selection-coords"],
  },
  "image-size": {
    label: "图片尺寸",
    mustBeLastReason: "画布、图片尺寸或方向变更请放在最后一步",
    invalidates: ["selection-coords"],
  },
  orient: {
    label: "旋转/翻转",
    mustBeLastReason: "画布、图片尺寸或方向变更请放在最后一步",
    invalidates: ["selection-coords"],
  },
  "text-style": {
    label: "文字样式",
    currentLayerOnly: true,
    standaloneReason: "文字样式和投影只能组合编辑同一个当前选中图层",
  },
  "drop-shadow": {
    label: "投影",
    currentLayerOnly: true,
    standaloneReason: "文字样式和投影只能组合编辑同一个当前选中图层",
  },
  "layer-action": {
    label: "图层操作",
    standaloneReason: "图层复制或显隐请单独执行并检查当前图层",
    invalidates: ["layer-identity"],
  },
};

export function metadataFor(operation: string): OperationMetadata {
  return operationMetadata[operation] ?? { label: operation };
}

/**
 * 按元数据表校验复合步骤序列（2–4 步）。抛出的错误文案与旧手写约束
 * 逐字一致；新增操作只需在 operationMetadata 登记新规则。
 */
export function validateOperationSequence(
  steps: PhotoCraftInstructionPlan[],
): void {
  if (steps.length < 2 || steps.length > 4)
    throw new Error("一次请指定 2 至 4 个明确编辑步骤");
  for (const step of steps) {
    const meta = metadataFor(step.operation);
    if (!meta.standaloneReason) continue;
    // 单独执行类操作带自己的文案；文字样式/投影例外——它们可以彼此组合，
    // 由 currentLayerOnly 规则统一裁决。
    if (meta.currentLayerOnly) continue;
    throw new Error(meta.standaloneReason);
  }
  const layerBound = steps.some((step) =>
    Boolean(metadataFor(step.operation).currentLayerOnly),
  );
  if (
    layerBound &&
    !steps.every((step) =>
      Boolean(metadataFor(step.operation).currentLayerOnly),
    )
  )
    throw new Error("文字样式和投影只能组合编辑同一个当前选中图层");
  steps.forEach((step, index) => {
    const meta = metadataFor(step.operation);
    if (meta.mustBeLastReason && index !== steps.length - 1)
      throw new Error(meta.mustBeLastReason);
    // 几何/图层作废规则：前面步骤作废过的条件，后面步骤不得再依赖。
    const broken = steps
      .slice(0, index)
      .flatMap((prior) => metadataFor(prior.operation).invalidates ?? []);
    if (meta.needsSelectionCoords && broken.includes("selection-coords"))
      throw new Error("裁切请放在最后一步，以保留前面步骤的选区坐标");
  });
  const localSteps = steps.filter(
    (step) => step.target !== "whole-image" && step.operation !== "crop",
  ).length;
  if (localSteps > 1)
    throw new Error(
      "一次复合编辑只能包含一个局部选区步骤；其他局部编辑请另起一轮",
    );
}

/** protect 清单能否附着到某一步（旧手写列表 = 本表 allowsProtect 的反集）。 */
export function stepAcceptsProtect(step: PhotoCraftInstructionPlan): boolean {
  return (
    Boolean(metadataFor(step.operation).allowsProtect) &&
    step.target !== "whole-image"
  );
}
