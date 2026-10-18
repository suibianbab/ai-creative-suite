// P2-⑥ 加载：起点模板与标量数据编辑纯逻辑（沿 chart-templates 的 counter
// 先例用标量输入而非多行 textarea）。模板参数过 validateSceneSpec 兜底；
// 非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type LoadingTemplate = {
  templateId: string;
  componentId: "loading-dots" | "loading-progress";
  label: string;
  params: Record<string, unknown>;
};

const LOADING_COLORS = {
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
};

export const LOADING_TEMPLATES: LoadingTemplate[] = [
  {
    templateId: "loading-dots-3",
    componentId: "loading-dots",
    label: "三点等待",
    params: {
      title: "加载等待",
      label: "加载中",
      dots: 3,
      ...LOADING_COLORS,
      cycleMs: 720,
    },
  },
  {
    templateId: "loading-dots-5",
    componentId: "loading-dots",
    label: "五点序列",
    params: {
      title: "处理进行中",
      label: "正在处理",
      dots: 5,
      ...LOADING_COLORS,
      cycleMs: 960,
    },
  },
  {
    templateId: "loading-ring-full",
    componentId: "loading-progress",
    label: "进度环·完成",
    params: {
      title: "加载完成",
      label: "数据就绪",
      targetPercent: 100,
      ...LOADING_COLORS,
      progressMs: 1600,
    },
  },
  {
    templateId: "loading-ring-72",
    componentId: "loading-progress",
    label: "进度环·进行中",
    params: {
      title: "加载进度",
      label: "加载资料",
      targetPercent: 72,
      ...LOADING_COLORS,
      progressMs: 1600,
    },
  },
  {
    templateId: "loading-ring-30",
    componentId: "loading-progress",
    label: "进度环·起步",
    params: {
      title: "开始加载",
      label: "正在启动",
      targetPercent: 30,
      ...LOADING_COLORS,
      progressMs: 1200,
    },
  },
];

export function isLoadingComponentId(componentId: string): boolean {
  return componentId === "loading-dots" || componentId === "loading-progress";
}

export function applyLoadingTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = LOADING_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知加载模板 ${templateId}` };
  const next: SceneSpec = {
    ...spec,
    componentId: template.componentId,
    componentVersion: 1,
    params: structuredClone(template.params),
  };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { spec: next, error: null };
}

export type LoadingEditDraft = {
  title: string;
  label: string;
  // dots 组件的点数（3..6）/ progress 组件的目标百分比（1..100）——
  // 表单字符串，应用时解析；不适用侧保持空串
  count: string;
  target: string;
};

export function draftLoadingFromSpec(spec: SceneSpec): LoadingEditDraft {
  const params = spec.params as {
    title?: string;
    label?: string;
    dots?: number;
    targetPercent?: number;
  };
  return {
    title: params.title ?? "",
    label: params.label ?? "",
    count: spec.componentId === "loading-dots" ? String(params.dots ?? "") : "",
    target:
      spec.componentId === "loading-progress"
        ? String(params.targetPercent ?? "")
        : "",
  };
}

const MAX_LABEL = 12;
const ASCII_INT = /^[0-9]+$/;

// 只认 ASCII 整数字面量：拒全角数字/小数/十六进制/空串（Number("")=0 陷阱
// 由 regex 先拦，范围再兜底）
function parseIntField(value: string): number | null {
  const trimmed = value.trim();
  if (!ASCII_INT.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildLoadingRevisePatch(
  spec: SceneSpec,
  draft: LoadingEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isLoadingComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是加载组件" };
  }
  const labelChars = Array.from(draft.label.trim());
  if (labelChars.length < 1 || labelChars.length > MAX_LABEL) {
    return { spec: null, error: `状态文案必须是 1..${MAX_LABEL} 个字符` };
  }
  const params: Record<string, unknown> = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    label: labelChars.join(""),
  };
  if (spec.componentId === "loading-dots") {
    const dots = parseIntField(draft.count);
    if (dots === null || dots < 3 || dots > 6) {
      return { spec: null, error: "点数必须是 3..6 的整数" };
    }
    params.dots = dots;
  } else {
    const target = parseIntField(draft.target);
    if (target === null || target < 1 || target > 100) {
      return { spec: null, error: "目标百分比必须是 1..100 的整数" };
    }
    params.targetPercent = target;
  }
  const next: SceneSpec = { ...spec, params };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { spec: next, error: null };
}
