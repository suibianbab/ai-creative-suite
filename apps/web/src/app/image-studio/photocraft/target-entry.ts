// D 项（第七轮整改）入口辅助：方位/多实例识别、画框限定归一化、
// selected-area 计划的入口条件与多候选分布信号。纯函数——页面交互与单测
// 共用同一判定，不在组件里散落正则。
//
// codex §D：对方位词、同类多实例或部件歧义，给用户一次点击/画框限定位置
// 再请求候选，不要默默猜「左耳」是哪块。识别只是「提示强度」——候选环照常
// 展示，限定与否由用户决定。

import type { PhotoCraftInstructionPlan } from "./instruction";
import { GENERIC_SELECTION_PHRASES } from "./instruction-ir";

export type PhraseClassification = {
  /** 含左/右/上/下/前/后方位词（左耳、右边的窗户…）：同名词多处出现，建议限定。 */
  directional: boolean;
  /** 含数量词（两扇窗、几只鸟…）：明确多实例，建议限定。 */
  multiInstance: boolean;
};

const DIRECTIONAL = /(?:左|右|上|下|前|后)(?:边|侧|面|部)?/u;
const MULTI_INSTANCE = /(?:两|双|三|四|几)(?:扇|个|只|张|条|处|根|片|朵|盏)/u;

export function classifyTargetPhrase(phrase: string): PhraseClassification {
  const clean = phrase.trim();
  return {
    directional: clean.length >= 2 && DIRECTIONAL.test(clean),
    multiInstance: clean.length >= 2 && MULTI_INSTANCE.test(clean),
  };
}

/** 剔除点上限（与服务端 parse_exclude_points 同口径）。 */
export const EXCLUDE_POINT_LIMIT = 4;

/**
 * 剔除点（蒙版代数的交互形态）归一化：sampleSize 像素点 → [x,y] ∈ [0,1]²
 * （响应空间同比例）。越界点钳到边界而非拒绝——用户点在候选边缘附近是
 * 常态，钳制比「重试一次」体验好；服务端只要求值域合法。
 */
export function normalizeExcludePoint(
  point: readonly [number, number],
  size: readonly [number, number],
): [number, number] | null {
  if (size[0] <= 0 || size[1] <= 0) return null;
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  return [
    Number(clamp01(point[0] / size[0]).toFixed(4)),
    Number(clamp01(point[1] / size[1]).toFixed(4)),
  ];
}

/**
 * 「点选剔除」入口条件：目标候选环在画框限定模式下且尚未确认——剔除点
 * 只对「框内候选还带进了误选区域」有意义（花瓣含花蕊、猫头含猫脸），
 * 网格模式与已确认候选不提供，避免与 PhotoCraft 蒙版笔刷（更精细的
 * 剔除工具）抢职责。
 */
export function canOfferExcludeRefine(ctx: {
  mode: "target" | "protect";
  hasPromptBox: boolean;
  chosen: boolean;
  candidateCount: number;
}): boolean {
  return (
    ctx.mode === "target" &&
    ctx.hasPromptBox &&
    !ctx.chosen &&
    ctx.candidateCount > 0
  );
}

/**
 * 像素画框（sampleSize 空间）→ 归一化 [x1,y1,x2,y2]（响应/原图同比例空间，
 * EXIF 两侧已归一）。太小的框返回 null——服务端也会拒（≥2% 边长），提前
 * 拦下并提示重画，省一次往返。
 */
export function normalizePromptBox(
  rect: readonly [number, number, number, number],
  size: readonly [number, number],
): [number, number, number, number] | null {
  if (size[0] <= 0 || size[1] <= 0) return null;
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const x1 = clamp01(rect[0] / size[0]);
  const y1 = clamp01(rect[1] / size[1]);
  const x2 = clamp01((rect[0] + rect[2]) / size[0]);
  const y2 = clamp01((rect[1] + rect[3]) / size[1]);
  if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
  return [
    Number(x1.toFixed(4)),
    Number(y1.toFixed(4)),
    Number(x2.toFixed(4)),
    Number(y2.toFixed(4)),
  ];
}

/**
 * D 项入口条件：selected-area 计划在手绘选区、画框、点位、原生选区全都
 * 不在场，且原话能提出一个具体物体名词时，提供「智能找目标 / 点击画框」
 * 入口（codex §D：「左耳」等固定词不能默默猜，也不能只报死路）。
 */
export function shouldOfferSelectionEntry(
  plan: Pick<PhotoCraftInstructionPlan, "target" | "operation">,
  ctx: {
    hasNativeSelection: boolean;
    outlineLength: number;
    hasScopeRect: boolean;
    pointsLength: number;
  },
  phrase: string | undefined,
): boolean {
  if (plan.target !== "selected-area") return false;
  if (plan.operation !== "recolor" && plan.operation !== "adjust") return false;
  if (
    ctx.hasNativeSelection ||
    ctx.outlineLength > 0 ||
    ctx.hasScopeRect ||
    ctx.pointsLength > 0
  )
    return false;
  if (!phrase || phrase.trim().length === 0) return false;
  return !GENERIC_SELECTION_PHRASES.has(phrase.trim());
}

function rectIou(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = iw * ih;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * 多实例的运行时信号：前两个候选（服务已按 CLIP 分排序）位置基本不重叠
 * ——同一名词在图里多处出现，提示用户点编号或画框限定。静态词典之外的
 * 诚实检测路径。
 */
export function topCandidatesSpread(
  candidates: ReadonlyArray<{
    bounds: readonly [number, number, number, number];
  }>,
): boolean {
  if (candidates.length < 2) return false;
  const [first, second] = candidates;
  if (!first || !second) return false;
  return rectIou(first.bounds, second.bounds) < 0.1;
}

/**
 * 解析落地后的状态栏消息取舍：目标缺口（D-3「不替你猜」）优先于保护缺口
 * 与计划描述。此前缺口提示在同一次 setMessage 里被兜底计划描述覆盖，用户
 * 从未见过引导（E-1 真实浏览器 c3 实测回归）；纯函数化以便钉住取舍顺序。
 */
export function parseStatusMessage(input: {
  planDescription: string;
  targetGapPhrase: string | null;
  protectPhrase: string | null;
}): string {
  const { planDescription, targetGapPhrase, protectPhrase } = input;
  if (targetGapPhrase && protectPhrase) {
    return `${planDescription} 目标「${targetGapPhrase}」的位置不替你猜：点「智能找目标：${targetGapPhrase}」或「点击/画框限定」后画框圈选；保护范围「${protectPhrase}」待圈定：点下方「智能找保护框」，或用蒙版笔刷手画。`;
  }
  if (protectPhrase) {
    return `${planDescription} 保护范围「${protectPhrase}」待圈定：点下方「智能找保护框」，或用蒙版笔刷手画。`;
  }
  if (targetGapPhrase) {
    return `「${targetGapPhrase}」的目标位置不替你猜：点「智能找目标：${targetGapPhrase}」看本机视觉候选，或点「点击/画框限定」后在目标处画框圈选；也可以直接手动画框/套索。`;
  }
  return planDescription;
}
