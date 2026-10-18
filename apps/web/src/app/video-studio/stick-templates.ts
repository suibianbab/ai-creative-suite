// P2-④ 火柴人：起点模板与数据编辑纯逻辑（沿 flow-templates.ts 模式）。
// 模板参数过 validateSceneSpec 兜底；非法数据行内报错、不落 patch（C1 语义）。

import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type StickTemplate = {
  templateId: string;
  componentId: "stick-figure";
  label: string;
  params: Record<string, unknown>;
};

const STICK_COLORS = {
  strokeColor: "#1b2c29",
  groundColor: "#9aa8a0",
  textColor: "#1b2c29",
};

export const STICK_TEMPLATES: StickTemplate[] = [
  {
    templateId: "stick-walk-across",
    componentId: "stick-figure",
    label: "一人横穿",
    params: {
      title: "走入画面",
      groundY: 800,
      figures: [{ action: "走", fromX: 80, toX: 920 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 800,
      // 终评 I-1：400+travelMs ≤1800（默认 2000ms 镜头末帧前落定并留 ≥200ms
      // 停留）——stick-templates.test.ts 预算断言逐模板钉死
      travelMs: 1200,
    },
  },
  {
    templateId: "stick-present",
    componentId: "stick-figure",
    label: "讲解指板",
    params: {
      title: "讲解要点",
      groundY: 800,
      figures: [{ action: "指", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-wave-hello",
    componentId: "stick-figure",
    label: "挥手打招呼",
    params: {
      title: "你好",
      groundY: 800,
      figures: [{ action: "挥手", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-jump-joy",
    componentId: "stick-figure",
    label: "庆祝跳跃",
    params: {
      title: "庆祝时刻",
      groundY: 800,
      figures: [{ action: "跳", fromX: 500, toX: 500 }],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      travelMs: 1000,
    },
  },
  {
    templateId: "stick-meet",
    componentId: "stick-figure",
    label: "两人相遇",
    params: {
      title: "相遇问好",
      groundY: 800,
      figures: [
        { action: "走", fromX: 80, toX: 420 },
        { action: "走", fromX: 920, toX: 580 },
        { action: "挥手", fromX: 500, toX: 500 },
      ],
      ...STICK_COLORS,
      enterMs: 400,
      cycleMs: 1000,
      // 终评 I-1：最迟人物（i=1，梯次 200）200+400+1000=1600 ≤1800
      travelMs: 1000,
    },
  },
];

export function isStickComponentId(componentId: string): boolean {
  return componentId === "stick-figure";
}

export function applyStickTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = STICK_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) return { spec: null, error: `未知火柴人模板 ${templateId}` };
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

export type StickEditDraft = {
  title: string;
  // 每行一个人物 `动作,fromX[,toX]`（动作 走/站/挥手/指/跳，坐标 0..1000；
  // toX 缺省 = fromX）
  data: string;
};

export function draftStickFromSpec(spec: SceneSpec): StickEditDraft {
  const params = spec.params as {
    title?: string;
    figures?: Array<{ action: string; fromX: number; toX: number }>;
  };
  return {
    title: params.title ?? "",
    data: (params.figures ?? [])
      .map((f) =>
        f.toX === f.fromX
          ? `${f.action},${f.fromX}`
          : `${f.action},${f.fromX},${f.toX}`,
      )
      .join("\n"),
  };
}

const STICK_ACTIONS = new Set(["走", "站", "挥手", "指", "跳"]);

// 坐标段：Number("")===0 是 JS 陷阱——空段显式拒绝；Number 对全角数字返回
// NaN，天然拒绝
function coord(raw: string): number | null {
  if (raw.length === 0) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : null;
}

function parseFigureLine(
  line: string,
): { action: string; fromX: number; toX: number } | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!STICK_ACTIONS.has(parts[0]!)) return null;
  const fromX = coord(parts[1]!);
  if (fromX === null) return null;
  let toX = fromX;
  if (parts.length === 3) {
    const to = coord(parts[2]!);
    if (to === null) return null;
    toX = to;
  }
  return { action: parts[0]!, fromX, toX };
}

function splitLines(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildStickRevisePatch(
  spec: SceneSpec,
  draft: StickEditDraft,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (!isStickComponentId(spec.componentId)) {
    return { spec: null, error: "当前镜头组件不是火柴人组件" };
  }
  const lines = splitLines(draft.data);
  if (lines.length < 1) {
    return { spec: null, error: "火柴人至少需要一行（1 个人物）" };
  }
  if (lines.length > 3) {
    return { spec: null, error: "火柴人最多 3 行（人数上限）" };
  }
  const figures: Array<{ action: string; fromX: number; toX: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i]!.split(",")[0]!.trim();
    if (!STICK_ACTIONS.has(head)) {
      return {
        spec: null,
        error: `第 ${i + 1} 行：动作必须是 走/站/挥手/指/跳`,
      };
    }
    const parsed = parseFigureLine(lines[i]!);
    if (!parsed) {
      return {
        spec: null,
        error: `第 ${i + 1} 行：动作,起点x[,终点x] 格式不符（坐标 0..1000）`,
      };
    }
    figures.push(parsed);
  }
  const params = {
    ...(spec.params as Record<string, unknown>),
    title: draft.title,
    figures,
  };
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
