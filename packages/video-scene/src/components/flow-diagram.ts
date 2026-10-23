import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 节点连线示意图 v1：节点（盒子 180×72 / 菱形判定 110×64 半对角，显式
// x,y）按声明序 i×120ms 弹入（scale 1.4→1 + 淡入）；边按节点标签引用，
// 两端落定后在 drawMs 窗口线性描画（pathLength=1 + dashoffset，同
// line-drawing 口径）并带箭头三角；边标随描画完成淡入。边端点按中心
// 连线方向收缩固定余量 100（近圆近似——菱形角部略有出入，确定性优先，
// spec 裁定）；近距（len<220）改按 (len−20)/2 收缩钳 0，重合（len=0）
// 守卫为 len=1 输出退化线段，不产生 NaN。1000×1000 设计空间嵌套 svg
// viewBox；render 纯函数，禁墙钟/随机/网络。

type FlowNode = {
  label: string;
  x: number;
  y: number;
  kind: "box" | "diamond";
};
type FlowDiagramParams = {
  title: string;
  nodes: FlowNode[];
  edges: Array<{ from: string; to: string; label?: string }>;
  boxColor: string;
  arrowColor: string;
  textColor: string;
  nodeTextColor?: string;
  enterMs: number; // 200..6000
  drawMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const BOX_W = 180;
const BOX_H = 72;
const DIA_HW = 110;
const DIA_HH = 64;
const EDGE_TRIM = 100;
const NEAR_LEN = 220;
const STAGGER_MS = 120;
const ARROWHEAD_MS = 160;
const EDGE_LABEL_FADE_MS = 240;
const MAX_NODES = 12;
const MAX_EDGES = 16;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function readableLegacyNodeColor(text: string, box: string): string {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (
      channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    );
  };
  const boxLum = luminance(box);
  const textLum = luminance(text);
  if (
    (Math.max(boxLum, textLum) + 0.05) / (Math.min(boxLum, textLum) + 0.05) >=
    4.5
  )
    return text;
  return boxLum > 0.179 ? "#000000" : "#ffffff";
}

function validateParams(value: unknown): FlowDiagramParams {
  if (!isRecord(value)) throw new Error("flow-diagram params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("flow-diagram params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length < 2 ||
    value.nodes.length > MAX_NODES
  ) {
    throw new Error(
      `flow-diagram params.nodes 必须是 2..${MAX_NODES} 个 {label, x, y, kind}`,
    );
  }
  const seen = new Set<string>();
  value.nodes.forEach((node, i) => {
    if (!isRecord(node)) {
      throw new Error(`flow-diagram params.nodes[${i}] 必须是对象`);
    }
    if (
      typeof node.label !== "string" ||
      node.label.length < 1 ||
      node.label.length > 6
    ) {
      throw new Error(
        `flow-diagram params.nodes[${i}].label 必须是 1..6 个字符`,
      );
    }
    if (seen.has(node.label)) {
      throw new Error(
        `flow-diagram params.nodes[${i}].label 与 nodes[${[...seen].indexOf(node.label)}] 重复`,
      );
    }
    seen.add(node.label);
    for (const key of ["x", "y"] as const) {
      const v = node[key];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > COORD_MAX
      ) {
        throw new Error(
          `flow-diagram params.nodes[${i}].x / y 必须是 0..1000 的数`,
        );
      }
    }
    if (node.kind !== "box" && node.kind !== "diamond") {
      throw new Error(
        `flow-diagram params.nodes[${i}].kind 必须是 box 或 diamond`,
      );
    }
  });
  if (
    !Array.isArray(value.edges) ||
    value.edges.length < 1 ||
    value.edges.length > MAX_EDGES
  ) {
    throw new Error(
      `flow-diagram params.edges 必须是 1..${MAX_EDGES} 条 {from, to, label?}`,
    );
  }
  value.edges.forEach((edge, i) => {
    if (!isRecord(edge)) {
      throw new Error(`flow-diagram params.edges[${i}] 必须是对象`);
    }
    for (const key of ["from", "to"] as const) {
      if (typeof edge[key] !== "string" || !seen.has(edge[key])) {
        throw new Error(
          `flow-diagram params.edges[${i}].from/to 必须引用已声明节点`,
        );
      }
    }
    if (
      edge.label !== undefined &&
      (typeof edge.label !== "string" ||
        edge.label.length < 1 ||
        edge.label.length > 6)
    ) {
      throw new Error(`flow-diagram params.edges[${i}].label 必须是 ≤6 个字符`);
    }
  });
  for (const key of ["boxColor", "arrowColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`flow-diagram params.${key} 必须是 #rrggbb`);
    }
  }
  if (value.nodeTextColor !== undefined && !isHexColor(value.nodeTextColor)) {
    throw new Error("flow-diagram params.nodeTextColor 必须是 #rrggbb");
  }
  for (const key of ["enterMs", "drawMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`flow-diagram params.${key} 必须是 200..6000 的整数`);
    }
  }
  return value as FlowDiagramParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as FlowDiagramParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const delays = new Map<string, number>(
    params.nodes.map((node, i) => [node.label, i * STAGGER_MS]),
  );
  const byLabel = new Map<string, FlowNode>(
    params.nodes.map((node) => [node.label, node]),
  );

  const nodeGroups: SvgNode[] = params.nodes.map((node, i) => {
    const appear = easeOutCubic(
      clamp01((tMs - i * STAGGER_MS) / params.enterMs),
    );
    const fontSize = fitFontSize(
      22,
      node.label,
      node.kind === "diamond" ? 150 : BOX_W - 24,
    );
    const shape: SvgNode =
      node.kind === "box"
        ? {
            tag: "rect",
            attrs: {
              x: -BOX_W / 2,
              y: -BOX_H / 2,
              width: BOX_W,
              height: BOX_H,
              rx: 10,
              fill: params.boxColor,
            },
          }
        : {
            tag: "polygon",
            attrs: {
              points: `${-DIA_HW},0 0,${-DIA_HH} ${DIA_HW},0 0,${DIA_HH}`,
              fill: params.boxColor,
            },
          };
    return {
      tag: "g",
      attrs: {
        // 弹入：scale 1.4 → 1（绕节点中心）
        transform: `translate(${node.x} ${node.y}) scale(${(1.4 - 0.4 * appear).toFixed(4)})`,
        opacity: appear,
      },
      children: [
        shape,
        {
          tag: "text",
          attrs: {
            x: 0,
            y: fontSize * 0.36,
            "font-size": fontSize,
            fill:
              params.nodeTextColor ??
              readableLegacyNodeColor(params.textColor, params.boxColor),
            "text-anchor": "middle",
          },
          text: node.label,
        },
      ],
    };
  });

  const edgePaths: SvgNode[] = [];
  const edgeHeads: SvgNode[] = [];
  const edgeLabels: SvgNode[] = [];
  for (const edge of params.edges) {
    const a = byLabel.get(edge.from)!;
    const b = byLabel.get(edge.to)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // 重合守卫：len=0 → 1（退化线段，不除零）
    const len = Math.hypot(dx, dy) || 1;
    // 近圆近似收缩：常规 100；近距 (len−20)/2 钳 0（两端各让 10）
    const trim = len < NEAR_LEN ? Math.max((len - 20) / 2, 0) : EDGE_TRIM;
    const ux = dx / len;
    const uy = dy / len;
    const sx = a.x + ux * trim;
    const sy = a.y + uy * trim;
    const ex = b.x - ux * trim;
    const ey = b.y - uy * trim;
    // 两端节点都落定后开始描画
    const startT =
      Math.max(delays.get(edge.from)!, delays.get(edge.to)!) + params.enterMs;
    const p = clamp01((tMs - startT) / params.drawMs);
    edgePaths.push({
      tag: "path",
      attrs: {
        d: `M ${sx.toFixed(2)},${sy.toFixed(2)} L ${ex.toFixed(2)},${ey.toFixed(2)}`,
        fill: "none",
        stroke: params.arrowColor,
        "stroke-width": 8,
        "stroke-linecap": "round",
        pathLength: 1,
        "stroke-dasharray": 1,
        "stroke-dashoffset": Number((1 - p).toFixed(4)),
      },
    });
    // 箭头三角：tip=end，base=end−u×14，两侧 (−uy,ux)×7
    const bx = ex - ux * 14;
    const by = ey - uy * 14;
    const px = -uy * 7;
    const py = ux * 7;
    edgeHeads.push({
      tag: "polygon",
      attrs: {
        points: `${ex.toFixed(2)},${ey.toFixed(2)} ${(bx + px).toFixed(2)},${(by + py).toFixed(2)} ${(bx - px).toFixed(2)},${(by - py).toFixed(2)}`,
        fill: params.arrowColor,
        opacity: clamp01((tMs - startT - params.drawMs) / ARROWHEAD_MS),
      },
    });
    if (edge.label !== undefined) {
      edgeLabels.push({
        tag: "text",
        attrs: {
          x: (sx + ex) / 2,
          y: (sy + ey) / 2 - 24,
          "font-size": fitFontSize(20, edge.label, 200),
          fill: params.textColor,
          "text-anchor": "middle",
          opacity: clamp01(
            (tMs - startT - params.drawMs - ARROWHEAD_MS) / EDGE_LABEL_FADE_MS,
          ),
        },
        text: edge.label,
      });
    }
  }

  return {
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "rect",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          fill: spec.background,
        },
      },
      {
        tag: "svg",
        attrs: {
          x: 0,
          y: 0,
          width: ctx.width,
          height: ctx.height,
          viewBox: `0 0 ${DESIGN_SPACE} ${DESIGN_SPACE}`,
        },
        children: [
          {
            tag: "text",
            attrs: {
              x: 500,
              y: 100,
              "font-size": fitFontSize(48, params.title, 880),
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          ...nodeGroups,
          ...edgePaths,
          ...edgeHeads,
          ...edgeLabels,
        ],
      },
    ],
  };
}

export const flowDiagram: SceneComponent = {
  componentId: "flow-diagram",
  version: 1,
  validateParams,
  render,
};
