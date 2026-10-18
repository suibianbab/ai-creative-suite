import { clamp01, easeOutCubic } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 示意网格地图（tile-grid cartogram）v1：区域方块按 row/col 网格排布（示意
// 表达，非真实地理轮廓——spec 裁定零依赖），可选数值 choropleth 着色。逐块
// 90ms 梯次淡入 + 微缩放；标签在块完成后 300ms 淡入。1000×1000 设计空间嵌套
// svg viewBox；render 纯函数，禁墙钟/随机/网络。

type MapGridParams = {
  title: string;
  regions: Array<{
    label: string;
    row: number;
    col: number;
    value?: number;
  }>;
  baseColor: string;
  highlightColor: string;
  textColor: string;
  enterMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
// 网格区（设计空间坐标）：x 140..860，y 220..820
const LEFT = 140;
const RIGHT = 860;
const TOP = 220;
const BOTTOM = 820;
const AREA_W = RIGHT - LEFT;
const AREA_H = BOTTOM - TOP;
const BLOCK_RATIO = 0.86;
const STAGGER_MS = 90;
const LABEL_FADE_MS = 300;
const MAX_REGIONS = 24;
const MAX_VALUE = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

// choropleth 插值：from→to 按 t（先钳 [0,1]）线性混合，输出 #rrggbb。
export function hexLerp(from: string, to: string, t: number): string {
  const x = clamp01(t);
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mixed = a.map((v, i) => Math.round(v + (b[i]! - v) * x));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function validateParams(value: unknown): MapGridParams {
  if (!isRecord(value)) throw new Error("map-grid params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("map-grid params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.regions) ||
    value.regions.length < 1 ||
    value.regions.length > MAX_REGIONS
  ) {
    throw new Error(
      `map-grid params.regions 必须是 1..${MAX_REGIONS} 个 {label, row, col, value?}`,
    );
  }
  value.regions.forEach((region, i) => {
    if (!isRecord(region)) {
      throw new Error(`map-grid params.regions[${i}] 必须是对象`);
    }
    if (
      typeof region.label !== "string" ||
      region.label.length < 1 ||
      region.label.length > 8
    ) {
      throw new Error(`map-grid params.regions[${i}].label 必须是 1..8 个字符`);
    }
    for (const key of ["row", "col"] as const) {
      const v = region[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 7) {
        throw new Error(
          `map-grid params.regions[${i}].row / col 必须是 0..7 的整数`,
        );
      }
    }
    if (region.value !== undefined) {
      const v = region.value;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_VALUE
      ) {
        throw new Error(
          `map-grid params.regions[${i}].value 必须是 0..1e12 的数`,
        );
      }
    }
  });
  if (!isHexColor(value.baseColor)) {
    throw new Error("map-grid params.baseColor 必须是 #rrggbb");
  }
  if (!isHexColor(value.highlightColor)) {
    throw new Error("map-grid params.highlightColor 必须是 #rrggbb");
  }
  if (!isHexColor(value.textColor)) {
    throw new Error("map-grid params.textColor 必须是 #rrggbb");
  }
  if (
    !Number.isInteger(value.enterMs) ||
    (value.enterMs as number) < 200 ||
    (value.enterMs as number) > 6000
  ) {
    throw new Error("map-grid params.enterMs 必须是 200..6000 的整数");
  }
  return value as MapGridParams;
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as MapGridParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const values = params.regions
    .map((r) => r.value)
    .filter((v): v is number => v !== undefined);
  const hasValues = values.length > 0;
  // choropleth 上限 = max×1.1；全零/空归一为 1 防除零（同 bar-chart 口径）
  const maxValue = hasValues ? Math.max(...values) * 1.1 || 1 : 1;

  const rows = Math.max(...params.regions.map((r) => r.row)) + 1;
  const cols = Math.max(...params.regions.map((r) => r.col)) + 1;
  const cell = Math.min(AREA_W / cols, AREA_H / rows);
  const block = cell * BLOCK_RATIO;
  // 网格整体在网格区内居中
  const ox = LEFT + (AREA_W - cell * cols) / 2;
  const oy = TOP + (AREA_H - cell * rows) / 2;

  const blocks: SvgNode[] = [];
  const labels: SvgNode[] = [];
  params.regions.forEach((region, i) => {
    const delay = i * STAGGER_MS;
    const appear = easeOutCubic(clamp01((tMs - delay) / params.enterMs));
    const cx = ox + region.col * cell + cell / 2;
    const cy = oy + region.row * cell + cell / 2;
    const fill =
      hasValues && region.value !== undefined
        ? hexLerp(
            params.baseColor,
            params.highlightColor,
            region.value / maxValue,
          )
        : params.baseColor;
    blocks.push({
      tag: "rect",
      attrs: {
        x: cx - block / 2,
        y: cy - block / 2,
        width: block,
        height: block,
        rx: 10,
        fill,
        opacity: appear,
        // 微缩放：0.9 → 1（绕块中心）
        transform: `translate(${cx} ${cy}) scale(${(0.9 + 0.1 * appear).toFixed(4)}) translate(${-cx} ${-cy})`,
      },
    });
    const fontSize = fitFontSize(22, region.label, block * 0.8);
    labels.push({
      tag: "text",
      attrs: {
        x: cx,
        y: cy + fontSize * 0.36,
        "font-size": fontSize,
        fill: params.textColor,
        "text-anchor": "middle",
        opacity: clamp01((tMs - delay - params.enterMs) / LABEL_FADE_MS),
      },
      text: region.label,
    });
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
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          ...blocks,
          ...labels,
        ],
      },
    ],
  };
}

export const mapGrid: SceneComponent = {
  componentId: "map-grid",
  version: 1,
  validateParams,
  render,
};
