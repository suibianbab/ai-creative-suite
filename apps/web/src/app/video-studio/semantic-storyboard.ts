// 语义分镜 IR + 校验 + 确定性编译器（2026-10-26 任务）。
// 模型输出 SemanticStoryboardDraft JSON（受限 IR），编译器从已有注册组件
// 中选型并产出 StoryboardResult——模型不直接输出 SceneSpec/代码/路径。
import { quantizeTimeline, ZeroFrameShotError } from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import type { PlanResult, StoryboardShot } from "./planner";

// —— 能力目录（IR 限制全部锚定实际组件契约，见 packages/video-scene）——
// · text-animation@1：title ≤80、subtitle ≤80、entrance fade-up|scale-in。
// · sketch-note@1：title ≤40、items 1..5、item.text ≤12、write/draw 200..6000、
//   stagger 120..1200；条目 i 时序 delay=160+i×stagger，末条目写完需
//   160+(n-1)×500+900+700，加 400ms 停留 → 时长下限 2160+(n-1)×500。
// · explainer-composition@1：title ≤32、diagram.cycle steps 3..6（label ≤6、
//   caption ≤12）、diagram.flow steps 2..8（label ≤10，经 flow-steps 校验）、
//   annotations 1..3（text ≤20、enterMs 0..3500）；cycle 时序（stagger 480/
//   入场 500/短注 +700/弧 +380+160）演完需 (n-1)×480+3000（含停留）；
//   flow 演完需 2500+(n-1)×120。
// · 旁白预算（与 planner SPEECH_* 同口径）：durationMs ≥ 400+300×字数，
//   否则镜头读不完旁白不许出厂。
const SPEECH_LEAD_IN_MS = 400;
const SPEECH_MS_PER_CHAR = 300;
const STORYBOARD_FPS = 24;

export type SemanticIntent =
  | "title"
  | "text-explainer"
  | "cycle-explainer"
  | "flow-explainer";

export type SemanticDraftShot = {
  intent: SemanticIntent;
  title: string;
  narrationText: string;
  durationMs: number;
  /** text-explainer 的 1-3 条要点 */
  bullets?: string[];
  /** cycle-explainer 的 3-5 阶段 */
  cycleSteps?: Array<{ label: string; caption?: string }>;
  /** flow-explainer 的 2-4 步骤 */
  flowSteps?: string[];
};

export type SemanticStoryboardDraft = {
  topic: string;
  title: string;
  shots: SemanticDraftShot[];
};

const INTENTS = new Set(["title", "text-explainer", "cycle-explainer", "flow-explainer"]);

// 各 intent 的「演完 + 停留」时长下限（ms），由上方能力目录推出。
function minDurationMs(intent: SemanticIntent, shot: SemanticDraftShot): number {
  switch (intent) {
    case "title":
      return 2000;
    case "text-explainer":
      return 2160 + Math.max(0, (shot.bullets?.length ?? 1) - 1) * 500;
    case "cycle-explainer":
      return 3000 + Math.max(0, (shot.cycleSteps?.length ?? 3) - 1) * 480;
    case "flow-explainer":
      return 2500 + Math.max(0, (shot.flowSteps?.length ?? 2) - 1) * 120;
  }
}

export function narrationCharBudget(durationMs: number): number {
  return Math.floor((durationMs - SPEECH_LEAD_IN_MS) / SPEECH_MS_PER_CHAR);
}

// 投影总时长：逐镜延长（演完下限+旁白预算）后的 Σ——路由的时长目标检查
// 与偏离标注用这个值（用户拿到的就是它），不用 IR 原始 Σ。
export function projectedTotalMs(draft: SemanticStoryboardDraft): number {
  return draft.shots.reduce((ms, shot) => ms + effectiveDurationMs(shot), 0);
}

export type SemanticValidation =
  | { ok: true; draft: SemanticStoryboardDraft }
  | { ok: false; errors: string[] };

export function validateSemanticDraft(raw: unknown): SemanticValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["IR 必须是对象"] };
  }
  const d = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof d.topic !== "string" || d.topic.length < 1 || d.topic.length > 40) {
    errors.push("topic 须为 1..40 字");
  }
  if (typeof d.title !== "string" || d.title.length < 1 || d.title.length > 30) {
    errors.push("title 须为 1..30 字");
  }
  if (!Array.isArray(d.shots)) {
    // 无法逐镜校验，只有这一条错误可报。
    return { ok: false, errors: [...errors, "shots 须为 3..8 镜"] };
  }
  if (d.shots.length < 3 || d.shots.length > 8) {
    // 镜数越界仍继续逐镜校验：一次把所有问题报全，方便 Provider 重试与用户定位。
    errors.push("shots 须为 3..8 镜");
  }
  const shots: SemanticDraftShot[] = [];
  for (const [i, shot] of (d.shots as Array<Record<string, unknown>>).entries()) {
    const field = `shots[${i}]`;
    if (typeof shot !== "object" || shot === null || Array.isArray(shot)) {
      errors.push(`${field} 须为对象`);
      continue;
    }
    if (typeof shot.intent !== "string" || !INTENTS.has(shot.intent)) {
      errors.push(`${field}.intent 须为 ${[...INTENTS].join("/")}`);
      continue;
    }
    const intent = shot.intent as SemanticIntent;
    // 标题上限取各目标组件契约的交集（explainer-composition ≤32）。
    if (typeof shot.title !== "string" || shot.title.length < 1 || shot.title.length > 32) {
      errors.push(`${field}.title 须为 1..32 字`);
    }
    if (typeof shot.narrationText !== "string" || shot.narrationText.length < 1) {
      errors.push(`${field}.narrationText 须为非空字符串`);
    }
    if (typeof shot.durationMs !== "number" || !Number.isInteger(shot.durationMs) || shot.durationMs < 2000 || shot.durationMs > 6000) {
      errors.push(`${field}.durationMs 须为 2000..6000 的整数`);
    }
    const shaped = shot as unknown as SemanticDraftShot;
    if (typeof shot.narrationText === "string") {
      // 旁白硬上限 = 6000ms（IR 时长上限）的预算 floor((6000-400)/300)=18 字：
      // 低于它的超额由编译器确定性延长吸收（durationMs 是模型的下限意图，
      // 同旧规划器 speechAwareDurationMs 的下限语义）；超过它无论如何延长
      // 都读不完，才是校验错误。
      const chars = [...shot.narrationText.trim()].length;
      const absoluteBudget = narrationCharBudget(6000);
      if (chars > absoluteBudget) {
        errors.push(
          `${field} 旁白 ${chars} 字超出可读上限：单镜最长 6000ms 最多 ${absoluteBudget} 字，请精简或拆镜`,
        );
      }
    }
    if (intent === "text-explainer") {
      if (!Array.isArray(shot.bullets) || shot.bullets.length < 1 || shot.bullets.length > 3) {
        errors.push(`${field}.bullets 须为 1..3 条`);
      } else {
        for (const [j, b] of (shot.bullets as unknown[]).entries()) {
          // sketch-note item.text ≤12（按码点计数，同组件口径）。
          if (typeof b !== "string" || [...b].length < 1 || [...b].length > 12) {
            errors.push(`${field}.bullets[${j}] 须为 1..12 字`);
          }
        }
      }
    }
    if (intent === "cycle-explainer") {
      if (!Array.isArray(shot.cycleSteps) || shot.cycleSteps.length < 3 || shot.cycleSteps.length > 5) {
        errors.push(`${field}.cycleSteps 须为 3..5 阶段`);
      } else {
        for (const [j, step] of (shot.cycleSteps as Array<Record<string, unknown>>).entries()) {
          if (typeof step?.label !== "string" || step.label.length < 1 || step.label.length > 6) {
            errors.push(`${field}.cycleSteps[${j}].label 须为 1..6 字`);
          }
          if (
            step?.caption !== undefined &&
            (typeof step.caption !== "string" || step.caption.length < 1 || step.caption.length > 12)
          ) {
            errors.push(`${field}.cycleSteps[${j}].caption 须为 1..12 字`);
          }
        }
      }
    }
    if (intent === "flow-explainer") {
      if (!Array.isArray(shot.flowSteps) || shot.flowSteps.length < 2 || shot.flowSteps.length > 4) {
        errors.push(`${field}.flowSteps 须为 2..4 步`);
      } else {
        for (const [j, s] of (shot.flowSteps as unknown[]).entries()) {
          if (typeof s !== "string" || s.length < 1 || s.length > 6) {
            errors.push(`${field}.flowSteps[${j}] 须为 1..6 字`);
          }
        }
      }
    }
    shots.push(shot as unknown as SemanticDraftShot);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, draft: { topic: d.topic as string, title: d.title as string, shots } };
}

// —— 确定性编译器：IR → SceneSpec（只选已注册组件）——
// durationMs 是模型的「下限意图」：编译器确定性延长到 max(IR 时长, 演完
// 下限, 旁白预算)，同旧规划器 speechAwareDurationMs 的下限语义——旁白
// 读不完/画面演不完的镜头不许出厂，但不把矛盾推回给模型重试。
function effectiveDurationMs(shot: SemanticDraftShot): number {
  const chars = [...shot.narrationText.trim()].length;
  const speechMs = SPEECH_LEAD_IN_MS + chars * SPEECH_MS_PER_CHAR;
  return Math.max(shot.durationMs, minDurationMs(shot.intent, shot), speechMs);
}

function baseSpec(
  componentId: string,
  durationMs: number,
  params: Record<string, unknown>,
  seed: number,
  background = "#101f34",
): SceneSpec {
  return {
    specVersion: 1,
    componentId,
    componentVersion: 1,
    durationMs,
    seed,
    background,
    params,
  };
}

const CYCLE_COLORS = {
  titleColor: "#f3f5f7",
  textColor: "#f3f5f7",
  boxColor: "#dcebe1",
  arrowColor: "#f5b652",
  strokeColor: "#42a5a0",
};

function compileTitle(shot: SemanticDraftShot, seed: number): SceneSpec {
  return baseSpec("text-animation", effectiveDurationMs(shot), {
    title: shot.title,
    subtitle: shot.narrationText,
    titleColor: "#f3f5f7",
    subtitleColor: "#b4d8e4",
    entrance: "fade-up",
    enterMs: 450,
  }, seed);
}

function compileTextExplainer(shot: SemanticDraftShot, seed: number): SceneSpec {
  return baseSpec("sketch-note", effectiveDurationMs(shot), {
    title: shot.title,
    items: (shot.bullets ?? []).map((b, i) => ({
      text: b,
      emphasis: i === 0 ? "下划线" : "圈",
    })),
    inkColor: "#f3f5f7",
    accentColor: "#f5b652",
    writeMs: 900,
    drawMs: 700,
    staggerMs: 500,
  }, seed);
}

function compileCycleExplainer(shot: SemanticDraftShot, seed: number): SceneSpec {
  return baseSpec("explainer-composition", effectiveDurationMs(shot), {
    ...CYCLE_COLORS,
    title: shot.title,
    titleY: 145,
    titleEnterMs: 0,
    diagramOffsetX: 0,
    diagramOffsetY: -60,
    diagramEnterMs: 450,
    diagram: {
      kind: "cycle",
      steps: (shot.cycleSteps ?? []).map((s) => ({
        label: s.label,
        caption: s.caption ?? s.label,
      })),
    },
    // 旁白注解 enterMs=400：阅读窗 = durationMs-400 ≥ 300×旁白字数
    // （验证器已保证 durationMs ≥ 400+300×字数），屏幕文字读得完。
    annotations: [{
      text: shot.narrationText,
      x: 500, y: 780, portraitY: 1340, enterMs: 400,
    }],
  }, seed);
}

function compileFlowExplainer(shot: SemanticDraftShot, seed: number): SceneSpec {
  return baseSpec("explainer-composition", effectiveDurationMs(shot), {
    ...CYCLE_COLORS,
    title: shot.title,
    titleY: 145,
    titleEnterMs: 0,
    diagramOffsetX: 0,
    diagramOffsetY: -75,
    diagramEnterMs: 450,
    diagram: { kind: "flow", steps: (shot.flowSteps ?? []).map((s) => ({ label: s })) },
    annotations: [{
      text: shot.narrationText,
      x: 500, y: 730, portraitY: 1260, enterMs: 400,
    }],
  }, seed);
}

const INTENT_LABEL: Record<SemanticIntent, string> = {
  "title": "标题",
  "text-explainer": "要点解说",
  "cycle-explainer": "循环图解",
  "flow-explainer": "流程图解",
};

export type CompiledStoryboard = {
  ok: true;
  sentence: string;
  title: string;
  totalMs: number;
  shots: StoryboardShot[];
};

// 编译结果 ok:true 变体与 planner.StoryboardResult 的 ok:true 结构相同，
// 确认卡/applyStoryboard 可直接消费；失败变体带 errors[]（AI 路径 UI 用）。
export function compileSemanticDraft(
  draft: SemanticStoryboardDraft,
  sentence: string,
): CompiledStoryboard | { ok: false; errors: string[] } {
  const shots: StoryboardShot[] = [];
  const errors: string[] = [];
  for (const [i, shot] of draft.shots.entries()) {
    let spec: SceneSpec;
    const seed = 5000 + i * 7;
    try {
      switch (shot.intent) {
        case "title":
          spec = compileTitle(shot, seed);
          break;
        case "text-explainer":
          spec = compileTextExplainer(shot, seed);
          break;
        case "cycle-explainer":
          spec = compileCycleExplainer(shot, seed);
          break;
        case "flow-explainer":
          spec = compileFlowExplainer(shot, seed);
          break;
      }
      validateSceneSpec(spec, defaultRegistry);
      shots.push({
        label: INTENT_LABEL[shot.intent],
        description: `${shot.title}（${INTENT_LABEL[shot.intent]}）`,
        narrationText: shot.narrationText,
        plan: { ok: true, spec, title: shot.title, renderHint: INTENT_LABEL[shot.intent] },
      });
    } catch (err) {
      errors.push(`镜 ${i + 1} 编译失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const totalMs = shots.reduce((ms, s) => ms + s.plan.spec.durationMs, 0);
  // 24fps 零帧预检（同 planStoryboard 口径）：零帧是编排错误，不许静默过。
  try {
    quantizeTimeline(
      shots.map((s) => s.plan.spec.durationMs),
      STORYBOARD_FPS,
    );
  } catch (error) {
    if (error instanceof ZeroFrameShotError) {
      return { ok: false, errors: [error.message] };
    }
    throw error;
  }
  return { ok: true, sentence, title: draft.title, totalMs, shots };
}
