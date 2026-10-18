import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { emUnits, fitFontSize } from "../text-width.js";

// 手绘笔记强调 v1：闭式手绘几何——正弦抖动（点位置与条目序号的纯函数，
// 无随机源）+ 双描（第二遍相位差 π/2、幅度 0.75×、不透明度 0.8）+ 逐字
// 写入（前缀子串，Array.from 按码点切片）。强调笔画描画沿 line-drawing
// 口径（pathLength=1 + dasharray 1 + dashoffset 1−p）。条目 i 时序：
// delay=160+i×staggerMs；文本写入 [delay, delay+writeMs]；笔画描画
// [delay+writeMs, delay+writeMs+drawMs]（第二遍迟 80ms）。
// render 纯函数：禁墙钟/未播种随机/网络。

const EMPHASIS = ["下划线", "圈", "无"] as const;
type SketchEmphasis = (typeof EMPHASIS)[number];
type SketchItem = { text: string; emphasis: SketchEmphasis };
type SketchNoteParams = {
  title: string;
  items: SketchItem[];
  inkColor: string;
  accentColor: string;
  writeMs: number; // 200..6000
  drawMs: number; // 200..6000
  staggerMs: number; // 120..1200
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const ITEM_Y0 = 260;
const ITEM_DY = 130;
const START_MS = 160;
const TITLE_FADE_MS = 300;
const TEXT_BASE_FONT = 40;
const TEXT_MAX_WIDTH = 700;
const UNDER_GAP = 24;
const UNDER_DY = 30;
const UNDER_SEGS = 8;
const UNDER_AMP = 3.2;
const UNDER_AMP2 = 2.4;
const CIRCLE_SEGS = 20;
const CIRCLE_PAD_X = 34;
const CIRCLE_RY = 44;
const CIRCLE_START = -0.4;
const CIRCLE_AMP = 4;
const CIRCLE_AMP2 = 3;
const SECOND_DELAY_MS = 80;
const SECOND_OPACITY = 0.8;
const MAX_ITEMS = 5;
const MAX_TEXT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): SketchNoteParams {
  if (!isRecord(value)) throw new Error("sketch-note params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("sketch-note params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_ITEMS
  ) {
    throw new Error(
      `sketch-note params.items 必须是 1..${MAX_ITEMS} 个 {text, emphasis}`,
    );
  }
  value.items.forEach((item, i) => {
    if (!isRecord(item)) {
      throw new Error(`sketch-note params.items[${i}] 必须是对象`);
    }
    // 与 render 同口径：按码点计数（emoji 不劈半）
    const chars = typeof item.text === "string" ? Array.from(item.text) : [];
    if (chars.length < 1 || chars.length > MAX_TEXT) {
      throw new Error(
        `sketch-note params.items[${i}].text 必须是 1..${MAX_TEXT} 个字符`,
      );
    }
    if (
      typeof item.emphasis !== "string" ||
      !(EMPHASIS as readonly string[]).includes(item.emphasis)
    ) {
      throw new Error(
        `sketch-note params.items[${i}].emphasis 必须是 下划线/圈/无`,
      );
    }
  });
  for (const key of ["inkColor", "accentColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`sketch-note params.${key} 必须是 #rrggbb`);
    }
  }
  for (const key of ["writeMs", "drawMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`sketch-note params.${key} 必须是 200..6000 的整数`);
    }
  }
  const stagger = value.staggerMs;
  if (
    !Number.isInteger(stagger) ||
    (stagger as number) < 120 ||
    (stagger as number) > 1200
  ) {
    throw new Error("sketch-note params.staggerMs 必须是 120..1200 的整数");
  }
  return value as SketchNoteParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as SketchNoteParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const itemGroups: SvgNode[] = params.items.map((item, i) => {
    const delay = START_MS + i * params.staggerMs;
    const chars = Array.from(item.text);
    const visible = Math.min(
      chars.length,
      Math.ceil(clamp01((tMs - delay) / params.writeMs) * chars.length),
    );
    const fontSize = fitFontSize(TEXT_BASE_FONT, item.text, TEXT_MAX_WIDTH);
    const width = emUnits(item.text) * fontSize;
    const itemY = ITEM_Y0 + i * ITEM_DY;
    const strokes: SvgNode[] = [];
    if (item.emphasis !== "无") {
      const first: Array<[number, number]> = [];
      const second: Array<[number, number]> = [];
      if (item.emphasis === "下划线") {
        const left = 500 - width / 2 - UNDER_GAP;
        const right = 500 + width / 2 + UNDER_GAP;
        const y = itemY + UNDER_DY;
        for (let k = 0; k <= UNDER_SEGS; k += 1) {
          const u = k / UNDER_SEGS;
          const x = left + (right - left) * u;
          const phase = 2 * Math.PI * (2 * u + 0.35 * i);
          first.push([x, y + UNDER_AMP * Math.sin(phase)]);
          second.push([x, y + UNDER_AMP2 * Math.sin(phase + Math.PI / 2)]);
        }
      } else {
        const rx = width / 2 + CIRCLE_PAD_X;
        for (let k = 0; k <= CIRCLE_SEGS; k += 1) {
          const theta = CIRCLE_START + (2 * Math.PI * k) / CIRCLE_SEGS;
          const base = 3 * theta + 0.35 * i;
          const j = CIRCLE_AMP * Math.sin(base);
          const j2 = CIRCLE_AMP2 * Math.sin(base + Math.PI / 2);
          first.push([
            500 + (rx + j) * Math.cos(theta),
            itemY + (CIRCLE_RY + j) * Math.sin(theta),
          ]);
          second.push([
            500 + (rx + j2) * Math.cos(theta),
            itemY + (CIRCLE_RY + j2) * Math.sin(theta),
          ]);
        }
      }
      const toD = (points: Array<[number, number]>) =>
        `M ${points
          .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
          .join(" L ")}`;
      const p1 = clamp01((tMs - delay - params.writeMs) / params.drawMs);
      const p2 = clamp01(
        (tMs - delay - params.writeMs - SECOND_DELAY_MS) / params.drawMs,
      );
      const strokeWidth = item.emphasis === "圈" ? 5 : 6;
      strokes.push(
        {
          tag: "path",
          attrs: {
            d: toD(first),
            fill: "none",
            stroke: params.accentColor,
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            pathLength: 1,
            "stroke-dasharray": 1,
            "stroke-dashoffset": Number((1 - p1).toFixed(4)),
          },
        },
        {
          tag: "path",
          attrs: {
            d: toD(second),
            fill: "none",
            stroke: params.accentColor,
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            pathLength: 1,
            "stroke-dasharray": 1,
            "stroke-dashoffset": Number((1 - p2).toFixed(4)),
            opacity: SECOND_OPACITY,
          },
        },
      );
    }
    return {
      tag: "g",
      attrs: {},
      children: [
        {
          tag: "text",
          attrs: {
            x: 500,
            y: itemY,
            "font-size": fontSize,
            fill: params.inkColor,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          text: chars.slice(0, visible).join(""),
        },
        ...strokes,
      ],
    };
  });

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
              fill: params.inkColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
              opacity: clamp01(tMs / TITLE_FADE_MS),
            },
            text: params.title,
          },
          ...itemGroups,
        ],
      },
    ],
  };
}

export const sketchNote: SceneComponent = {
  componentId: "sketch-note",
  version: 1,
  validateParams,
  render,
};
