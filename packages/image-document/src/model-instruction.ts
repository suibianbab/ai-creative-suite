import type { ImageDocument } from "./index.js";
import {
  type ImageInstructionPlan,
  planImageInstruction,
} from "./instruction-planner.js";

/** The model may only translate prose into the local planner's supported grammar. */
export function planModelImageInstruction(
  document: ImageDocument,
  selectedId: string | null,
  response: unknown,
  createId: () => string,
): ImageInstructionPlan {
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error("AI 未返回有效的编辑计划。");
  const value = response as Record<string, unknown>;
  if (typeof value.unsupported !== "string" || !Array.isArray(value.clauses))
    throw new Error("AI 未返回有效的编辑计划。");
  if (value.unsupported.trim())
    throw new Error(
      `当前编辑器暂不支持：${value.unsupported.trim().slice(0, 100)}`,
    );
  if (
    value.clauses.length < 1 ||
    value.clauses.length > 4 ||
    !value.clauses.every(
      (item) => typeof item === "string" && item.length <= 100,
    )
  )
    throw new Error("AI 编辑计划的步骤无效。");
  const normalized = value.clauses.join("；");
  if (normalized.length > 240) throw new Error("AI 编辑计划过长，请缩短要求。");
  return planImageInstruction(document, selectedId, normalized, createId);
}
