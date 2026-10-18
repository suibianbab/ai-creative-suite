// P2-② 地图动画：地图起点模板与数据编辑纯逻辑（沿 chart-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type MapTemplate = {
  templateId: string;
  componentId: "map-grid" | "map-journey";
  label: string;
  params: Record<string, unknown>;
};

const GRID_COLORS = {
  baseColor: "#c9d7d2",
  highlightColor: "#2f6f4f",
  textColor: "#1b2c29",
};
const JOURNEY_COLORS = {
  routeColor: "#2f6f4f",
  markerColor: "#d9822b",
  pinColor: "#c0392b",
  textColor: "#1b2c29",
};

export const MAP_TEMPLATES: MapTemplate[] = [
  {
    templateId: "grid-china-6",
    componentId: "map-grid",
    label: "中国六分区示意",
    params: {
      title: "六大区分布示意",
      regions: [
        { label: "东北", row: 0, col: 0, value: 9 },
        { label: "华北", row: 0, col: 1, value: 32 },
        { label: "西北", row: 1, col: 0, value: 12 },
        { label: "华东", row: 1, col: 2, value: 45 },
        { label: "西南", row: 2, col: 1, value: 18 },
        { label: "华南", row: 2, col: 2, value: 28 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "grid-world-6",
    componentId: "map-grid",
    label: "世界六大区示意",
    params: {
      title: "世界大区示意",
      regions: [
        { label: "北美", row: 0, col: 0, value: 26 },
        { label: "欧洲", row: 0, col: 1, value: 30 },
        { label: "亚洲", row: 0, col: 2, value: 48 },
        { label: "南美", row: 1, col: 0, value: 16 },
        { label: "非洲", row: 1, col: 1, value: 22 },
        { label: "大洋", row: 1, col: 2, value: 8 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "grid-hotspot",
    componentId: "map-grid",
    label: "网格热点突出",
    params: {
      title: "重点区域突出",
      regions: [
        { label: "A区", row: 0, col: 0, value: 10 },
        { label: "B区", row: 0, col: 1, value: 8 },
        { label: "C区", row: 0, col: 2, value: 9 },
        { label: "D区", row: 1, col: 0, value: 50 },
        { label: "E区", row: 1, col: 1, value: 12 },
        { label: "F区", row: 1, col: 2, value: 11 },
      ],
      ...GRID_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "journey-route",
    componentId: "map-journey",
    label: "两城行程",
    params: {
      title: "两城行程",
      origin: { label: "北京", x: 240, y: 420 },
      destination: { label: "上海", x: 660, y: 720 },
      waypoints: [],
      ...JOURNEY_COLORS,
      drawMs: 1600,
    },
  },
  {
    templateId: "journey-multi",
    componentId: "map-journey",
    label: "多站行程",
    params: {
      title: "多站行程",
      origin: { label: "成都", x: 300, y: 560 },
      destination: { label: "上海", x: 700, y: 740 },
      waypoints: [
        { label: "西安", x: 430, y: 380 },
        { label: "武汉", x: 560, y: 560 },
      ],
      ...JOURNEY_COLORS,
      drawMs: 2000,
    },
  },
];

export function isMapComponentId(componentId: string): boolean {
  return componentId === "map-grid" || componentId === "map-journey";
}

export function applyMapTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = MAP_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知地图模板 ${templateId}` };
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

export type MapEditDraft = {
  title: string;
  // grid：每行 `标签,行,列[,数值]`；journey：每行 `名称,x,y`（首行起点、
  // 末行终点、中间途经；名称可省为裸 `x,y`）
  data: string;
};

export function draftMapFromSpec(spec: SceneSpec): MapEditDraft {
  const params = spec.params as {
    title?: string;
    regions?: Array<{
      label: string;
      row: number;
      col: number;
      value?: number;
    }>;
    origin?: { label: string; x: number; y: number };
    destination?: { label: string; x: number; y: number };
    waypoints?: Array<{ label?: string; x: number; y: number }>;
  };
  if (spec.componentId === "map-grid") {
    return {
      title: params.title ?? "",
      data: (params.regions ?? [])
        .map((r) =>
          r.value === undefined
            ? `${r.label},${r.row},${r.col}`
            : `${r.label},${r.row},${r.col},${r.value}`,
        )
        .join("\n"),
    };
  }
  const points = [
    params.origin ?? { label: "", x: 0, y: 0 },
    ...(params.waypoints ?? []),
    params.destination ?? { label: "", x: 0, y: 0 },
  ];
  return {
    title: params.title ?? "",
    data: points
      .map((p) =>
        p.label === undefined ? `${p.x},${p.y}` : `${p.label},${p.x},${p.y}`,
      )
      .join("\n"),
  };
}

// 行解析：从右取字段（标签自身可含逗号）。消歧规则（确定性）：
// 尾三字段全为合法数值（行/列 int 0..7、value 0..1e12）→ 带值读法
//   [.. label, row, col, value]；否则尾两字段合法 → 无值读法 [.. label, row, col]。
// 即「甲,0,1,2」读作 value=2 而非标签「甲,0」——文档化取舍。
function validRowCol(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 7;
}

function parseGridLine(
  line: string,
): { label: string; row: number; col: number; value?: number } | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const labelOf = (rest: string[]) => rest.join(",").trim();
  // 带值读法：[...label, row, col, value]（尾三全数值才成立）
  if (parts.length >= 4) {
    const row = Number(parts[parts.length - 3]!);
    const col = Number(parts[parts.length - 2]!);
    const value = Number(parts[parts.length - 1]!);
    const label = labelOf(parts.slice(0, -3));
    if (
      validRowCol(row) &&
      validRowCol(col) &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1e12 &&
      label.length >= 1 &&
      label.length <= 8
    ) {
      return { label, row, col, value };
    }
  }
  // 无值读法：[...label, row, col]
  const row = Number(parts[parts.length - 2]!);
  const col = Number(parts[parts.length - 1]!);
  const label = labelOf(parts.slice(0, -2));
  if (
    validRowCol(row) &&
    validRowCol(col) &&
    label.length >= 1 &&
    label.length <= 8
  ) {
    return { label, row, col };
  }
  return null;
}

function parseJourneyLine(
  line: string,
): { label: string | null; x: number; y: number } | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const y = Number(parts.pop()!);
  const x = Number(parts.pop()!);
  const label = parts.length > 0 ? parts.join(",").trim() : "";
  if (label.length > 8) return null;
  if (!Number.isFinite(x) || x < 0 || x > 1000) return null;
  if (!Number.isFinite(y) || y < 0 || y > 1000) return null;
  return { label: label.length > 0 ? label : null, x, y };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildMapRevisePatch(
  spec: SceneSpec,
  draft: MapEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isMapComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是地图组件" };
  }
  const lines = splitLines(draft.data);
  let params: Record<string, unknown>;
  if (spec.componentId === "map-grid") {
    if (lines.length < 1) {
      return { spec: null, error: "地图数据至少需要一行" };
    }
    if (lines.length > 24) {
      return { spec: null, error: "地图数据最多 24 行（区域上限）" };
    }
    const regions: Array<{
      label: string;
      row: number;
      col: number;
      value?: number;
    }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseGridLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,行,列[,数值] 格式不符（标签 1..8 字符，行/列 0..7 整数，数值 0..1e12）`,
        };
      }
      regions.push(parsed);
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      regions,
    };
  } else {
    if (lines.length < 2) {
      return { spec: null, error: "行程数据至少需要起终点两行" };
    }
    if (lines.length > 8) {
      return { spec: null, error: "行程数据最多 8 行（起终点 + 途经点上限）" };
    }
    const points = [];
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseJourneyLine(lines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：名称,x,y 或 x,y 格式不符（名称 ≤8 字符，坐标 0..1000）`,
        };
      }
      points.push(parsed);
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.label === null) {
      return { spec: null, error: "第 1 行：起点名称不能为空" };
    }
    if (last.label === null) {
      return {
        spec: null,
        error: `第 ${lines.length} 行：终点名称不能为空`,
      };
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      origin: { label: first.label, x: first.x, y: first.y },
      waypoints: points
        .slice(1, -1)
        .map((p) =>
          p.label === null
            ? { x: p.x, y: p.y }
            : { label: p.label, x: p.x, y: p.y },
        ),
      destination: { label: last.label, x: last.x, y: last.y },
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
