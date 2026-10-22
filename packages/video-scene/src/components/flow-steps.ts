import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 线性流程图 v1：N 步盒子按方向（横向/纵向）等距排布，步间直线箭头
// （pathLength=1 + dashoffset 描画，同 line-drawing 口径）。盒 i 在 i×120ms
// 弹入（scale 1.4→1 + 淡入，梯次口径同 bar-chart/map-grid）；盒内标签在
// enterMs 后 300ms 淡入（两级节奏，同 map-grid）；箭头在前盒落定后 240ms
// 线性描画，箭头三角随后 160ms 淡入。几何由步数与 direction 唯一推出
// （v1 不引自动布局，spec 裁定）。1000×1000 设计空间嵌套 svg viewBox；
// render 纯函数，禁墙钟/随机/网络。

type FlowStepsParams = {
  title: string;
  steps: Array<{ label: string }>;
  direction: "horizontal" | "vertical";
  boxColor: string;
  arrowColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 横向：中心 x 140..860 于 y=520；纵向：中心 y 220..820 于 x=500
const H_LEFT = 140;
const H_RIGHT = 860;
const V_TOP = 220;
const V_BOTTOM = 820;
const MID_X = 500;
const MID_Y = 520;
const BOX_RATIO = 0.72;
const H_BOX_W_CAP = 240;
const H_BOX_H = 96;
const V_BOX_W = 280;
const V_BOX_H_CAP = 160;
const STAGGER_MS = 120;
const LABEL_FADE_MS = 300;
const ARROW_MS = 240;
const ARROWHEAD_MS = 160;
const ARROW_GAP = 10;
const MAX_STEPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): FlowStepsParams {
  if (!isRecord(value)) throw new Error("flow-steps params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("flow-steps params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.steps) ||
    value.steps.length < 2 ||
    value.steps.length > MAX_STEPS
  ) {
    throw new Error(
      `flow-steps params.steps 必须是 2..${MAX_STEPS} 个 {label}`,
    );
  }
  value.steps.forEach((step, i) => {
    if (!isRecord(step)) {
      throw new Error(`flow-steps params.steps[${i}] 必须是对象`);
    }
    if (
      typeof step.label !== "string" ||
      step.label.length < 1 ||
      step.label.length > 10
    ) {
      throw new Error(
        `flow-steps params.steps[${i}].label 必须是 1..10 个字符`,
      );
    }
  });
  if (value.direction !== "horizontal" && value.direction !== "vertical") {
    throw new Error(
      "flow-steps params.direction 必须是 horizontal 或 vertical",
    );
  }
  for (const key of ["boxColor", "arrowColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`flow-steps params.${key} 必须是 #rrggbb`);
    }
  }
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("flow-steps params.enterMs 必须是 200..6000 的整数");
  }
  return value as FlowStepsParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as FlowStepsParams;
  // Style Bible can independently map boxColor and textColor to two light roles.
  // Keep the title color, but give labels a legible fill on their own boxes.
  const luminance = (hex: string): number => {
    const rgb = [1, 3, 5].map(
      (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
    const linear = rgb.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const boxLum = luminance(params.boxColor);
  const textLum = luminance(params.textColor);
  const ratio =
    (Math.max(boxLum, textLum) + 0.05) / (Math.min(boxLum, textLum) + 0.05);
  const labelColor =
    ratio >= 4.5
      ? params.textColor
      : (boxLum + 0.05) / 0.05 >= 1.05 / (boxLum + 0.05)
        ? "#000000"
        : "#ffffff";
  const tMs = (ctx.frame / ctx.fps) * 1000;
  const n = params.steps.length;
  const horizontal = params.direction === "horizontal";
  // 步中心等距排布：横向 x ∈ [140,860]@y=520；纵向 y ∈ [220,820]@x=500
  const slot = horizontal
    ? (H_RIGHT - H_LEFT) / (n - 1)
    : (V_BOTTOM - V_TOP) / (n - 1);
  const boxW = horizontal ? Math.min(slot * BOX_RATIO, H_BOX_W_CAP) : V_BOX_W;
  const boxH = horizontal ? H_BOX_H : Math.min(slot * BOX_RATIO, V_BOX_H_CAP);

  const boxes: SvgNode[] = [];
  const labels: SvgNode[] = [];
  params.steps.forEach((step, i) => {
    const delay = i * STAGGER_MS;
    const appear = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const cx = horizontal ? H_LEFT + i * slot : MID_X;
    const cy = horizontal ? MID_Y : V_TOP + i * slot;
    const fontSize = fitFontSize(22, step.label, boxW * 0.8);
    boxes.push({
      tag: "rect",
      attrs: {
        x: cx - boxW / 2,
        y: cy - boxH / 2,
        width: boxW,
        height: boxH,
        rx: 10,
        fill: params.boxColor,
        opacity: appear,
        // 弹入：scale 1.4 → 1（绕盒中心）
        transform: `translate(${cx} ${cy}) scale(${(1.4 - 0.4 * appear).toFixed(4)}) translate(${-cx} ${-cy})`,
      },
    });
    labels.push({
      tag: "text",
      attrs: {
        x: cx,
        y: cy + fontSize * 0.36,
        "font-size": fontSize,
        fill: labelColor,
        "text-anchor": "middle",
        opacity: clamp01((tMs - delay - params.enterMs) / LABEL_FADE_MS),
      },
      text: step.label,
    });
  });

  const arrows: SvgNode[] = [];
  const heads: SvgNode[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const delay = i * STAGGER_MS + params.enterMs; // 前盒落定后描画
    const p = clamp01((tMs - delay) / ARROW_MS);
    const headOpacity = clamp01((tMs - delay - ARROW_MS) / ARROWHEAD_MS);
    const stroke = {
      fill: "none",
      stroke: params.arrowColor,
      "stroke-width": 8,
      "stroke-linecap": "round",
      pathLength: 1,
      "stroke-dasharray": 1,
      "stroke-dashoffset": Number((1 - p).toFixed(4)),
    };
    if (horizontal) {
      const x1 = H_LEFT + i * slot + boxW / 2 + ARROW_GAP;
      const x2 = H_LEFT + (i + 1) * slot - boxW / 2 - ARROW_GAP;
      arrows.push({
        tag: "path",
        attrs: {
          d: `M ${x1.toFixed(2)},${MID_Y.toFixed(2)} L ${x2.toFixed(2)},${MID_Y.toFixed(2)}`,
          ...stroke,
        },
      });
      heads.push({
        tag: "polygon",
        attrs: {
          points: `${x2.toFixed(2)},${MID_Y.toFixed(2)} ${(x2 - 14).toFixed(2)},${(MID_Y - 7).toFixed(2)} ${(x2 - 14).toFixed(2)},${(MID_Y + 7).toFixed(2)}`,
          fill: params.arrowColor,
          opacity: headOpacity,
        },
      });
    } else {
      const y1 = V_TOP + i * slot + boxH / 2 + ARROW_GAP;
      const y2 = V_TOP + (i + 1) * slot - boxH / 2 - ARROW_GAP;
      arrows.push({
        tag: "path",
        attrs: {
          d: `M ${MID_X.toFixed(2)},${y1.toFixed(2)} L ${MID_X.toFixed(2)},${y2.toFixed(2)}`,
          ...stroke,
        },
      });
      heads.push({
        tag: "polygon",
        attrs: {
          points: `${MID_X.toFixed(2)},${y2.toFixed(2)} ${(MID_X - 7).toFixed(2)},${(y2 - 14).toFixed(2)} ${(MID_X + 7).toFixed(2)},${(y2 - 14).toFixed(2)}`,
          fill: params.arrowColor,
          opacity: headOpacity,
        },
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
          ...boxes,
          ...arrows,
          ...heads,
          ...labels,
        ],
      },
    ],
  };
}

export const flowSteps: SceneComponent = {
  componentId: "flow-steps",
  version: 1,
  validateParams,
  render,
};
