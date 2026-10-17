// L1 intent representation (IR) and L2 gap analysis for the general-language
// pipeline (通用语言指令方案 M1). The express lane keeps producing exact
// PhotoCraftInstructionPlan values; this module formalizes what the plan
// resolved from the user's words and, when nothing matched, which slot was
// missing. Conversion never invents information — completion does.
import type { PhotoCraftInstructionPlan } from "./instruction";

export type NLTargetKind =
  | "named" // dictionary part: 帽子/帽沿/…
  | "subject" // provider subject mask, works on any image
  | "background" // inverse of the provider subject mask
  | "selection" // user-drawn frame/outline or saved native selection
  | "whole-image";

export type NLGapKind = "target" | "param" | "ambiguity" | "capability";

export type NLGap = {
  kind: NLGapKind;
  slot: string; // "target" | "color" | "amount" | "operation" | …
  phrase?: string; // the user's own words, verbatim, never rewritten
  detail: string;
};

export type NLImageEditIntent = {
  operation: PhotoCraftInstructionPlan["operation"];
  target: { kind: NLTargetKind; phrase: string };
  protect: string[];
  params: Record<string, unknown>;
  gaps: NLGap[];
  source: "express" | "model";
  confidence: number;
};

const targetKindByPlanTarget: Record<
  PhotoCraftInstructionPlan["target"],
  NLTargetKind
> = {
  hat: "named",
  brim: "named",
  "selected-area": "selection",
  subject: "subject",
  background: "background",
  "whole-image": "whole-image",
};

const targetPhrases: Array<[RegExp, string]> = [
  [/帽沿/u, "帽沿"],
  [/帽子|帽身/u, "帽子"],
  [/主体|前景|商品|产品/u, "主体"],
  [/背景/u, "背景"],
  [/耳朵|猫耳|左耳|右耳|选区|区域|画框|轮廓/u, "选区"],
  [/整张|整幅|全图|整体|整个画面/u, "整张图"],
];

function targetPhrase(instruction: string): string {
  for (const [pattern, phrase] of targetPhrases) {
    const match = instruction.match(pattern);
    if (match) return match[0] || phrase;
  }
  return "目标";
}

/** Turn a validated plan plus its source instruction into the open IR. */
export function buildNLIntent(
  instruction: string,
  plan: PhotoCraftInstructionPlan,
  source: "express" | "model",
): NLImageEditIntent {
  const { operation, target, protectLabel, expectedLayerId, ...params } = plan;
  const protect = [
    instruction.match(/(?:保留|不要改变|保持)?\s*(标签|商标|Logo|LOGO)/iu)?.[1],
  ].filter((phrase): phrase is string => Boolean(phrase));
  return {
    operation,
    target: {
      kind: targetKindByPlanTarget[target],
      phrase: targetPhrase(instruction),
    },
    protect: protectLabel ? (protect.length ? protect : ["标签"]) : [],
    params: params as Record<string, unknown>,
    gaps: [],
    source,
    confidence: source === "express" ? 1 : 0.6,
  };
}

const unsupportedVerbs =
  /(?:去掉|移除|删除|擦除|抠图|重绘|生成|换材质|改变形状|弄得好|好看|美化|高级感)/u;

function detectOperations(clean: string): string[] {
  const requested = [
    /(?:换成|改成|改为|涂成|变成|调成|换为|换个?(?:颜色|色)(?:彩)?|换色)/u.test(
      clean,
    )
      ? "recolor"
      : null,
    /(?:亮度|对比度|饱和度|曝光|暗部|高光|自然饱和度|提亮|调亮|变亮|调暗|变暗|更鲜艳|亮起来)/u.test(
      clean,
    )
      ? "adjust"
      : null,
    /(?:裁剪|剪裁|裁切|裁成|裁为)/u.test(clean) ? "crop" : null,
    /(?:污点|瑕疵|痘印)/u.test(clean) ? "heal" : null,
    /(?:添加|加上|写上|加入)(?:文字|文本|[「“"])/u.test(clean) ? "text" : null,
    /画布(?:尺寸)?/u.test(clean) ? "canvas-size" : null,
    /(?:图片|照片|图像)(?:的)?(?:尺寸|大小)|(?:缩放|重采样)/u.test(clean)
      ? "image-size"
      : null,
    /(?:旋转|翻转)/u.test(clean) ? "orient" : null,
    /(?:复制|隐藏|显示)(?:当前|选中的)?图层/u.test(clean)
      ? "layer-action"
      : null,
    /色阶|黑场|白场/u.test(clean) ? "levels" : null,
    /(?:文字|字体|字重).*(?:加粗|粗体|常规|下划线)/u.test(clean)
      ? "text-style"
      : null,
    /投影|阴影/u.test(clean) ? "drop-shadow" : null,
  ];
  return [
    ...new Set(requested.filter((item): item is string => item !== null)),
  ];
}

// 目标名词提取（P1-2 整改，codex 审核 2026-10-16）：优先「把/将/让 X…动词」
// 句框；句框不中时回退句首主谓式（「屋顶提亮一点」「花瓣换成蓝色」这类不带
// 把字框的表述）。主谓式排除参数/操作名词（亮度/文字/污点…），避免把调整
// 维度当成目标；也排除给我/帮我式客套前缀。仍不靠扩词典冒充任意表述——
// 提取不到就返回 undefined，缺口走页面明确的人工路径（改写建议或手画框）。
const TARGET_VERBS =
  "(?:换成|换为|改成|改为|涂成|变成|调成|提亮|调亮|变亮|调暗|变暗|提高|降低|增加|减少|弄得|变得)";
const NON_TARGET_NOUNS =
  /(?:亮度|对比度|饱和度|曝光|暗部|高光|自然饱和度|色阶|黑场|白场|颜色|色彩|文字|文本|字体|字重|画布|图片|照片|图像|画面|尺寸|大小|污点|瑕疵|痘印|阴影|投影|图层|标签|商标|主体|前景|商品|产品|背景)/u;
const POLITE_PREFIX =
  /(?:给|帮|请|麻烦|让我?|我想|我要|想要|能不能|可否|能否|可以)/u;

function extractTargetPhrase(clean: string): string | undefined {
  const framed = clean.match(
    /(?:把|将|让)(?:这|这一?个|这顶|这张|该)?([一-鿿]{1,6}?)(?:的)?(?:面料|毛发|颜色|色彩)?(?:换成|换为|改成|改为|涂成|变成|调成|提亮|调亮|变亮|调暗|变暗|提高|降低|增加|减少|弄得|变得)/u,
  )?.[1];
  if (framed) return framed;
  const subjectFirst = clean.match(
    new RegExp(`^([一-鿿]{1,6}?)(?:的)?(?:面料|毛发)?${TARGET_VERBS}`, "u"),
  )?.[1];
  if (
    subjectFirst &&
    !NON_TARGET_NOUNS.test(subjectFirst) &&
    !POLITE_PREFIX.test(subjectFirst)
  )
    return subjectFirst;
  return undefined;
}

/**
 * L2 gap analysis: when the express lane produced no plan, classify why.
 * Target gaps go to grounding, param gaps to defaults/handover, ambiguity to
 * one follow-up question, capability gaps to an honest rejection.
 */
export function analyzeNLInstructionGaps(instruction: string): NLGap[] {
  const clean = instruction.replace(/\s+/g, "");
  const gaps: NLGap[] = [];
  if (unsupportedVerbs.test(clean))
    return [
      {
        kind: "capability",
        slot: "operation",
        detail:
          "这条要求包含当前 PhotoCraft 工作流不支持的操作；请改为明确的换色、调色、裁切或文字操作",
      },
    ];
  const operations = detectOperations(clean);
  const hasKnownTarget = targetPhrases.some(([pattern]) => pattern.test(clean));
  if (operations.length > 1)
    return [
      {
        kind: "ambiguity",
        slot: "operation",
        detail: `这条要求包含多个编辑操作（${operations.join("、")}）；请分步说明，每条只做一件事`,
      },
    ];
  if (operations.length === 1 && operations[0] === "recolor") {
    const color = clean.match(
      /(?:换成|换为|改成|改为|涂成|变成|调成)(黑|红|蓝|绿|灰|白|紫|黄|橙|粉)色?/u,
    )?.[1];
    if (!color)
      gaps.push({
        kind: "param",
        slot: "color",
        detail:
          "未说明目标颜色；请点选目标色（黑/红/蓝/绿/灰）或改写成「改成红色」式的说法",
      });
    else if (!/^(?:黑|红|蓝|绿|灰)$/.test(color))
      gaps.push({
        kind: "param",
        slot: "color",
        phrase: `${color}色`,
        detail: "目标颜色不在当前换色能力范围（黑/红/蓝/绿/灰）",
      });
    if (!hasKnownTarget)
      gaps.push({
        kind: "target",
        slot: "target",
        phrase: extractTargetPhrase(clean),
        detail:
          "目标不在当前可自动识别的名词内；可说「主体/背景」，或用画框/轮廓指定范围",
      });
    return gaps.length
      ? gaps
      : [
          {
            kind: "param",
            slot: "operation",
            detail: "换色表述未能解析成计划；请按「把主体改成红色」的句式说明",
          },
        ];
  }
  if (operations.length === 1 && operations[0] === "adjust") {
    const amount = clean.match(
      /(?:提高|降低|增加|减少|提亮|调亮|压低|调暗)(\d{1,3})/u,
    )?.[1];
    if (amount && Number(amount) > 50)
      gaps.push({
        kind: "param",
        slot: "amount",
        phrase: amount,
        detail: "调色幅度超出 -50～50；将分次调整或用较小的幅度",
      });
    else if (!amount && !/(?:稍微|明显|一点|一些|更鲜艳)/u.test(clean))
      gaps.push({
        kind: "param",
        slot: "amount",
        detail: "未说明调色幅度；将按默认策略（一点=10）出预览，可用滑杆微调",
      });
    if (!hasKnownTarget)
      gaps.push({
        kind: "target",
        slot: "target",
        phrase: extractTargetPhrase(clean),
        detail:
          "调整对象不在当前可自动识别的名词内；可说「主体/背景」，或用画框/轮廓指定范围",
      });
    return gaps.length
      ? gaps
      : [
          {
            kind: "param",
            slot: "operation",
            detail:
              "调色表述未能解析成计划；请按「把主体亮度提高15」的句式说明",
          },
        ];
  }
  const [onlyOperation] = operations;
  if (operations.length === 1 && onlyOperation)
    return [
      {
        kind: "param",
        slot: onlyOperation,
        detail: "该操作的必要参数不完整；请对照界面语法示例补全数值或内容",
      },
    ];
  return [
    {
      kind: "capability",
      slot: "operation",
      detail:
        "没有识别到明确的编辑操作；请说明要做的换色、调色、裁切或文字操作",
    },
  ];
}

/** One-line human summary of a gap list, for message bars and API errors. */
export function describeNLGaps(gaps: NLGap[]): string {
  return gaps.map((gap) => `「${gap.slot}」${gap.detail}`).join("；");
}
