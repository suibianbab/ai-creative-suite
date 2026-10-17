// L3b 参数补全：领域默认策略表（通用语言指令方案 §5、M2）。
//
// 原则：绝不向用户追问数字。数值强度缺失永不阻塞——按本表补默认值直接
// 生成计划出预览，右侧面板自动聚焦对应滑杆，数字的职责交给滑杆；例外是
// 语义必需槽（text 的文字内容、色阶黑场/白场、画布/图片宽高、recolor 的
// 目标颜色——补充B 整改：「换个颜色」缺的是想换成什么颜色，不能静默等同
// 去色），它们无法从领域常识给出安全默认，由用户选择。所有默认值必须
// 「一步可改」：调整层参数可由滑杆直接改，旋转/投影可一步撤销，因此默认
// 值不会造成不可逆的意外。
import type { NLGap } from "./instruction-ir";

export type DefaultedSlot = {
  slot: string;
  value: string | number | boolean;
  /** 人类可读的规则出处，用于界面提示与评测快照，如 “未说明幅度 → 一点=10”。 */
  rule: string;
};

/** 程度词 → 调整幅度。原先散落在界面语法正则里（一点=10、明显=25），M2 抽出成数据表。 */
export const degreeAmounts: Readonly<
  Record<"bare" | "slight" | "obvious", number>
> = {
  bare: 10,
  slight: 10,
  obvious: 25,
};

const slightWords = /(?:稍微|一点|一些|稍稍|略微)/u;
const obviousWords = /(?:明显|大幅|强烈)/u;

/**
 * 领域默认策略表：每种操作一组默认值 + 文档。required 列出无法默认的语义
 * 必需槽（§5 的唯一例外集合）。新增操作先在此登记默认值或 required 槽，
 * 再放开解析；评测集对每一行默认行为固定快照。
 */
export const defaultStrategies = [
  {
    operation: "adjust",
    doc: "未说明幅度 → 一点=10；「明显」=25；方向取动词方向（提亮/调暗）。默认值生成原生调整层并出预览，滑杆接管后续微调。",
    defaults: { amount: "degree" },
    required: [] as string[],
  },
  {
    operation: "recolor",
    doc: "目标颜色是语义必需槽（补充B）：「换个颜色」不知道用户想要什么颜色，不再默认去色预览；界面点选目标色（黑/红/蓝/绿/灰）后重解析出计划。",
    defaults: {},
    required: ["color"],
  },
  {
    operation: "text",
    doc: "字号默认 48、颜色默认黑色（沿用既有契约）；文字内容是语义必需槽，无法默认。",
    defaults: { size: 48, textColor: "#111111" },
    required: ["text"],
  },
  {
    operation: "levels",
    doc: "伽马默认 1（沿用既有契约）；黑场/白场是一对语义必需槽，请用户写明。",
    defaults: { gamma: 1 },
    required: ["inBlack", "inWhite"],
  },
  {
    operation: "drop-shadow",
    doc: "未说明时 → 距离 8、大小 10、不透明度 55%（界面示例配方）。投影参数均为滑杆可调。",
    defaults: { distance: 8, size: 10, opacity: 55 },
    required: [] as string[],
  },
  {
    operation: "orient",
    doc: "「旋转一下」未说明方向 → 顺时针 90 度；翻转必须写明水平/垂直。",
    defaults: { mode: "rotate-cw" },
    required: [] as string[],
  },
  {
    operation: "crop",
    doc: "裁切范围由画框/选区提供（grounding 职责），无数值默认。",
    defaults: {},
    required: ["target"],
  },
  {
    operation: "heal",
    doc: "修复位置由用户点击提供，无数值默认。",
    defaults: {},
    required: ["target"],
  },
  {
    operation: "canvas-size",
    doc: "画布宽高是语义必需槽：默认值必须知道当前尺寸才能计算增量，解析层拿不到。",
    defaults: {},
    required: ["width", "height"],
  },
  {
    operation: "image-size",
    doc: "重采样宽高是语义必需槽，同 canvas-size。",
    defaults: {},
    required: ["width", "height"],
  },
  {
    operation: "text-style",
    doc: "粗体/下划线由动词直接给出，无数值默认。",
    defaults: {},
    required: ["verb"],
  },
  {
    operation: "layer-action",
    doc: "复制/隐藏/显示由动词直接给出，无数值默认。",
    defaults: {},
    required: ["verb"],
  },
] as const;

export type DefaultStrategyEntry = (typeof defaultStrategies)[number];

export function strategyFor(
  operation: string,
): DefaultStrategyEntry | undefined {
  return defaultStrategies.find((entry) => entry.operation === operation);
}

/** 从用户原话解析程度词幅度；没有程度词时用裸动词默认（§5 例：“提亮”→+10）。 */
export function degreeAmountFromText(instruction: string): {
  amount: number;
  rule: string;
} {
  const clean = instruction.replace(/\s+/g, "");
  if (obviousWords.test(clean))
    return { amount: degreeAmounts.obvious, rule: "明显=25" };
  if (slightWords.test(clean))
    return { amount: degreeAmounts.slight, rule: "一点/一些/稍微=10" };
  return { amount: degreeAmounts.bare, rule: "未说明幅度→10" };
}

/** 调色方向：返回 +1/-1/0（0 = 原话没有方向词，默认提亮方向）。 */
export function adjustDirectionFromText(instruction: string): 1 | -1 {
  const clean = instruction.replace(/\s+/g, "");
  return /(?:调暗|变暗|压低|调低|降低|减少|减弱|更柔和|更暗)/u.test(clean)
    ? -1
    : 1;
}

/** 调色种类：从动词/名词猜调整维度；默认亮度。 */
export function adjustmentKindFromText(
  instruction: string,
):
  | "brightness"
  | "contrast"
  | "saturation"
  | "exposure"
  | "vibrance"
  | "shadows"
  | "highlights" {
  const clean = instruction.replace(/\s+/g, "");
  if (/(?:自然饱和度)/u.test(clean)) return "vibrance";
  if (/(?:饱和度|鲜艳)/u.test(clean)) return "saturation";
  if (/(?:曝光)/u.test(clean)) return "exposure";
  if (/(?:暗部)/u.test(clean)) return "shadows";
  if (/(?:高光)/u.test(clean)) return "highlights";
  if (/(?:对比度|对比更)/u.test(clean)) return "contrast";
  return "brightness";
}

const planTargets: Array<[RegExp, string]> = [
  [/帽沿/u, "brim"],
  [/帽子|帽身/u, "hat"],
  [/背景/u, "background"],
  [/主体|前景|商品|产品/u, "subject"],
  [/整张|整幅|全图|整体|整个画面|图片|照片|画面|图像/u, "whole-image"],
  [/选区|区域|画框|轮廓|耳朵/u, "selected-area"],
];

/** 从原话解析计划 target；解析不到时返回 null（进 grounding，不猜）。 */
export function planTargetFromText(
  instruction: string,
): PhotoCraftPlanTarget | null {
  const clean = instruction.replace(/\s+/g, "");
  // 「背景」优先于「主体」类词：商品/产品不能吞掉「商品背景」。
  if (/背景/u.test(clean)) return "background";
  for (const [pattern, target] of planTargets) {
    if (pattern.test(clean)) {
      if (target === "background") continue;
      return target as PhotoCraftPlanTarget;
    }
  }
  return null;
}

export type PhotoCraftPlanTarget =
  | "hat"
  | "brim"
  | "selected-area"
  | "subject"
  | "background"
  | "whole-image";

export type DefaultsCompletion = {
  plan: Record<string, unknown>;
  defaulted: DefaultedSlot[];
};

/**
 * 事后溯源：一个已验证的计划里哪些槽实际来自默认策略表（原话没有依据）。
 * 不重跑解析——按「原话是否有数字/颜色词」与表默认值比对，供界面在预览
 * 旁聚焦对应滑杆（§5：数字是滑杆的职责，不是语言的职责）。
 */
export function defaultsUsedInPlan(
  instruction: string,
  plan: Record<string, unknown>,
): DefaultedSlot[] {
  const clean = instruction.replace(/\s+/g, "");
  const defaulted: DefaultedSlot[] = [];
  const hasNumber = /(?<!\d)\d{1,3}(?!\d)/.test(clean);
  if (
    plan.operation === "adjust" &&
    !hasNumber &&
    typeof plan.amount === "number" &&
    plan.amount !== 0
  )
    defaulted.push({
      slot: "amount",
      value: plan.amount,
      rule: degreeAmountFromText(instruction).rule,
    });
  // recolor 的灰色默认已随补充B 整改移除：目标色不再是表默认，无需溯源。
  return defaulted;
}

/**
 * L2 缺口 → L3b 默认补全。仅当缺口全部是参数缺口（永不阻塞类）且目标已知
 * 时补全；目标缺口属于 grounding（L3a），操作歧义是唯一允许追问的情况，
 * 能力缺口如实拒绝——这三种都不在此处理。
 */
export function completePlanFromGaps(
  instruction: string,
  gaps: NLGap[],
): DefaultsCompletion | null {
  if (gaps.length === 0 || gaps.some((gap) => gap.kind !== "param"))
    return null;
  const slots = new Set(gaps.map((gap) => gap.slot));
  const clean = instruction.replace(/\s+/g, "");
  const target = planTargetFromText(instruction);
  if (!target) return null;

  if (
    slots.has("amount") &&
    /(?:提亮|调亮|变亮|亮|调暗|变暗|暗|更鲜艳|饱和度|对比度|亮度|曝光|暗部|高光|自然饱和度)/u.test(
      clean,
    )
  ) {
    const degree = degreeAmountFromText(instruction);
    const direction = adjustDirectionFromText(instruction);
    const amount = degree.amount * direction;
    if (amount === 0) return null;
    return {
      plan: {
        operation: "adjust",
        adjustment: adjustmentKindFromText(instruction),
        amount,
        target,
        protectLabel:
          /(?:保留|不要改变|保持)(?:标签|商标)|(?:标签|商标)(?:不要变|保持不变)/iu.test(
            clean,
          ),
      },
      defaulted: [{ slot: "amount", value: amount, rule: degree.rule }],
    };
  }
  // 补充B 整改：color 槽不再默认补灰色——「换个颜色」必须由用户点选目标色
  //（界面色块）或改写原话后才生成计划，未选色不出预览、不进批量。
  return null;
}
