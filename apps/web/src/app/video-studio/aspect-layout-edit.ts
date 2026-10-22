import {
  type AspectLayoutContainer,
  defaultRegistry,
  lineChartLabelDisplay,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

// 双画幅版式覆写编辑（2026-10-23 brief §三B）：
// 草稿 = 表单原始字符串（空串 = 未设置）；apply 构造 spec.layout 并整体过
// validateSceneSpec（组件 validateLayout 深度校验），错误转中文文案返回卡片。
// 只做文字（text-animation）与折线图（line-chart）——brief 裁定先支持
// 一类真实压力案例，其余组件待暴露实际问题再扩。

export type TextOverrideFields = {
  titleLinesText: string; // 每行一条；空串 = 未设置
  titleScale: string; // 空 = 未设置
  verticalOffset: string; // 空 = 未设置
};

export type LineChartOverrideFields = {
  labelStepText: string; // 空 = 未设置
  shortLabels: Record<number, string>; // 值空串 = 未设置
};

export type LayoutEditDraft =
  | {
      componentId: "text-animation";
      portrait: TextOverrideFields;
      landscape: TextOverrideFields;
    }
  | {
      componentId: "line-chart";
      portrait: LineChartOverrideFields;
      landscape: LineChartOverrideFields;
    };

const EMPTY_TEXT: TextOverrideFields = {
  titleLinesText: "",
  titleScale: "",
  verticalOffset: "",
};
const EMPTY_LINE: LineChartOverrideFields = {
  labelStepText: "",
  shortLabels: {},
};

export function layoutDraftFromSpec(spec: SceneSpec): LayoutEditDraft {
  const layout = spec.layout;
  const aspect = layout?.portrait;
  const other = layout?.landscape;
  if (spec.componentId === "line-chart") {
    return {
      componentId: "line-chart",
      portrait: lineFieldsFrom(aspect),
      landscape: lineFieldsFrom(other),
    };
  }
  return {
    componentId: "text-animation",
    portrait: textFieldsFrom(aspect),
    landscape: textFieldsFrom(other),
  };
}

function textFieldsFrom(
  value: Record<string, unknown> | undefined,
): TextOverrideFields {
  if (!value) return { ...EMPTY_TEXT };
  const lines = value.titleLines;
  return {
    titleLinesText: Array.isArray(lines) ? lines.join("\n") : "",
    titleScale: value.titleScale === undefined ? "" : String(value.titleScale),
    verticalOffset:
      value.verticalOffset === undefined ? "" : String(value.verticalOffset),
  };
}

function lineFieldsFrom(
  value: Record<string, unknown> | undefined,
): LineChartOverrideFields {
  if (!value) return { labelStepText: "", shortLabels: {} };
  const shortLabels: Record<number, string> = {};
  if (Array.isArray(value.shortLabels)) {
    for (const entry of value.shortLabels as Array<{
      index: number;
      text: string;
    }>) {
      shortLabels[entry.index] = entry.text;
    }
  }
  return {
    labelStepText: value.labelStep === undefined ? "" : String(value.labelStep),
    shortLabels,
  };
}

type AspectBuild =
  | { value: Record<string, unknown>; error: null }
  | { value: null; error: string };

function parseNumberField(
  raw: string,
  label: string,
  min: number,
  max: number,
): number | null | string {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return `${label}须为 ${min}–${max} 的数`;
  }
  return parsed;
}

function buildTextAspect(fields: TextOverrideFields): AspectBuild {
  const value: Record<string, unknown> = {};
  if (fields.titleLinesText.trim() !== "") {
    value.titleLines = fields.titleLinesText.split(/\r?\n/);
  }
  const scale = parseNumberField(fields.titleScale, "字号缩放", 0.5, 1.3);
  if (typeof scale === "string") return { value: null, error: scale };
  if (scale !== null) value.titleScale = scale;
  const offset = parseNumberField(
    fields.verticalOffset,
    "垂直位置",
    -0.25,
    0.25,
  );
  if (typeof offset === "string") return { value: null, error: offset };
  if (offset !== null) value.verticalOffset = offset;
  return { value, error: null };
}

function buildLineAspect(
  fields: LineChartOverrideFields,
  points: number,
): AspectBuild {
  const value: Record<string, unknown> = {};
  if (fields.labelStepText.trim() !== "") {
    const step = Number(fields.labelStepText);
    if (!Number.isInteger(step) || step < 1 || step > Math.max(points, 1)) {
      return {
        value: null,
        error: `标签间隔须为 1–${Math.max(points, 1)} 的整数`,
      };
    }
    value.labelStep = step;
  }
  const entries = Object.entries(fields.shortLabels)
    .filter(([, text]) => text.trim() !== "")
    .map(([index, text]) => ({ index: Number(index), text }));
  if (entries.length > 0) value.shortLabels = entries;
  return { value, error: null };
}

// 草稿 → 新 spec：全空草稿移除 layout 键（回到自动布局）；否则构造容器并
// 过注册表整体校验（组件 validateLayout 的错误原样透出给表单）。
export function applyLayoutToSpec(
  spec: SceneSpec,
  draft: LayoutEditDraft,
): { spec: SceneSpec } | { error: string } {
  if (spec.componentId !== draft.componentId) {
    return { error: "当前镜头组件不支持该画幅微调" };
  }
  const points =
    draft.componentId === "line-chart"
      ? ((spec.params as { points?: unknown[] }).points?.length ?? 0)
      : 0;
  const build = (fields: TextOverrideFields | LineChartOverrideFields) =>
    draft.componentId === "text-animation"
      ? buildTextAspect(fields as TextOverrideFields)
      : buildLineAspect(fields as LineChartOverrideFields, points);
  const portrait = build(draft.portrait);
  if (portrait.error) return { error: portrait.error };
  const landscape = build(draft.landscape);
  if (landscape.error) return { error: landscape.error };
  let next: SceneSpec;
  if (
    Object.keys(portrait.value!).length === 0 &&
    Object.keys(landscape.value!).length === 0
  ) {
    const { layout: _removed, ...rest } = spec;
    next = rest as SceneSpec;
  } else {
    next = {
      ...spec,
      layout: {
        ...(Object.keys(portrait.value!).length > 0
          ? { portrait: portrait.value }
          : {}),
        ...(Object.keys(landscape.value!).length > 0
          ? { landscape: landscape.value }
          : {}),
      } as AspectLayoutContainer,
    };
  }
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "画幅覆写不合法",
    };
  }
  return { spec: next };
}

// 折线图标签提示数据（brief §三B「界面须提示哪些标签被隐藏或简写」）：
// 与渲染共用 lineChartLabelDisplay 同一口径。
export function describeLineChartLabels(
  params: { points: Array<{ label?: string; value: number }> },
  layout: AspectLayoutContainer | undefined,
  aspect: "portrait" | "landscape",
): {
  hidden: Array<{ index: number; label: string }>;
  truncated: Array<{ index: number; from: string; to: string }>;
  shortened: Array<{ index: number; from: string; to: string }>;
} {
  const override = layout?.[aspect] as
    | {
        labelStep?: number;
        shortLabels?: Array<{ index: number; text: string }>;
      }
    | undefined;
  const display = lineChartLabelDisplay(params.points, override);
  const shortByIndex = new Map(
    (override?.shortLabels ?? []).map((item) => [item.index, item.text]),
  );
  const hidden: Array<{ index: number; label: string }> = [];
  const truncated: Array<{ index: number; from: string; to: string }> = [];
  const shortened: Array<{ index: number; from: string; to: string }> = [];
  for (const item of display) {
    const label = item.label ?? "";
    if (!item.show) {
      hidden.push({ index: item.index, label });
      continue;
    }
    if (shortByIndex.has(item.index)) {
      shortened.push({ index: item.index, from: label, to: item.text });
    } else if (item.text !== label) {
      truncated.push({ index: item.index, from: label, to: item.text });
    }
  }
  return { hidden, truncated, shortened };
}

export const EMPTY_LAYOUT_DRAFTS = { text: EMPTY_TEXT, line: EMPTY_LINE };

// Content and layout are edited as one final spec. Intermediate template/chart/
// text builders validate their input, so the old layout must not be checked
// against new title/point data before the replacement draft is attached.
export function withoutLayoutForEdit(spec: SceneSpec): SceneSpec {
  const { layout: _oldLayout, ...base } = spec;
  return base;
}

// 应用修订时是否并入画幅覆写草稿（终评 Important#1 的决策收口）：
// - 已选组件模板（pendingTemplateId 非空）→ 换装即新视觉基底，旧覆写舍弃
//   （「浏览后改回保持当前组件」时 pendingTemplateId 归空 → 保留并入）。
// - 最终 spec 与草稿不同组件（家族换走）→ 不并入。
export function layoutMergeDecision(input: {
  pendingTemplateId: string;
  draftComponentId: string;
  finalComponentId: string;
}): boolean {
  return (
    input.pendingTemplateId === "" &&
    input.draftComponentId === input.finalComponentId
  );
}

// 折线图草稿的即时提示视图（输入中的非法值不提示，等 apply 时才报错）。
export function previewLineOverride(
  fields: LineChartOverrideFields,
  points: number,
):
  | {
      labelStep?: number;
      shortLabels?: Array<{ index: number; text: string }>;
    }
  | undefined {
  const built = buildLineAspect(fields, points);
  if (built.error || !built.value || Object.keys(built.value).length === 0) {
    return undefined;
  }
  return built.value as {
    labelStep?: number;
    shortLabels?: Array<{ index: number; text: string }>;
  };
}
