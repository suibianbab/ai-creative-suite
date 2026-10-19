// P2-① 数据可视化：图表起点模板与数据编辑纯逻辑（沿 shot-edit.ts 模式——
// 组件只做渲染/状态接线）。模板参数过 validateSceneSpec 兜底；非法数据行内
// 报错、不落 patch（沿转场 C1 语义：非法编辑不清文档）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";

export type ChartTemplate = {
  templateId: string;
  componentId: "bar-chart" | "line-chart" | "number-counter";
  label: string;
  params: Record<string, unknown>;
};

const BAR_COLORS = {
  barColor: "#2f6f4f",
  accentColor: "#d9822b",
  textColor: "#1b2c29",
};

export const CHART_TEMPLATES: ChartTemplate[] = [
  {
    templateId: "bar-compare-4",
    componentId: "bar-chart",
    label: "柱状对比（4 柱）",
    params: {
      title: "四种方案对比",
      bars: [
        { label: "甲", value: 30 },
        { label: "乙", value: 48 },
        { label: "丙", value: 22 },
        { label: "丁", value: 40 },
      ],
      ...BAR_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "bar-rank-6",
    componentId: "bar-chart",
    label: "柱状排行（6 柱）",
    params: {
      title: "各队伍得分排行",
      bars: [
        { label: "A队", value: 92 },
        { label: "B队", value: 78 },
        { label: "C队", value: 65 },
        { label: "D队", value: 51 },
        { label: "E队", value: 37 },
        { label: "F队", value: 22 },
      ],
      ...BAR_COLORS,
      enterMs: 1500,
    },
  },
  {
    templateId: "line-trend-8",
    componentId: "line-chart",
    label: "折线趋势（8 点）",
    params: {
      title: "年产量趋势",
      points: [
        { label: "第1年", value: 12 },
        { label: "第2年", value: 15 },
        { label: "第3年", value: 14 },
        { label: "第4年", value: 19 },
        { label: "第5年", value: 24 },
        { label: "第6年", value: 31 },
        { label: "第7年", value: 38 },
        { label: "第8年", value: 46 },
      ],
      lineColor: "#2f6f4f",
      markerColor: "#d9822b",
      textColor: "#1b2c29",
      drawMs: 1600,
    },
  },
  {
    templateId: "counter-kpi",
    componentId: "number-counter",
    label: "数字滚动 KPI",
    params: {
      title: "累计交付作品",
      value: 250000,
      prefix: "",
      suffix: "+",
      decimals: 0,
      countMs: 1800,
      numberColor: "#1b2c29",
      accentColor: "#2f6f4f",
    },
  },
  {
    templateId: "counter-percent",
    componentId: "number-counter",
    label: "百分比数字",
    params: {
      title: "一次通过率",
      value: 98.6,
      prefix: "",
      suffix: "%",
      decimals: 1,
      countMs: 1500,
      numberColor: "#1b2c29",
      accentColor: "#d9822b",
    },
  },
];

export function isChartComponentId(componentId: string): boolean {
  return (
    componentId === "bar-chart" ||
    componentId === "line-chart" ||
    componentId === "number-counter"
  );
}

export function applyChartTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  return applySceneTemplate(CHART_TEMPLATES, spec, templateId, "未知图表模板");
}

export type ChartEditDraft = {
  title: string; // 三组件共享
  data: string; // bar/line：每行 `标签,数值`（line 标签可省）
  value: string; // counter
  prefix: string; // counter
  suffix: string; // counter
};

type BarPoint = { label: string; value: number };
type LinePoint = { label?: string; value: number };

export function draftChartFromSpec(spec: SceneSpec): ChartEditDraft {
  const params = spec.params as {
    title?: string;
    bars?: BarPoint[];
    points?: LinePoint[];
    value?: number;
    prefix?: string;
    suffix?: string;
  };
  if (spec.componentId === "bar-chart") {
    return {
      title: params.title ?? "",
      data: (params.bars ?? []).map((b) => `${b.label},${b.value}`).join("\n"),
      value: "",
      prefix: "",
      suffix: "",
    };
  }
  if (spec.componentId === "line-chart") {
    return {
      title: params.title ?? "",
      data: (params.points ?? [])
        .map((p) =>
          p.label === undefined ? String(p.value) : `${p.label},${p.value}`,
        )
        .join("\n"),
      value: "",
      prefix: "",
      suffix: "",
    };
  }
  return {
    title: params.title ?? "",
    data: "",
    value: String(params.value ?? ""),
    prefix: params.prefix ?? "",
    suffix: params.suffix ?? "",
  };
}

// 行解析：以最后一个逗号分隔（标签自身可含逗号）；返回 null = 该行格式非法。
function parseDataLine(
  line: string,
): { label: string | null; value: number } | null {
  const idx = line.lastIndexOf(",");
  if (idx < 0) {
    const value = Number(line);
    return Number.isFinite(value) ? { label: null, value } : null;
  }
  const label = line.slice(0, idx).trim();
  const value = Number(line.slice(idx + 1).trim());
  if (label.length < 1 || !Number.isFinite(value)) return null;
  return { label, value };
}

export function buildChartRevisePatch(
  spec: SceneSpec,
  draft: ChartEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isChartComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是图表组件" };
  }
  const lines = draft.data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let params: Record<string, unknown>;
  if (spec.componentId === "bar-chart") {
    const bars: BarPoint[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseDataLine(lines[i]!);
      if (!parsed || parsed.label === null) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,数值 格式不符（标签 1..12 字符，数值 0..1e12）`,
        };
      }
      bars.push({ label: parsed.label, value: parsed.value });
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      bars,
    };
  } else if (spec.componentId === "line-chart") {
    const points: LinePoint[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseDataLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：数值 或 标签,数值 格式不符（数值 0..1e12）`,
        };
      }
      points.push(
        parsed.label === null
          ? { value: parsed.value }
          : { label: parsed.label, value: parsed.value },
      );
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      points,
    };
  } else {
    if (draft.value.trim() === "") {
      return { spec: null, error: "number-counter 数值不能为空" };
    }
    const value = Number(draft.value.trim());
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      value,
      prefix: draft.prefix,
      suffix: draft.suffix,
    };
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
