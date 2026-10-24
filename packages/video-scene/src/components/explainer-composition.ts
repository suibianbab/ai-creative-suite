import { readableTextColor } from "@acs/shared";
import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";
import { flowStepLabelMaxWidth, flowSteps } from "./flow-steps.js";
import { lineDrawing } from "./line-drawing.js";

// A bounded title + registered diagram + annotation composition. Positions use
// the same 1000-square design space as flow-steps/line-drawing; no user code.
export type ExplainerParams = {
  title: string;
  titleColor: string;
  textColor: string;
  boxColor: string;
  arrowColor: string;
  strokeColor: string;
  titleY: number;
  titleEnterMs: number;
  diagramOffsetX: number;
  diagramOffsetY: number;
  diagramEnterMs: number;
  diagram:
    | { kind: "flow"; steps: Array<{ label: string }> }
    | { kind: "drawing"; paths: string[] }
    | { kind: "image"; src: string }
    | {
        kind: "cycle";
        steps: Array<{ label: string; caption?: string }>;
        centerText?: string;
      };
  // 部件标注（仅 drawing）：与路径同处 1000 设计空间，随图示组整体变换。
  diagramLabels?: Array<{
    text: string;
    x: number;
    y: number;
    targetX?: number;
    targetY?: number;
    enterMs?: number;
  }>;
  annotations: Array<{
    text: string;
    x: number;
    y: number;
    portraitY?: number;
    enterMs: number;
  }>;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
function validEmbeddedImage(src: unknown): src is string {
  // Editor accepts at most 120 KiB binary: base64 expands to 160 KiB plus
  // a short data URL prefix. 180 KiB leaves framing room for imported specs.
  if (typeof src !== "string" || src.length > 180 * 1024) return false;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match) return false;
  try {
    const header = atob(match[2]!.slice(0, 40));
    if (match[1] === "png") return header.startsWith("\x89PNG\r\n\x1a\n");
    if (match[1] === "jpeg")
      return (
        header.charCodeAt(0) === 0xff &&
        header.charCodeAt(1) === 0xd8 &&
        header.charCodeAt(2) === 0xff
      );
    return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown, lo: number, hi: number): boolean {
  return (
    Number.isInteger(value) &&
    (value as number) >= lo &&
    (value as number) <= hi
  );
}

function validateParams(value: unknown): ExplainerParams {
  if (!record(value))
    throw new Error("explainer-composition params 必须是对象");
  if (
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 32
  )
    throw new Error("explainer-composition title 必须是 1..32 字符");
  for (const key of [
    "titleColor",
    "textColor",
    "boxColor",
    "arrowColor",
    "strokeColor",
  ]) {
    if (typeof value[key] !== "string" || !HEX.test(value[key] as string))
      throw new Error(`explainer-composition ${key} 必须是 #rrggbb`);
  }
  for (const [key, lo, hi] of [
    ["titleY", 100, 240],
    ["titleEnterMs", 0, 3000],
    ["diagramOffsetX", -120, 120],
    ["diagramOffsetY", -160, 160],
    ["diagramEnterMs", 0, 3000],
  ] as const) {
    if (!integer(value[key], lo, hi))
      throw new Error(
        `explainer-composition ${key} 必须是 ${lo}..${hi} 的整数`,
      );
  }
  if (!record(value.diagram))
    throw new Error("explainer-composition diagram 必须是对象");
  if (value.diagram.kind === "flow") {
    flowSteps.validateParams({
      title: "",
      steps: value.diagram.steps,
      direction: "horizontal",
      boxColor: value.boxColor,
      arrowColor: value.arrowColor,
      textColor: value.textColor,
      enterMs: 700,
    });
  } else if (value.diagram.kind === "drawing") {
    lineDrawing.validateParams({
      paths: value.diagram.paths,
      strokeColor: value.strokeColor,
      strokeWidth: 10,
      revealMs: 1500,
    });
  } else if (value.diagram.kind === "cycle") {
    if (
      !Array.isArray(value.diagram.steps) ||
      value.diagram.steps.length < 3 ||
      value.diagram.steps.length > 6
    )
      throw new Error("explainer-composition cycle steps 必须是 3..6 项");
    value.diagram.steps.forEach((step, index) => {
      if (
        !record(step) ||
        typeof step.label !== "string" ||
        step.label.length < 1 ||
        step.label.length > 6
      )
        throw new Error(
          `explainer-composition cycle steps[${index}].label 必须是 1..6 个字符`,
        );
      if (
        step.caption !== undefined &&
        (typeof step.caption !== "string" ||
          step.caption.length < 1 ||
          step.caption.length > 12)
      )
        throw new Error(
          `explainer-composition cycle steps[${index}].caption 必须是 1..12 个字符`,
        );
    });
    if (
      value.diagram.centerText !== undefined &&
      (typeof value.diagram.centerText !== "string" ||
        value.diagram.centerText.length < 1 ||
        value.diagram.centerText.length > 10)
    )
      throw new Error(
        "explainer-composition cycle centerText 必须是 1..10 个字符",
      );
  } else if (value.diagram.kind === "image") {
    // Self-contained raster only: no network dependency or SVG script surface.
    if (!validEmbeddedImage(value.diagram.src))
      throw new Error(
        "explainer-composition 图片须为不超过 180 KiB 的内嵌 PNG/JPEG/WebP",
      );
  } else
    throw new Error(
      "explainer-composition diagram.kind 仅支持 flow/drawing/image/cycle",
    );
  if (value.diagramLabels !== undefined) {
    if (value.diagram.kind !== "drawing")
      throw new Error(
        "explainer-composition diagramLabels 仅可与 drawing 搭配",
      );
    if (
      !Array.isArray(value.diagramLabels) ||
      value.diagramLabels.length < 1 ||
      value.diagramLabels.length > 4
    )
      throw new Error("explainer-composition diagramLabels 必须是 1..4 项");
    value.diagramLabels.forEach((label, index) => {
      if (
        !record(label) ||
        typeof label.text !== "string" ||
        label.text.length < 1 ||
        label.text.length > 8 ||
        !integer(label.x, 0, 1000) ||
        !integer(label.y, 0, 1000) ||
        (label.targetX === undefined) !== (label.targetY === undefined) ||
        (label.targetX !== undefined &&
          (!integer(label.targetX, 0, 1000) ||
            !integer(label.targetY, 0, 1000))) ||
        (label.enterMs !== undefined && !integer(label.enterMs, 0, 3500))
      )
        throw new Error(
          `explainer-composition diagramLabels[${index}] 文本/位置/目标/入场时间无效`,
        );
    });
  }
  if (
    !Array.isArray(value.annotations) ||
    value.annotations.length < 1 ||
    value.annotations.length > 3
  )
    throw new Error("explainer-composition annotations 必须是 1..3 项");
  value.annotations.forEach((annotation, index) => {
    if (
      !record(annotation) ||
      typeof annotation.text !== "string" ||
      annotation.text.length < 1 ||
      annotation.text.length > 20 ||
      !integer(annotation.x, 150, 850) ||
      !integer(annotation.y, 650, 800) ||
      (annotation.portraitY !== undefined &&
        !integer(annotation.portraitY, 800, 1450)) ||
      !integer(annotation.enterMs, 0, 3500)
    )
      throw new Error(
        `explainer-composition annotations[${index}] 文本/位置/入场时间无效`,
      );
  });
  return value as ExplainerParams;
}

// cycle 图示：N 阶段沿椭圆环顺时针排布，弧形箭头首尾相接闭合成环；
// 竖版沿 1778 设计空间纵向拉高椭圆（横版 ry 225 / 竖版 ry 410），解决
// flow 线性排布在竖版的大面积留白。时序：阶段 i 于 i×480ms 弹入
// （500ms，口径同 flow-steps），短注 +700ms；弧 i 在两端阶段落定后
// 380ms 描画 + 160ms 箭头（闭合弧额外 +240ms 错峰）；中心文字在环
// 闭合后淡入。render 纯函数，几何由步数与画幅唯一推出。
const CYCLE = {
  staggerMs: 480,
  enterMs: 500,
  labelFadeMs: 250,
  captionDelayMs: 700,
  captionFadeMs: 300,
  edgeMs: 380,
  headMs: 160,
  wrapExtraMs: 240,
  centerDelayMs: 60,
  centerFadeMs: 300,
} as const;

function cycleNodes(
  p: ExplainerParams,
  tMs: number,
  portrait: boolean,
): SvgNode[] {
  if (p.diagram.kind !== "cycle") return [];
  const steps = p.diagram.steps;
  const n = steps.length;
  const cx = 500;
  const cy = portrait ? 540 : 530;
  const rx = portrait ? 290 : 320;
  const ry = portrait ? 410 : 200;
  const boxW = portrait ? 230 : 200;
  const boxH = portrait ? 96 : 84;
  const trim = portrait ? 0.55 : 0.45;
  const point = (angle: number): [number, number] => [
    cx + rx * Math.cos(angle),
    cy + ry * Math.sin(angle),
  ];
  const labelColor = readableTextColor(p.textColor, p.boxColor);
  const boxes: SvgNode[] = [];
  const labels: SvgNode[] = [];
  const captions: SvgNode[] = [];
  steps.forEach((step, i) => {
    const angle = ((-90 + (i * 360) / n) * Math.PI) / 180;
    const [x, y] = point(angle);
    const appear = easeOutCubic(
      clamp01((tMs - i * CYCLE.staggerMs) / CYCLE.enterMs),
    );
    boxes.push({
      tag: "rect",
      attrs: {
        x: x - boxW / 2,
        y: y - boxH / 2,
        width: boxW,
        height: boxH,
        rx: 12,
        fill: p.boxColor,
        opacity: appear,
        transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(1.4 - 0.4 * appear).toFixed(4)}) translate(${(-x).toFixed(2)} ${(-y).toFixed(2)})`,
      },
    });
    const fontSize = fitFontSize(30, step.label, boxW - 28);
    labels.push({
      tag: "text",
      attrs: {
        x: x.toFixed(2),
        y: (y + fontSize * 0.36).toFixed(2),
        "font-size": fontSize,
        fill: labelColor,
        "text-anchor": "middle",
        opacity: clamp01(
          (tMs - i * CYCLE.staggerMs - CYCLE.enterMs) / CYCLE.labelFadeMs,
        ),
      },
      text: step.label,
    });
    if (step.caption !== undefined) {
      captions.push({
        tag: "text",
        attrs: {
          x: x.toFixed(2),
          y: (y + boxH / 2 + 34).toFixed(2),
          "font-size": fitFontSize(22, step.caption, boxW + 80),
          fill: p.textColor,
          "text-anchor": "middle",
          opacity: clamp01(
            (tMs - i * CYCLE.staggerMs - CYCLE.captionDelayMs) /
              CYCLE.captionFadeMs,
          ),
        },
        text: step.caption,
      });
    }
  });
  const edges: SvgNode[] = [];
  const heads: SvgNode[] = [];
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const fromAngle = ((-90 + (i * 360) / n) * Math.PI) / 180 + trim;
    // 闭合弧的目标角度补 2π，保证弧沿顺时针走完而不是反向折回。
    const toAngle =
      ((-90 + (next * 360) / n) * Math.PI) / 180 +
      (next === 0 ? 2 * Math.PI : 0) -
      trim;
    const [sx, sy] = point(fromAngle);
    const [ex, ey] = point(toAngle);
    const startMs =
      Math.max(i, next) * CYCLE.staggerMs +
      CYCLE.enterMs +
      (i === n - 1 ? CYCLE.wrapExtraMs : 0);
    const draw = clamp01((tMs - startMs) / CYCLE.edgeMs);
    edges.push({
      tag: "path",
      attrs: {
        d: `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${rx} ${ry} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`,
        fill: "none",
        stroke: p.arrowColor,
        "stroke-width": 8,
        "stroke-linecap": "round",
        pathLength: 1,
        "stroke-dasharray": 1,
        "stroke-dashoffset": Number((1 - draw).toFixed(4)),
      },
    });
    // 切线方向（顺时针）：d/dθ = (−rx·sinθ, ry·cosθ)
    const ux = -rx * Math.sin(toAngle);
    const uy = ry * Math.cos(toAngle);
    const len = Math.hypot(ux, uy) || 1;
    const tx = ux / len;
    const ty = uy / len;
    const bx = ex - tx * 16;
    const by = ey - ty * 16;
    heads.push({
      tag: "polygon",
      attrs: {
        points: `${ex.toFixed(2)},${ey.toFixed(2)} ${(bx - ty * 7).toFixed(2)},${(by + tx * 7).toFixed(2)} ${(bx + ty * 7).toFixed(2)},${(by - tx * 7).toFixed(2)}`,
        fill: p.arrowColor,
        opacity: clamp01((tMs - startMs - CYCLE.edgeMs) / CYCLE.headMs),
      },
    });
  }
  const nodes: SvgNode[] = [
    ...edges,
    ...heads,
    ...boxes,
    ...labels,
    ...captions,
  ];
  if (p.diagram.centerText !== undefined) {
    const wrapStart =
      (n - 1) * CYCLE.staggerMs + CYCLE.enterMs + CYCLE.wrapExtraMs;
    const centerStart =
      wrapStart + CYCLE.edgeMs + CYCLE.headMs + CYCLE.centerDelayMs;
    nodes.push({
      tag: "text",
      attrs: {
        x: cx,
        y: cy,
        "font-size": fitFontSize(40, p.diagram.centerText, 340),
        fill: p.textColor,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        opacity: clamp01((tMs - centerStart) / CYCLE.centerFadeMs),
      },
      text: p.diagram.centerText,
    });
  }
  return nodes;
}

// 部件标注：drawing 空间内的小字标签，可选引线＋端点圆指向图示部件；
// 与路径同组渲染，自动随 diagramOffset/scale 变换（横竖版同坐标）。
function diagramLabelNodes(p: ExplainerParams, tMs: number): SvgNode[] {
  if (p.diagram.kind !== "drawing" || !p.diagramLabels) return [];
  return p.diagramLabels.flatMap((label) => {
    const opacity = clamp01((tMs - (label.enterMs ?? 1200)) / 300);
    const fontSize = fitFontSize(26, label.text, 240);
    const nodes: SvgNode[] = [
      {
        tag: "text",
        attrs: {
          x: label.x,
          y: label.y,
          "font-size": fontSize,
          fill: p.textColor,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          opacity,
        },
        text: label.text,
      },
    ];
    if (label.targetX !== undefined && label.targetY !== undefined) {
      const dx = label.targetX - label.x;
      const dy = label.targetY - label.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      nodes.push(
        {
          tag: "path",
          attrs: {
            d: `M ${(label.x + ux * 24).toFixed(2)} ${(label.y + uy * 24).toFixed(2)} L ${(label.targetX - ux * 16).toFixed(2)} ${(label.targetY - uy * 16).toFixed(2)}`,
            fill: "none",
            stroke: p.textColor,
            "stroke-width": 3,
            "stroke-linecap": "round",
            opacity,
          },
        },
        {
          tag: "circle",
          attrs: {
            cx: label.targetX,
            cy: label.targetY,
            r: 4,
            fill: p.textColor,
            opacity,
          },
        },
      );
    }
    return nodes;
  });
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const p = spec.params as ExplainerParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const childFrame = Math.max(
    0,
    Math.floor(((tMs - p.diagramEnterMs) * ctx.fps) / 1000),
  );
  const childCtx = { ...ctx, frame: childFrame };
  const diagramSpec: SceneSpecLike | null =
    p.diagram.kind === "flow"
      ? {
          ...spec,
          componentId: "flow-steps",
          params: {
            title: "",
            steps: p.diagram.steps,
            direction: ctx.height > ctx.width ? "vertical" : "horizontal",
            boxColor: p.boxColor,
            arrowColor: p.arrowColor,
            textColor: p.textColor,
            enterMs: 700,
          },
        }
      : p.diagram.kind === "drawing"
        ? {
            ...spec,
            componentId: "line-drawing",
            params: {
              paths: p.diagram.paths,
              strokeColor: p.strokeColor,
              strokeWidth: 10,
              revealMs: 1500,
            },
          }
        : null;
  const diagram = diagramSpec
    ? (p.diagram.kind === "flow" ? flowSteps : lineDrawing).render(
        diagramSpec,
        childCtx,
      )
    : null;
  const diagramChildren = diagram?.children?.[1]?.children ?? [];
  const childTMs = (childCtx.frame / ctx.fps) * 1000;
  const portrait = ctx.height > ctx.width;
  const flowStepCount = p.diagram.kind === "flow" ? p.diagram.steps.length : 0;
  const reused =
    p.diagram.kind === "flow"
      ? diagramChildren.slice(1).map((node) =>
          node.tag === "text"
            ? {
                ...node,
                attrs: {
                  ...node.attrs,
                  "font-size": Math.max(
                    Number(node.attrs["font-size"]),
                    fitFontSize(
                      30,
                      node.text ?? "",
                      flowStepLabelMaxWidth(
                        flowStepCount,
                        ctx.height > ctx.width ? "vertical" : "horizontal",
                      ),
                    ),
                  ),
                },
              }
            : node,
        )
      : p.diagram.kind === "image"
        ? [
            {
              tag: "image",
              attrs: {
                href: p.diagram.src,
                x: 160,
                y: 300,
                width: 680,
                height: 420,
                preserveAspectRatio: "xMidYMid meet",
              },
            },
          ]
        : p.diagram.kind === "cycle"
          ? cycleNodes(p, childTMs, portrait)
          : [...diagramChildren, ...diagramLabelNodes(p, childTMs)];
  const diagramY =
    p.diagramOffsetY +
    (portrait ? (p.diagram.kind === "drawing" ? 260 : 300) : 0);
  const diagramScale = p.diagram.kind === "drawing" ? 1.3 : 1;
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
          viewBox: portrait ? "0 0 1000 1778" : "0 0 1000 1000",
        },
        children: [
          {
            tag: "text",
            attrs: {
              x: 500,
              y: p.titleY + (portrait ? 100 : 0),
              "font-size": fitFontSize(50, p.title, 760),
              fill: p.titleColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01((tMs - p.titleEnterMs) / 300),
            },
            text: p.title,
          },
          {
            tag: "g",
            attrs: {
              transform: `translate(${p.diagramOffsetX} ${diagramY}) translate(500 500) scale(${diagramScale}) translate(-500 -500)`,
              opacity: tMs >= p.diagramEnterMs ? 1 : 0,
            },
            children: reused,
          },
          ...p.annotations.map((a) => ({
            tag: "text",
            attrs: {
              x: a.x,
              y: portrait ? (a.portraitY ?? a.y + 400) : a.y,
              "font-size": fitFontSize(36, a.text, 680),
              fill: p.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01((tMs - a.enterMs) / 300),
            },
            text: a.text,
          })),
        ],
      },
    ],
  };
}

export const explainerComposition: SceneComponent = {
  componentId: "explainer-composition",
  version: 1,
  validateParams,
  render,
};
