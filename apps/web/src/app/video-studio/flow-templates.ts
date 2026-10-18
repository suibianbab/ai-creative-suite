// P2-③ 流程图/示意图：流程起点模板与数据编辑纯逻辑（沿 map-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type FlowTemplate = {
  templateId: string;
  componentId: "flow-steps" | "flow-diagram";
  label: string;
  params: Record<string, unknown>;
};

const FLOW_COLORS = {
  boxColor: "#dcebe1",
  arrowColor: "#2f6f4f",
  textColor: "#1b2c29",
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    templateId: "steps-4",
    componentId: "flow-steps",
    label: "横向四步流程",
    params: {
      title: "四步流程",
      steps: [
        { label: "需求" },
        { label: "设计" },
        { label: "开发" },
        { label: "交付" },
      ],
      direction: "horizontal",
      ...FLOW_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "steps-v-5",
    componentId: "flow-steps",
    label: "纵向五阶段",
    params: {
      title: "五阶段推进",
      steps: [
        { label: "立项" },
        { label: "调研" },
        { label: "方案" },
        { label: "实施" },
        { label: "复盘" },
      ],
      direction: "vertical",
      ...FLOW_COLORS,
      enterMs: 1200,
    },
  },
  {
    templateId: "flow-decision",
    componentId: "flow-diagram",
    label: "判定分支",
    params: {
      title: "判定分支",
      nodes: [
        { label: "开始", x: 200, y: 520, kind: "box" },
        { label: "检查", x: 500, y: 520, kind: "diamond" },
        { label: "通过", x: 820, y: 400, kind: "box" },
        { label: "退回", x: 820, y: 660, kind: "box" },
      ],
      edges: [
        { from: "开始", to: "检查" },
        { from: "检查", to: "通过", label: "是" },
        { from: "检查", to: "退回", label: "否" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
  {
    templateId: "flow-cycle",
    componentId: "flow-diagram",
    label: "三节点循环",
    params: {
      title: "循环闭环",
      nodes: [
        { label: "谋划", x: 300, y: 350, kind: "box" },
        { label: "执行", x: 700, y: 350, kind: "box" },
        { label: "改进", x: 500, y: 720, kind: "box" },
      ],
      edges: [
        { from: "谋划", to: "执行" },
        { from: "执行", to: "改进" },
        { from: "改进", to: "谋划" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
  {
    templateId: "flow-compare",
    componentId: "flow-diagram",
    label: "两源对比",
    params: {
      title: "两案对比",
      nodes: [
        { label: "方案甲", x: 280, y: 350, kind: "box" },
        { label: "方案乙", x: 280, y: 720, kind: "box" },
        { label: "评估", x: 730, y: 520, kind: "box" },
      ],
      edges: [
        { from: "方案甲", to: "评估" },
        { from: "方案乙", to: "评估" },
      ],
      ...FLOW_COLORS,
      enterMs: 1000,
      drawMs: 800,
    },
  },
];

export function isFlowComponentId(componentId: string): boolean {
  return componentId === "flow-steps" || componentId === "flow-diagram";
}

export function applyFlowTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = FLOW_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知流程模板 ${templateId}` };
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

export type FlowEditDraft = {
  title: string;
  // steps：每行一个步骤标签（2..8 行）；diagram：节点段每行
  // `标签,x,y[,菱形]`（缺省 box），`---` 单独一行分隔，边段每行
  // `标签->标签[,边标]`
  data: string;
};

export function draftFlowFromSpec(spec: SceneSpec): FlowEditDraft {
  const params = spec.params as {
    title?: string;
    steps?: Array<{ label: string }>;
    nodes?: Array<{
      label: string;
      x: number;
      y: number;
      kind: "box" | "diamond";
    }>;
    edges?: Array<{ from: string; to: string; label?: string }>;
  };
  if (spec.componentId === "flow-steps") {
    return {
      title: params.title ?? "",
      data: (params.steps ?? []).map((s) => s.label).join("\n"),
    };
  }
  const nodeLines = (params.nodes ?? []).map((n) =>
    n.kind === "diamond"
      ? `${n.label},${n.x},${n.y},菱形`
      : `${n.label},${n.x},${n.y}`,
  );
  const edgeLines = (params.edges ?? []).map((e) =>
    e.label === undefined ? `${e.from}->${e.to}` : `${e.from}->${e.to},${e.label}`,
  );
  return {
    title: params.title ?? "",
    data: [...nodeLines, "---", ...edgeLines].join("\n"),
  };
}

// 节点行从右取字段（标签可含逗号——同 map-templates 消歧先例）：
// 末段恰为「菱形」且倒数第二/三段为坐标 → 菱形节点 [.. label, x, y, 菱形]；
// 否则尾两段数值 → 盒节点 [.. label, x, y]。`菱形,200,520`（3 段）读作
// 盒节点标签「菱形」——文档化取舍。
function parseNodeLine(
  line: string,
): { label: string; x: number; y: number; kind: "box" | "diamond" } | null {
  const parts = line.split(",").map((p) => p.trim());
  const coord = (raw: string): number | null => {
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : null;
  };
  if (parts.length >= 4 && parts[parts.length - 1] === "菱形") {
    const y = coord(parts[parts.length - 2]!);
    const x = coord(parts[parts.length - 3]!);
    const label = parts.slice(0, -3).join(",").trim();
    if (x === null || y === null) return null;
    if (label.length < 1 || label.length > 6) return null;
    return { label, x, y, kind: "diamond" };
  }
  if (parts.length >= 3) {
    const y = coord(parts[parts.length - 1]!);
    const x = coord(parts[parts.length - 2]!);
    const label = parts.slice(0, -2).join(",").trim();
    if (x === null || y === null) return null;
    if (label.length < 1 || label.length > 6) return null;
    return { label, x, y, kind: "box" };
  }
  return null;
}

// 边行：首个 `->` 前为 from；右侧从右消歧——多段时末段为边标、其余 join
// 为 to；单段即 to（无边标）。`甲->乙,丙` 读 to=乙、边标=丙（文档化取舍，
// 同 map 尾段消歧先例）。
function parseEdgeLine(
  line: string,
): { from: string; to: string; label?: string } | null {
  const arrow = line.indexOf("->");
  if (arrow < 1) return null;
  const from = line.slice(0, arrow).trim();
  const tailParts = line
    .slice(arrow + 2)
    .split(",")
    .map((p) => p.trim());
  let to: string;
  let label: string | undefined;
  if (tailParts.length === 1) {
    to = tailParts[0]!;
  } else {
    to = tailParts.slice(0, -1).join(",").trim();
    label = tailParts[tailParts.length - 1]!;
  }
  if (from.length < 1 || from.length > 6) return null;
  if (to.length < 1 || to.length > 6) return null;
  if (label !== undefined && (label.length < 1 || label.length > 6)) return null;
  return label === undefined ? { from, to } : { from, to, label };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildFlowRevisePatch(
  spec: SceneSpec,
  draft: FlowEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isFlowComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是流程组件" };
  }
  const lines = splitLines(draft.data);
  let params: Record<string, unknown>;
  if (spec.componentId === "flow-steps") {
    if (lines.length < 2) {
      return { spec: null, error: "流程步骤至少需要两行" };
    }
    if (lines.length > 8) {
      return { spec: null, error: "流程步骤最多 8 行（步数上限）" };
    }
    const steps: Array<{ label: string }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const label = lines[i]!;
      if (label.length < 1 || label.length > 10) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：步骤标签必须是 1..10 个字符`,
        };
      }
      steps.push({ label });
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      steps,
    };
  } else {
    const sep = lines.indexOf("---");
    if (sep < 0) {
      return { spec: null, error: "数据需用一行「---」分隔节点段与边段" };
    }
    const nodeLines = lines.slice(0, sep);
    const edgeLines = lines.slice(sep + 1);
    if (nodeLines.length < 2) {
      return { spec: null, error: "节点段至少需要两行" };
    }
    if (nodeLines.length > 12) {
      return { spec: null, error: "节点段最多 12 行（节点上限）" };
    }
    if (edgeLines.length < 1) {
      return { spec: null, error: "边段至少需要一行" };
    }
    if (edgeLines.length > 16) {
      return { spec: null, error: "边段最多 16 行（连线上限）" };
    }
    const nodes: Array<{
      label: string;
      x: number;
      y: number;
      kind: "box" | "diamond";
    }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < nodeLines.length; i += 1) {
      const parsed = parseNodeLine(nodeLines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：标签,x,y[,菱形] 格式不符（标签 1..6 字符，坐标 0..1000）`,
        };
      }
      if (seen.has(parsed.label)) {
        return {
          spec: null,
          error: `第 ${i + 1} 行：节点标签「${parsed.label}」重复`,
        };
      }
      seen.add(parsed.label);
      nodes.push(parsed);
    }
    const edges: Array<{ from: string; to: string; label?: string }> = [];
    for (let i = 0; i < edgeLines.length; i += 1) {
      // 行号按整段数据计（含 --- 行）
      const lineNo = sep + 2 + i;
      const parsed = parseEdgeLine(edgeLines[i]!);
      if (!parsed) {
        return {
          spec: null,
          error: `第 ${lineNo} 行：标签->标签[,边标] 格式不符（标签 1..6 字符，边标 1..6 字符）`,
        };
      }
      if (!seen.has(parsed.from)) {
        return {
          spec: null,
          error: `第 ${lineNo} 行：节点「${parsed.from}」未声明`,
        };
      }
      if (!seen.has(parsed.to)) {
        return { spec: null, error: `第 ${lineNo} 行：节点「${parsed.to}」未声明` };
      }
      edges.push(parsed);
    }
    params = {
      ...(spec.params as Record<string, unknown>),
      title: draft.title,
      nodes,
      edges,
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
