// P2-2 整改（codex 审核 2026-10-16）：批量配方「确认一次，套全目录」的
// 前端纯逻辑——把单图确认环通过的编辑计划转换成可跨目录复用的配方步骤，
// 并在客户端复述服务端约束（apps/api photocraft-edit-jobs.ts 的
// PHOTOCRAFT_BATCH_STEP_OPERATIONS / validatedBatchRecipeSteps 是权威，
// 这里只是提前给出可读的拒绝原因；两边约束以集成测试对齐）。
import type { PhotoCraftInstructionPlan } from "./instruction";

// 与服务端 PHOTOCRAFT_BATCH_STEP_OPERATIONS 镜像的整图操作清单：
// 只有无选区、无图层上下文、无生成的操作才能进入配方。
export const PHOTO_CRAFT_BATCH_STEP_OPERATIONS = [
  "rotate-cw",
  "rotate-ccw",
  "rotate-180",
  "flip-horizontal",
  "flip-vertical",
  "adjust-brightness",
  "adjust-contrast",
  "adjust-saturation",
  "adjust-exposure",
  "adjust-vibrance",
  "adjust-shadows",
  "adjust-highlights",
  "levels",
] as const;
export type PhotoCraftBatchStepOperation =
  (typeof PHOTO_CRAFT_BATCH_STEP_OPERATIONS)[number];
export type PhotoCraftBatchStep = {
  operation: PhotoCraftBatchStepOperation;
  params: Record<string, unknown>;
};

// 与服务端 PHOTOCRAFT_BATCH_PROJECT_LIMIT 镜像的单批项目数上限。
export const PHOTO_CRAFT_BATCH_PROJECT_LIMIT = 200;

const CANVAS_OPERATIONS = new Set<string>([
  "rotate-cw",
  "rotate-ccw",
  "rotate-180",
  "flip-horizontal",
  "flip-vertical",
]);

const ADJUSTMENT_LABELS: Record<string, string> = {
  brightness: "亮度",
  contrast: "对比度",
  saturation: "饱和度",
  exposure: "曝光",
  vibrance: "自然饱和度",
  shadows: "阴影",
  highlights: "高光",
};

const OPERATION_LABELS: Record<string, string> = {
  recolor: "换色",
  crop: "裁剪",
  heal: "修补",
  text: "文字",
  "canvas-size": "画布尺寸",
  "image-size": "图片尺寸",
  "text-style": "文字样式",
  "drop-shadow": "投影",
  "layer-action": "图层操作",
};

export type PhotoCraftBatchRecipeDraft =
  | { steps: PhotoCraftBatchStep[]; error: null }
  | { steps: null; error: string };

function stepFromPlan(
  plan: PhotoCraftInstructionPlan,
): { step: PhotoCraftBatchStep } | { step: null; error: string } {
  if (plan.operation === "adjust") {
    if (plan.target !== "whole-image")
      return {
        step: null,
        error: `「${ADJUSTMENT_LABELS[plan.adjustment]}」是局部调整，选区与这张图绑定，不能批量套用`,
      };
    if (plan.protectLabel)
      return {
        step: null,
        error: "带标签保护范围的调整与单图绑定，不能批量套用",
      };
    if (
      !Number.isInteger(plan.amount) ||
      plan.amount === 0 ||
      Math.abs(plan.amount) > 50
    )
      return {
        step: null,
        error: `调整幅度 ${plan.amount} 超出批量配方允许范围（1~50）`,
      };
    return {
      step: {
        operation: `adjust-${plan.adjustment}` as PhotoCraftBatchStepOperation,
        params: { amount: plan.amount },
      },
    };
  }
  if (plan.operation === "levels") {
    if (
      !Number.isInteger(plan.inBlack) ||
      !Number.isInteger(plan.inWhite) ||
      plan.inBlack < 0 ||
      plan.inWhite > 255 ||
      plan.inBlack >= plan.inWhite ||
      !Number.isFinite(plan.gamma) ||
      plan.gamma < 0.1 ||
      plan.gamma > 5
    )
      return { step: null, error: "色阶参数超出批量配方允许范围" };
    return {
      step: {
        operation: "levels",
        params: {
          inBlack: plan.inBlack,
          inWhite: plan.inWhite,
          gamma: plan.gamma,
        },
      },
    };
  }
  if (plan.operation === "orient")
    return { step: { operation: plan.mode, params: {} } };
  return {
    step: null,
    error: `「${OPERATION_LABELS[plan.operation] ?? plan.operation}」与单图绑定，不能批量套用`,
  };
}

/**
 * 单图确认环通过的计划序列 → 批量配方步骤。拒绝一切与单图绑定的操作
 * （选区/图层/生成/保护框），并复述 1~4 步、画布操作放最后的约束。
 */
export function batchStepsFromConfirmedPlans(
  plans: readonly PhotoCraftInstructionPlan[],
): PhotoCraftBatchRecipeDraft {
  if (plans.length === 0)
    return { steps: null, error: "先在单图上确认编辑计划，再发起批量套用" };
  if (plans.length > 4)
    return { steps: null, error: "批量配方最多 4 个步骤；请拆分后分批提交" };
  const steps: PhotoCraftBatchStep[] = [];
  for (const plan of plans) {
    const converted = stepFromPlan(plan);
    if (!converted.step) return { steps: null, error: converted.error };
    steps.push(converted.step);
  }
  if (steps.slice(0, -1).some((step) => CANVAS_OPERATIONS.has(step.operation)))
    return {
      steps: null,
      error: "旋转/翻转请放在最后一步（与单图序列约束一致）",
    };
  return { steps, error: null };
}

// R3（codex 第二轮复审）：批量请求键绑定「一次确认的内容快照」——确认引用
// + 规范化目标清单 + 显式批次序号。同一内容重试/刷新后恢复都用同一键，后端
// 同键幂等保证不重复扣费；只有用户明确「再跑一批」（attempt+1）或内容变化
// 才产生新键。不用 crypto.randomUUID（每次提交都换键 = 丢响应重试双计费）。
// 客户端组件内不可用 node:crypto，FNV-1a 双字拼接已足够做幂等指纹（非安全
// 用途），对同一输入跨会话稳定。
function fnv1a64(input: string): string {
  let hi = 0xcbf29ce4 >>> 0;
  let lo = 0x84222325 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const byte = input.charCodeAt(index) & 0xff;
    lo = (lo ^ byte) >>> 0;
    lo = Math.imul(lo, 0x01000193) >>> 0;
    hi = (hi ^ ((byte + index) & 0xff)) >>> 0;
    hi = Math.imul(hi, 0x01000193) >>> 0;
  }
  return (
    (hi >>> 0).toString(16).padStart(8, "0") +
    (lo >>> 0).toString(16).padStart(8, "0")
  );
}

export function deriveBatchRequestKey(input: {
  confirmationId: string;
  projectIds: readonly string[];
  attempt: number;
}): string {
  const fingerprint = [
    input.confirmationId,
    [...input.projectIds].sort().join(","),
    input.attempt,
  ].join("|");
  return `browser-batch-${fnv1a64(fingerprint)}`;
}

export function describePhotoCraftBatchStep(step: PhotoCraftBatchStep): string {
  if (step.operation === "levels") {
    const { inBlack, inWhite, gamma } = step.params as {
      inBlack: number;
      inWhite: number;
      gamma: number;
    };
    return `色阶（黑场 ${inBlack}、白场 ${inWhite}、伽马 ${gamma}）`;
  }
  if (CANVAS_OPERATIONS.has(step.operation))
    return (
      {
        "rotate-cw": "顺时针旋转 90°",
        "rotate-ccw": "逆时针旋转 90°",
        "rotate-180": "旋转 180°",
        "flip-horizontal": "水平翻转",
        "flip-vertical": "垂直翻转",
      } as Record<string, string>
    )[step.operation]!;
  const [, adjustment] = step.operation.split("adjust-");
  const label = ADJUSTMENT_LABELS[adjustment ?? ""] ?? step.operation;
  const amount = step.params.amount as number;
  return `${label} ${amount > 0 ? "+" : ""}${amount}`;
}
