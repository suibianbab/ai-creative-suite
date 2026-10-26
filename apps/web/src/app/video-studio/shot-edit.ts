import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import { reseedSpecParams, speechAwareDurationMs } from "./planner";

// 分镜编辑器纯逻辑（组件只做渲染/状态接线，行为在此可测）：
// 草稿构造 draftFromWorking、校验 buildRevisePatch、语速溢出 speechOverflowMs。

export type ShotEditDraft = {
  // 镜头说明（用户可读的画面意图，1..200）：随人工修订写入内容版本。
  description: string;
  narrationText: string;
  background: string;
  durationSeconds: number;
  title: string;
  subtitle: string;
  // 换一枚模板：应用时对 line-drawing / basic-shapes 用 seed+1 重抽 params。
  templateAdvanced: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

type WorkingLike = {
  narrationText: string;
  durationMs: number;
  description: string;
};

type TextParams = { title?: string; subtitle?: string };

// 旧镜头只在用户启用新版时序时升级组件版本；普通文案编辑保持 @1
// 的原始渲染。timeline @1 虽存有 enterMs，但历史渲染并不使用它。
export function applyDiagramTimingDraft(
  spec: SceneSpec,
  draft: Record<string, unknown>,
): SceneSpec {
  if (spec.componentId === "compare-split") {
    return {
      ...spec,
      componentVersion:
        draft.sequence !== undefined ? 2 : spec.componentVersion,
      params: draft,
    };
  }
  if (spec.componentId === "timeline-milestones") {
    return {
      ...spec,
      componentVersion:
        draft.sequence !== undefined ||
        draft.enterMs !== (spec.params as Record<string, unknown>).enterMs
          ? 2
          : spec.componentVersion,
      params: draft,
    };
  }
  return spec;
}

// 草稿初值：旁白/时长来自 working 版本，画面字段来自 spec。
export function draftFromWorking(
  working: WorkingLike,
  spec: SceneSpec,
): ShotEditDraft {
  const params = (
    spec.componentId === "text-animation" ? spec.params : {}
  ) as TextParams;
  return {
    // 不 trim：草稿是用户正在编辑的原文，校验留到应用时（attachDescription）。
    description: working.description,
    narrationText: working.narrationText,
    background: spec.background,
    durationSeconds: working.durationMs / 1000,
    title: params.title ?? "",
    subtitle: params.subtitle ?? "",
    templateAdvanced: false,
  };
}

// 说明附着（三个应用臂共用）：去首尾空白后校验 1..200，合法则并入 patch。
// 返回联合类型而非抛错：卡片要把错误显示在表单里（setEditError）。
export function attachDescription<T extends object>(
  patch: T,
  raw: string,
): { patch: T & { description: string } } | { error: string } {
  const description = raw.trim();
  if (description.length === 0) return { error: "镜头说明不能为空" };
  if (description.length > 200) return { error: "镜头说明不能超过 200 字符" };
  return { patch: { ...patch, description } };
}

// 草稿时长（秒）→ 文档毫秒：spec 与 3D 编辑臂共用同一校验口径
//（媒体臂的时长来自出入点，不走草稿秒数）。
export function draftDurationMs(
  draft: ShotEditDraft,
): { durationMs: number } | { error: string } {
  const durationMs = Math.round(draft.durationSeconds * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 600000) {
    return { error: "时长须在 0.001s–600s 之间" };
  }
  return { durationMs };
}

// 语速溢出（spec R5）：>0 表示旁白按语速估计超出当前时长草稿。
export function speechOverflowMs(draft: ShotEditDraft): number {
  const durationMs = Math.round(draft.durationSeconds * 1000);
  return speechAwareDurationMs(durationMs, draft.narrationText) - durationMs;
}

// 草稿 → 已校验 patch；有错误则 patch 为 null（文档不被碰）。
// 产出的 spec 仍属原组件、过 hex/时长边界，并在返回前过注册表整体校验
// （终评整改：超长标题等组件契约违规在此拦截，非法 spec 不进仅追加文档）。
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
  const duration = draftDurationMs(draft);
  if ("error" in duration) {
    return { patch: null, error: duration.error };
  }
  const durationMs = duration.durationMs;
  let seed = spec.seed;
  let params = spec.params;
  if (spec.componentId === "text-animation") {
    if (draft.title.trim().length === 0) {
      return { patch: null, error: "文字动画标题不能为空" };
    }
    const { subtitle: _prevSubtitle, ...rest } = spec.params as TextParams;
    // 清空副标题 = 移除键（终评整改：条件展开会让既有副标题删不掉）。
    params = draft.subtitle
      ? { ...rest, title: draft.title, subtitle: draft.subtitle }
      : { ...rest, title: draft.title };
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
  try {
    validateSceneSpec(nextSpec, defaultRegistry);
  } catch (error) {
    return {
      patch: null,
      error: error instanceof Error ? error.message : "场景参数不合法",
    };
  }
  return {
    patch: { narrationText: draft.narrationText, spec: nextSpec },
    error: null,
  };
}
