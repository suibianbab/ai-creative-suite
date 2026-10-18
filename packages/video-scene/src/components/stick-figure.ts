import { clamp01 } from "../easing.js";
import type {
  FrameContext,
  SceneComponent,
  SceneSpecLike,
} from "../registry.js";
import type { SvgNode } from "../svg.js";
import { fitFontSize } from "../text-width.js";

// 火柴人舞台 v1：骨架常量（头 r28 / 躯干 110 / 上臂 52+前臂 48 / 单段腿
// 120）+ 闭式动作表——关节角是 (action, φ) 的纯函数，无关键帧数组。角度
// 约定：从竖直向下起算、画布右摆为正（度）；前臂角相对上臂延长线。整组
// 朝向由 toX−fromX 符号决定，向左时组内 scale(-1,1) 镜像（动作只写右侧
// 版本）。1..3 人按 i×200ms 梯次淡入（无 scale 弹跳，spec 裁定）；呼吸
// bob=2·sin(2π·tMs/1600) 常开；tMs<delay+enterMs 时 φ 取 0（站姿）。
// render 纯函数：禁墙钟/未播种随机/网络。

const ACTIONS = ["走", "站", "挥手", "指", "跳"] as const;
type StickAction = (typeof ACTIONS)[number];
type StickFigureDecl = { action: StickAction; fromX: number; toX: number };
type StickFigureParams = {
  title: string;
  groundY: number;
  figures: StickFigureDecl[];
  strokeColor: string;
  groundColor: string;
  textColor: string;
  enterMs: number; // 200..6000
  cycleMs: number; // 200..6000
  travelMs: number; // 200..6000
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DESIGN_SPACE = 1000;
const HEAD_R = 28;
const HEAD_GAP = 6;
const SPINE = 110;
const UPPER_ARM = 52;
const FOREARM = 48;
const LEG = 120;
const STROKE = 10;
const STAGGER_MS = 200;
const BREATH_PERIOD = 1600;
const MAX_FIGURES = 3;
const COORD_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateParams(value: unknown): StickFigureParams {
  if (!isRecord(value)) throw new Error("stick-figure params 必须是对象");
  if (typeof value.title !== "string" || value.title.length > 40) {
    throw new Error("stick-figure params.title 必须是 ≤40 个字符");
  }
  if (
    !Array.isArray(value.figures) ||
    value.figures.length < 1 ||
    value.figures.length > MAX_FIGURES
  ) {
    throw new Error(
      `stick-figure params.figures 必须是 1..${MAX_FIGURES} 个 {action, fromX, toX}`,
    );
  }
  value.figures.forEach((figure, i) => {
    if (!isRecord(figure)) {
      throw new Error(`stick-figure params.figures[${i}] 必须是对象`);
    }
    if (
      typeof figure.action !== "string" ||
      !(ACTIONS as readonly string[]).includes(figure.action)
    ) {
      throw new Error(
        `stick-figure params.figures[${i}].action 必须是 走/站/挥手/指/跳`,
      );
    }
    for (const key of ["fromX", "toX"] as const) {
      const v = figure[key];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > COORD_MAX
      ) {
        throw new Error(
          `stick-figure params.figures[${i}].fromX / toX 必须是 0..1000 的数`,
        );
      }
    }
  });
  if (
    typeof value.groundY !== "number" ||
    !Number.isFinite(value.groundY) ||
    value.groundY < 400 ||
    value.groundY > 900
  ) {
    throw new Error("stick-figure params.groundY 必须是 400..900 的数");
  }
  for (const key of ["strokeColor", "groundColor", "textColor"] as const) {
    if (!isHexColor(value[key])) {
      throw new Error(`stick-figure params.${key} 必须是 #rrggbb`);
    }
  }
  for (const key of ["enterMs", "cycleMs", "travelMs"] as const) {
    const v = value[key];
    if (!Number.isInteger(v) || (v as number) < 200 || (v as number) > 6000) {
      throw new Error(`stick-figure params.${key} 必须是 200..6000 的整数`);
    }
  }
  return value as StickFigureParams;
}

type Pose = {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  foreL: number;
  foreR: number;
  bob: number;
  yOff: number;
};

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// 动作表（spec §方案）：角度单位度；bob 除「走」外都是呼吸值
function poseAt(action: StickAction, phi: number, tMs: number): Pose {
  const breath = 2 * Math.sin((2 * Math.PI * tMs) / BREATH_PERIOD);
  switch (action) {
    case "走": {
      const swing = Math.sin(2 * Math.PI * phi);
      return {
        legL: 26 * swing,
        legR: -26 * swing,
        armL: -20 * swing,
        armR: 20 * swing,
        foreL: 0,
        foreR: 0,
        bob: 4 * Math.abs(swing),
        yOff: 0,
      };
    }
    case "挥手":
      return {
        legL: -4,
        legR: 4,
        armL: -6,
        armR: 150,
        foreL: 0,
        foreR: -60 + 25 * Math.sin(6 * Math.PI * phi),
        bob: breath,
        yOff: 0,
      };
    case "指":
      return {
        legL: -4,
        legR: 4,
        armL: -6,
        armR: 90,
        foreL: 0,
        foreR: 0,
        bob: breath,
        yOff: 0,
      };
    case "跳": {
      const airborne = phi > 0.15 && phi < 0.85;
      return airborne
        ? {
            legL: -10,
            legR: 10,
            armL: -120,
            armR: 120,
            foreL: 0,
            foreR: 0,
            bob: breath,
            yOff: 120 * 4 * phi * (1 - phi),
          }
        : {
            legL: -4,
            legR: 4,
            armL: -6,
            armR: 6,
            foreL: 0,
            foreR: 0,
            bob: breath,
            yOff: 0,
          };
    }
    default:
      return {
        legL: -4,
        legR: 4,
        armL: -6,
        armR: 6,
        foreL: 0,
        foreR: 0,
        bob: breath,
        yOff: 0,
      };
  }
}

function render(spec: SceneSpecLike, ctx: FrameContext): SvgNode {
  const params = spec.params as StickFigureParams;
  const tMs = (ctx.frame / ctx.fps) * 1000;

  const figureGroups: SvgNode[] = params.figures.map((figure, i) => {
    const delay = i * STAGGER_MS;
    const tRel = tMs - delay - params.enterMs;
    const phi = tRel <= 0 ? 0 : (tRel / params.cycleMs) % 1;
    const pose = poseAt(figure.action, phi, tMs);
    // 行进窗口：走/站/挥手/指 在 travelMs 内 fromX→toX 线性；跳 x 固定
    // fromX（spec §方案「跳：x 固定 fromX」——抛物线竖直，滑跳读感差）
    const progress = clamp01(tRel / params.travelMs);
    const x =
      figure.action === "跳"
        ? figure.fromX
        : figure.fromX + (figure.toX - figure.fromX) * progress;
    const hipY = params.groundY - LEG - pose.bob - pose.yOff;
    const neckY = -SPINE;
    // 关节：从根沿角度推进（sin=+x、cos=+y 向下）
    const limb = (
      rootX: number,
      rootY: number,
      angleDeg: number,
      len: number,
    ): [number, number] => [
      rootX + Math.sin(rad(angleDeg)) * len,
      rootY + Math.cos(rad(angleDeg)) * len,
    ];
    const [elbowLx, elbowLy] = limb(0, neckY, pose.armL, UPPER_ARM);
    const [handLx, handLy] = limb(
      elbowLx,
      elbowLy,
      pose.armL + pose.foreL,
      FOREARM,
    );
    const [elbowRx, elbowRy] = limb(0, neckY, pose.armR, UPPER_ARM);
    const [handRx, handRy] = limb(
      elbowRx,
      elbowRy,
      pose.armR + pose.foreR,
      FOREARM,
    );
    const [footLx, footLy] = limb(0, 0, pose.legL, LEG);
    const [footRx, footRy] = limb(0, 0, pose.legR, LEG);
    const seg = (x1: number, y1: number, x2: number, y2: number): SvgNode => ({
      tag: "line",
      attrs: {
        x1: x1.toFixed(2),
        y1: y1.toFixed(2),
        x2: x2.toFixed(2),
        y2: y2.toFixed(2),
        stroke: params.strokeColor,
        "stroke-width": STROKE,
        "stroke-linecap": "round",
      },
    });
    const flip = figure.toX - figure.fromX < 0;
    return {
      tag: "g",
      attrs: {
        transform: `translate(${x.toFixed(2)} ${hipY.toFixed(2)})${flip ? " scale(-1,1)" : ""}`,
        opacity: clamp01((tMs - delay) / params.enterMs),
      },
      children: [
        seg(0, 0, 0, neckY), // 脊柱（髋→颈）
        seg(0, neckY, elbowLx, elbowLy),
        seg(elbowLx, elbowLy, handLx, handLy),
        seg(0, neckY, elbowRx, elbowRy),
        seg(elbowRx, elbowRy, handRx, handRy),
        seg(0, 0, footLx, footLy),
        seg(0, 0, footRx, footRy),
        {
          tag: "circle",
          attrs: {
            cx: "0",
            cy: (neckY - HEAD_R - HEAD_GAP).toFixed(2),
            r: HEAD_R,
            fill: params.strokeColor,
          },
        },
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
              fill: params.textColor,
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            text: params.title,
          },
          {
            tag: "line",
            attrs: {
              x1: "40",
              y1: String(params.groundY),
              x2: "960",
              y2: String(params.groundY),
              stroke: params.groundColor,
              "stroke-width": 6,
              "stroke-linecap": "round",
            },
          },
          ...figureGroups,
        ],
      },
    ],
  };
}

export const stickFigure: SceneComponent = {
  componentId: "stick-figure",
  version: 1,
  validateParams,
  render,
};
