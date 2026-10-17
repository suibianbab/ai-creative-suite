import { quantizeTimeline, ZeroFrameShotError } from "@acs/video-document";
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
  | { ok: true; spec: SceneSpec; title: string; renderHint: string }
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
// 下标与 LINE_TEMPLATE_LABELS 一一对应：确认卡如实预告「会画什么」，
// 不让必填的「标题」暗示画面按题材生成（P1-E）。
const LINE_TEMPLATE_LABELS = [
  "单条弧线",
  "H 形线条",
  "三角形轮廓",
  "山形曲线与双竖线",
] as const;

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
// 下标与 SHAPE_TEMPLATE_LABELS 一一对应，用途同线描。
const SHAPE_TEMPLATE_LABELS = [
  "单个方块",
  "圆与横条",
  "三角形、小方块与小圆",
] as const;

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

  // 内容预告（P1-E）：线描/图形的画面来自固定模板库（按句 seed 抽取），
  // 必填标题不进画面——确认卡必须把这两件事说破，不许让「标题」暗示题材生成。
  const renderHint =
    componentId === "text-animation"
      ? `文字动画：标题「${title}」${subtitle === undefined ? "" : `与副标题「${subtitle}」`}将进入画面`
      : componentId === "line-drawing"
        ? `线描动画：从固定模板库按句子抽取模板「${LINE_TEMPLATE_LABELS[seed % LINE_TEMPLATE_LABELS.length]}」描线呈现，标题「${title}」不会出现在画面里`
        : `图形动画：从固定模板库按句子抽取模板「${SHAPE_TEMPLATE_LABELS[seed % SHAPE_TEMPLATE_LABELS.length]}」依次入场，标题「${title}」不会出现在画面里`;

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
    renderHint,
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

// —— P1 分镜规划器：一句话 STEM 解说视频 → N 个镜头的 spec 序列 ——
//
//   做一个<3..120>秒的STEM解说视频，主题是<标题>[，分<3..8>个镜头]（默认 4）
//
// 与 P0 单镜头规划器同一纪律：只认固定句式，失败原样告知语法，不猜不降级。
// 规则是确定性的：要点/示意是固定占位与模板库内容（按句+镜头序号的 seed 抽取），
// 不做题材生成——预告文案必须如实说清这一点。

export const STORYBOARD_GUIDANCE =
  "P1 分镜句式：做一个<3..120>秒的STEM解说视频，主题是<标题>" +
  "[，分<3..8>个镜头]（默认 4 个镜头）。" +
  "示例：做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头";

const STORYBOARD_MIN_SECONDS = 3;
const STORYBOARD_MAX_SECONDS = 120;
const STORYBOARD_MIN_SHOTS = 3;
const STORYBOARD_MAX_SHOTS = 8;
const STORYBOARD_FPS = 24;

const STORYBOARD_RE =
  /^做一个(\d{1,3})秒的STEM解说视频，主题是([^，]{1,80})(?:，分(\d{1,2})个镜头)?$/;
const STORYBOARD_HEAD_RE = /^做一个\d{1,3}秒的STEM解说视频，/;

export function isStoryboardSentence(sentence: string): boolean {
  return STORYBOARD_HEAD_RE.test(sentence);
}

// 总时长均分到 N 个镜头：每镜头 floor(total/N)，末镜头吸收余数，Σ 恒等于 total。
export function splitShotDurations(totalMs: number, shots: number): number[] {
  const base = Math.floor(totalMs / shots);
  return Array.from({ length: shots }, (_, index) =>
    index === shots - 1 ? totalMs - base * (shots - 1) : base,
  );
}

export type StoryboardShot = {
  label: string;
  // D2：该镜头的旁白朗读文本——只读画面实际展示/表达的事实（标题/要点序号/
  // 谢谢观看），不虚构讲解词；合成走 scripts/video/tts-narration.mjs。
  narrationText: string;
  plan: PlanResult & { ok: true };
};

export type StoryboardResult =
  | { ok: true; title: string; totalMs: number; shots: StoryboardShot[] }
  | { ok: false; reason: string; guidance: string };

function rejectStoryboard(reason: string): StoryboardResult {
  return { ok: false, reason, guidance: STORYBOARD_GUIDANCE };
}

export function planStoryboard(sentence: string): StoryboardResult {
  const match = STORYBOARD_RE.exec(sentence);
  if (!match) {
    return rejectStoryboard("这句不在 P1 分镜句式里，我不猜你的意思");
  }
  const seconds = Number(match[1]);
  if (seconds < STORYBOARD_MIN_SECONDS || seconds > STORYBOARD_MAX_SECONDS) {
    return rejectStoryboard(
      `秒数必须是 ${STORYBOARD_MIN_SECONDS}..${STORYBOARD_MAX_SECONDS} 的整数`,
    );
  }
  const title = match[2] as string;
  const shotCount = match[3] === undefined ? 4 : Number(match[3]);
  if (shotCount < STORYBOARD_MIN_SHOTS || shotCount > STORYBOARD_MAX_SHOTS) {
    return rejectStoryboard(
      `镜头数必须是 ${STORYBOARD_MIN_SHOTS}..${STORYBOARD_MAX_SHOTS} 的整数`,
    );
  }

  const totalMs = seconds * 1000;
  const durations = splitShotDurations(totalMs, shotCount);
  // 零帧预检（评审关注 #1）：当前边界（最短 3000ms/8=375ms≈9 帧@24fps）下不可能
  // 零帧，预检为将来放宽秒数/镜头数边界时的兜底——零帧是编排错误，不许静默过。
  try {
    quantizeTimeline(durations, STORYBOARD_FPS);
  } catch (error) {
    if (error instanceof ZeroFrameShotError)
      return rejectStoryboard(error.message);
    throw error;
  }

  let pointIndex = 0;
  let shapeIndex = 0;
  const shots: StoryboardShot[] = durations.map((durationMs, index) => {
    const seed = hashSentence(`${sentence}#${index}`);
    const isMiddle = index > 0 && index < shotCount - 1;
    const useShapes = isMiddle && (index - 1) % 2 === 1;
    let label: string;
    let params: unknown;
    let renderHint: string;
    let narrationText: string;
    if (index === 0) {
      label = "开场";
      params = {
        title,
        titleColor: "#1b2c29",
        subtitleColor: "#5d7469",
        entrance: "fade-up",
        enterMs: DEFAULT_ENTER_MS,
      };
      renderHint = `开场镜头：标题「${title}」进入画面`;
      narrationText = `${title}。`;
    } else if (!isMiddle) {
      label = "结语";
      params = {
        title,
        subtitle: "谢谢观看",
        titleColor: "#1b2c29",
        subtitleColor: "#5d7469",
        entrance: "fade-up",
        enterMs: DEFAULT_ENTER_MS,
      };
      renderHint = `结语镜头：标题「${title}」与副标题「谢谢观看」进入画面`;
      narrationText = "谢谢观看。";
    } else if (useShapes) {
      shapeIndex += 1;
      label = `示意 ${shapeIndex}`;
      params = basicShapesParams(seed);
      renderHint = `示意镜头：从固定模板库按镜头 seed 抽取模板「${SHAPE_TEMPLATE_LABELS[seed % SHAPE_TEMPLATE_LABELS.length]}」依次入场，不含讲解文字`;
      // 画面无文字：旁白只读主题这个不争事实
      narrationText = `${title}。`;
    } else {
      pointIndex += 1;
      label = `要点 ${pointIndex}`;
      params = {
        title,
        subtitle: `要点 ${pointIndex}`,
        titleColor: "#1b2c29",
        subtitleColor: "#5d7469",
        entrance: "fade-up",
        enterMs: DEFAULT_ENTER_MS,
      };
      renderHint = `要点镜头：标题「${title}」与占位副标题「要点 ${pointIndex}」进入画面`;
      narrationText = `${title}，要点 ${pointIndex}。`;
    }
    const spec: SceneSpec = {
      specVersion: 1,
      componentId: useShapes ? "basic-shapes" : "text-animation",
      componentVersion: 1,
      durationMs,
      seed,
      background: DEFAULT_BACKGROUND,
      params,
    };
    validateSceneSpec(spec, defaultRegistry); // 兜底：构造结果必须过注册表校验
    return {
      label,
      narrationText,
      plan: { ok: true, spec, title, renderHint },
    };
  });

  return { ok: true, title, totalMs, shots };
}
