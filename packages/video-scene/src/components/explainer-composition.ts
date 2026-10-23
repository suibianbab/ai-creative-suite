import { clamp01 } from "../easing.js";
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
    | { kind: "image"; src: string };
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
  } else if (value.diagram.kind === "image") {
    // Self-contained raster only: no network dependency or SVG script surface.
    if (!validEmbeddedImage(value.diagram.src))
      throw new Error(
        "explainer-composition 图片须为不超过 180 KiB 的内嵌 PNG/JPEG/WebP",
      );
  } else
    throw new Error(
      "explainer-composition diagram.kind 仅支持 flow/drawing/image",
    );
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
        : diagramChildren;
  const portrait = ctx.height > ctx.width;
  const diagramY =
    p.diagramOffsetY + (portrait ? (p.diagram.kind === "flow" ? 300 : 260) : 0);
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
