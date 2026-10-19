// P2-⑤ 手绘：起点模板与数据编辑纯逻辑（沿 stick-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";

export type SketchTemplate = {
  templateId: string;
  componentId: "sketch-note";
  label: string;
  params: Record<string, unknown>;
};

const SKETCH_COLORS = {
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
};

export const SKETCH_TEMPLATES: SketchTemplate[] = [
  {
    templateId: "sketch-underline-3",
    componentId: "sketch-note",
    label: "三要点下划线",
    params: {
      title: "三大要点",
      items: [
        { text: "要点一", emphasis: "下划线" },
        { text: "要点二", emphasis: "下划线" },
        { text: "要点三", emphasis: "下划线" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-circle-key",
    componentId: "sketch-note",
    label: "关键词画圈",
    params: {
      title: "关键要点",
      items: [
        { text: "核心结论", emphasis: "圈" },
        { text: "支撑依据", emphasis: "下划线" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-list-5",
    componentId: "sketch-note",
    label: "五条手写清单",
    params: {
      title: "行动清单",
      items: [
        { text: "做计划", emphasis: "无" },
        { text: "勤记录", emphasis: "无" },
        { text: "常复盘", emphasis: "无" },
        { text: "多输出", emphasis: "无" },
        { text: "重迭代", emphasis: "无" },
      ],
      ...SKETCH_COLORS,
      writeMs: 400,
      drawMs: 360,
      staggerMs: 200,
    },
  },
  {
    templateId: "sketch-highlight-mix",
    componentId: "sketch-note",
    label: "混排强调",
    params: {
      title: "混合强调",
      items: [
        { text: "重点结论", emphasis: "下划线" },
        { text: "关键数字", emphasis: "圈" },
        { text: "补充说明", emphasis: "无" },
      ],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
  {
    templateId: "sketch-one-word",
    componentId: "sketch-note",
    label: "单关键词大圈",
    params: {
      title: "一句话结论",
      items: [{ text: "增长 300%", emphasis: "圈" }],
      ...SKETCH_COLORS,
      writeMs: 480,
      drawMs: 420,
      staggerMs: 240,
    },
  },
];

export function isSketchComponentId(componentId: string): boolean {
  return componentId === "sketch-note";
}

export function applySketchTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  return applySceneTemplate(SKETCH_TEMPLATES, spec, templateId, "未知手绘模板");
}

export type SketchEditDraft = {
  title: string;
  // 每行一条 `文本[,下划线|圈]`——从右取字段：末段恰为强调词读强调，
  // 否则整行是文本（文本可含逗号）；强调缺省 = 无
  data: string;
};

export function draftSketchFromSpec(spec: SceneSpec): SketchEditDraft {
  const params = spec.params as {
    title?: string;
    items?: Array<{ text: string; emphasis: string }>;
  };
  return {
    title: params.title ?? "",
    data: (params.items ?? [])
      .map((item) =>
        item.emphasis === "无" ? item.text : `${item.text},${item.emphasis}`,
      )
      .join("\n"),
  };
}

const EMPHASIS_WORDS = new Set(["下划线", "圈", "无"]);
const MAX_ITEMS = 5;
const MAX_TEXT = 12;

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// 从右取字段：最后一个逗号后的段是强调词则剥离（idx>0 保证文本非空前缀），
// 否则整行为文本
function parseItemLine(line: string): { text: string; emphasis: string } {
  const idx = line.lastIndexOf(",");
  if (idx > 0) {
    const tail = line.slice(idx + 1).trim();
    if (EMPHASIS_WORDS.has(tail)) {
      return { text: line.slice(0, idx).trim(), emphasis: tail };
    }
  }
  return { text: line, emphasis: "无" };
}

export function buildSketchRevisePatch(
  spec: SceneSpec,
  draft: SketchEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isSketchComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是手绘组件" };
  }
  const lines = splitLines(draft.data);
  if (lines.length < 1) {
    return { spec: null, error: "手绘至少需要一行（1 条文本）" };
  }
  if (lines.length > MAX_ITEMS) {
    return { spec: null, error: `手绘最多 ${MAX_ITEMS} 行（条目上限）` };
  }
  const items: Array<{ text: string; emphasis: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseItemLine(lines[i]!);
    const chars = Array.from(parsed.text);
    if (chars.length < 1 || chars.length > MAX_TEXT) {
      return {
        spec: null,
        error: `第 ${i + 1} 行：文本必须是 1..${MAX_TEXT} 个字符`,
      };
    }
    items.push(parsed);
  }
  const params = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    items,
  };
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
