import type { SceneSpec } from "@acs/video-scene";
import { reseedSpecParams, speechAwareDurationMs } from "./planner.js";

// 分镜编辑器纯逻辑（组件只做渲染/状态接线，行为在此可测）：
// 草稿构造 draftFromWorking、校验 buildRevisePatch、语速溢出 speechOverflowMs。

export type ShotEditDraft = {
  narrationText: string;
  background: string;
  durationSeconds: number;
  title: string;
  subtitle: string;
  // 换一枚模板：应用时对 line-drawing / basic-shapes 用 seed+1 重抽 params。
  templateAdvanced: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

type WorkingLike = { narrationText: string; durationMs: number };

type TextParams = { title?: string; subtitle?: string };

// 草稿初值：旁白/时长来自 working 版本，画面字段来自 spec。
export function draftFromWorking(
  working: WorkingLike,
  spec: SceneSpec,
): ShotEditDraft {
  const params = (
    spec.componentId === "text-animation" ? spec.params : {}
  ) as TextParams;
  return {
    narrationText: working.narrationText,
    background: spec.background,
    durationSeconds: working.durationMs / 1000,
    title: params.title ?? "",
    subtitle: params.subtitle ?? "",
    templateAdvanced: false,
  };
}

// 语速溢出（spec R5）：>0 表示旁白按语速估计超出当前时长草稿。
export function speechOverflowMs(draft: ShotEditDraft): number {
  const durationMs = Math.round(draft.durationSeconds * 1000);
  return speechAwareDurationMs(durationMs, draft.narrationText) - durationMs;
}

// 草稿 → 已校验 patch；有错误则 patch 为 null（文档不被碰）。
// 产出的 spec 仍属原组件、过 hex/时长边界；调用方负责整体落库前校验。
export function buildRevisePatch(
  draft: ShotEditDraft,
  spec: SceneSpec,
): {
  patch: { narrationText?: string; spec?: unknown } | null;
  error: string | null;
} {
  if (!HEX.test(draft.background)) {
    return { patch: null, error: "背景色须为 #rrggbb 六位十六进制" };
  }
  const durationMs = Math.round(draft.durationSeconds * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 600000) {
    return { patch: null, error: "时长须在 0.001s–600s 之间" };
  }
  let seed = spec.seed;
  let params = spec.params;
  if (spec.componentId === "text-animation") {
    if (draft.title.trim().length === 0) {
      return { patch: null, error: "文字动画标题不能为空" };
    }
    const prev = spec.params as TextParams;
    params = {
      ...prev,
      title: draft.title,
      ...(draft.subtitle ? { subtitle: draft.subtitle } : {}),
    };
  } else if (draft.templateAdvanced) {
    seed = spec.seed + 1;
    params = reseedSpecParams(spec, seed).params;
  }
  const nextSpec: SceneSpec = {
    ...spec,
    seed,
    background: draft.background,
    durationMs,
    params,
  };
  return {
    patch: { narrationText: draft.narrationText, spec: nextSpec },
    error: null,
  };
}
