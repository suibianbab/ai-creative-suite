import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

// P0 规则规划器（PhotoCraft M1 式「绝不猜」）：只认一个固定句式，解析失败就
// 原样把语法告诉用户，绝不静默降级、绝不替用户补意图。
//
//   做一个<秒数>秒的<文字|线描|图形>动画，标题是<文本>[，副标题是<文本>][，背景是<#hex>]
//
// 秒数 3..30；标题必填（1..80、不含逗号）；背景可选（#rrggbb）。

export type PlanResult =
  | { ok: true; spec: SceneSpec; title: string }
  | { ok: false; reason: string; guidance: string };

export const PLANNER_GUIDANCE =
  "P0 支持的句式：做一个<秒数>秒的<文字|线描|图形>动画，" +
  "标题是<文本>[，副标题是<文本>][，背景是<#hex>]。" +
  "示例：做一个12秒的文字动画，标题是云制作，副标题是Video Studio，背景是#16203a";

const MIN_SECONDS = 3;
const MAX_SECONDS = 30;
const DEFAULT_BACKGROUND = "#ffffff";
const DEFAULT_ENTER_MS = 900;

const TYPE_BY_WORD = {
  文字: "text-animation",
  线描: "line-drawing",
  图形: "basic-shapes",
} as const;

const TYPE_LABEL = {
  "text-animation": "文字",
  "line-drawing": "线描",
  "basic-shapes": "图形",
} as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 句首：做一个<秒数>秒的<类型词>[动画][，剩余]——类型词不吃逗号，
// 「视频」这类未知词也要进得了类型检查（reason 才能点名它）。
const HEAD = /^做一个(\d{1,3})秒的([^，]+?)(?:动画)?(，.*)?$/;
// 剩余段：，标题是<文本>[，副标题是<文本>][，背景是<#hex>]（标题/副标题不含逗号）
const TAIL =
  /^，标题是([^，]{1,80})(?:，副标题是([^，]{1,80}))?(?:，背景是(#[0-9a-fA-F]{6}))?$/;

function reject(reason: string): PlanResult {
  return { ok: false, reason, guidance: PLANNER_GUIDANCE };
}

// 简单字符串哈希（FNV-1a，32 位无符号）：同句同 seed，规划可复现。
function hashSentence(sentence: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sentence.length; index += 1) {
    hash ^= sentence.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// —— 线描模板（1000×1000 设计空间，组件契约见 line-drawing.ts）——
const LINE_TEMPLATES: string[][] = [
  ["M200,700 Q500,200 800,700"],
  ["M300,200 L300,800 M700,200 L700,800 M300,500 L700,500"],
  ["M500,200 L800,650 L200,650 Z"],
  [
    "M250,750 C250,450 450,300 500,300 C550,300 750,450 750,750",
    "M350,750 L350,550 M650,750 L650,550",
  ],
];

// —— 图形模板：归一化包围盒（basic-shapes 组件契约）——
const SHAPE_TEMPLATES = [
  [{ kind: "rect", x: 0.3, y: 0.3, w: 0.4, h: 0.4, color: "#497a61" }],
  [
    { kind: "circle", x: 0.35, y: 0.3, w: 0.3, h: 0.3, color: "#497a61" },
    { kind: "rect", x: 0.3, y: 0.65, w: 0.4, h: 0.08, color: "#1b2c29" },
  ],
  [
    { kind: "triangle", x: 0.25, y: 0.25, w: 0.5, h: 0.5, color: "#497a61" },
    { kind: "rect", x: 0.42, y: 0.62, w: 0.16, h: 0.16, color: "#1b2c29" },
    { kind: "circle", x: 0.7, y: 0.7, w: 0.12, h: 0.12, color: "#8aa79a" },
  ],
] as const;

function lineDrawingParams(seed: number): unknown {
  const paths = LINE_TEMPLATES[seed % LINE_TEMPLATES.length]!;
  return {
    paths,
    strokeColor: "#1b2c29",
    strokeWidth: 4,
    revealMs: 4000,
  };
}

function basicShapesParams(seed: number): unknown {
  const shapes = SHAPE_TEMPLATES[seed % SHAPE_TEMPLATES.length]!;
  return {
    shapes: shapes.map((shape, index) => ({
      ...shape,
      delayMs: index * 200,
      enterMs: DEFAULT_ENTER_MS,
    })),
  };
}

export function planFromSentence(sentence: string): PlanResult {
  const head = HEAD.exec(sentence);
  if (!head) {
    return reject("这句不在 P0 支持的句式里，我不猜你的意思");
  }
  const typeWord = head[2] as keyof typeof TYPE_BY_WORD | string;
  const componentId = TYPE_BY_WORD[typeWord as keyof typeof TYPE_BY_WORD];
  if (!componentId) {
    return reject(
      `动画类型「${typeWord}」暂不支持（P0 可选：文字 / 线描 / 图形）`,
    );
  }
  const seconds = Number(head[1]);
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    return reject(`秒数必须是 ${MIN_SECONDS}..${MAX_SECONDS} 的整数`);
  }
  const rest = head[3] ?? "";
  const tail = TAIL.exec(rest);
  if (!tail) {
    // 背景写了但格式不对时给更精确的提示
    if (rest.includes("，背景是") && !HEX_COLOR.test(extractHex(rest))) {
      return reject("背景色必须是 #rrggbb 六位十六进制（如 #16203a）");
    }
    return reject("缺「标题是<文本>」，标题是必填段");
  }
  const title = tail[1] as string;
  const subtitle = tail[2] as string | undefined;
  const background = (tail[3] as string | undefined) ?? DEFAULT_BACKGROUND;
  const seed = hashSentence(sentence);

  const params =
    componentId === "text-animation"
      ? {
          title,
          ...(subtitle === undefined ? {} : { subtitle }),
          titleColor: "#1b2c29",
          subtitleColor: "#5d7469",
          entrance: "fade-up",
          enterMs: DEFAULT_ENTER_MS,
        }
      : componentId === "line-drawing"
        ? lineDrawingParams(seed)
        : basicShapesParams(seed);

  const spec: SceneSpec = {
    specVersion: 1,
    componentId,
    componentVersion: 1,
    durationMs: seconds * 1000,
    seed,
    background,
    params,
  };
  validateSceneSpec(spec, defaultRegistry); // 兜底：构造结果必须过注册表校验
  return {
    ok: true,
    spec,
    title,
  };
}

function extractHex(rest: string): string {
  const match = /，背景是(.+)$/.exec(rest);
  return match ? (match[1] as string) : "";
}

// 供确认环展示 spec 摘要（UI 用）。
export function specSummary(spec: SceneSpec): string {
  const label =
    TYPE_LABEL[spec.componentId as keyof typeof TYPE_LABEL] ?? spec.componentId;
  return `${label}动画 ${spec.durationMs / 1000}s · seed ${spec.seed} · 背景 ${spec.background}`;
}
