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
  | "flow-explainer"
  | "compare-explainer"
  | "timeline-explainer";

export type SemanticDraftShot = {
  intent: SemanticIntent;
  title: string;
  narrationText: string;
  durationMs: number;
  /** text-explainer 的 1-3 条要点 */
  bullets?: string[];
  /** cycle-explainer 的 3-5 阶段（纯 label；caption 已从 IR 移除，P2-3） */
  cycleSteps?: string[];
  /** flow-explainer 的 2-4 步骤 */
  flowSteps?: string[];
  /** compare-explainer 的前后对比（数值/事实须来自用户原话，N3） */
  metricLabel?: string;
  beforeLabel?: string;
  beforeValue?: string;
  beforeNote?: string;
  afterLabel?: string;
  afterValue?: string;
  afterNote?: string;
  deltaText?: string;
  deltaPositive?: boolean;
  /** timeline-explainer 的 2-6 里程碑（无日期时用顺序词，N3） */
  milestones?: Array<{
    date: string;
    label: string;
    status?: "done" | "active" | "pending";
  }>;
};

export type SemanticStoryboardDraft = {
  topic: string;
  title: string;
  shots: SemanticDraftShot[];
};

// 严格键集合（P1-2，Codex 复核 2026-10-26）：模型输出只许这些字段——
// 未知字段（尤其资产引用/代码）一律拒绝；资产类键给素材边界指引，
// 「要真实照片」的需求不得被无声转成通用图解。
const ROOT_KEYS = new Set(["topic", "title", "shots"]);
const SHOT_BASE_KEYS = new Set([
  "intent",
  "title",
  "narrationText",
  "durationMs",
]);
const SHOT_KEYS_BY_INTENT: Record<SemanticIntent, Set<string>> = {
  title: new Set([]),
  "text-explainer": new Set(["bullets"]),
  "cycle-explainer": new Set(["cycleSteps"]),
  "flow-explainer": new Set(["flowSteps"]),
  "compare-explainer": new Set([
    "metricLabel",
    "beforeLabel",
    "beforeValue",
    "beforeNote",
    "afterLabel",
    "afterValue",
    "afterNote",
    "deltaText",
    "deltaPositive",
  ]),
  "timeline-explainer": new Set(["milestones"]),
};
// 常见资产/代码字段名 → 指引文案（模型请求画不出的东西时明说下一步）。
const ASSET_KEYS =
  /asset|image|photo|pic|src|url|link|media|file|html|svg|css|js|code|script/i;
const ASSET_GUIDANCE =
  "本版本不能引用外部素材/照片/代码：请改用图解表述（title/text-explainer/cycle-explainer/flow-explainer），或由用户在素材面板人工导入";

const INTENTS = new Set([
  "title",
  "text-explainer",
  "cycle-explainer",
  "flow-explainer",
  "compare-explainer",
  "timeline-explainer",
]);

// 各 intent 的「演完 + 停留」时长下限（ms），由上方能力目录推出。
function minDurationMs(
  intent: SemanticIntent,
  shot: SemanticDraftShot,
): number {
  switch (intent) {
    case "title":
      return 2000;
    case "text-explainer":
      return 2160 + Math.max(0, (shot.bullets?.length ?? 1) - 1) * 500;
    case "cycle-explainer":
      return 3000 + Math.max(0, (shot.cycleSteps?.length ?? 3) - 1) * 480;
    case "flow-explainer":
      return 2500 + Math.max(0, (shot.flowSteps?.length ?? 2) - 1) * 120;
    // compare：before(200+900)→after(1600)→delta(1400+600=2000)+停留。
    case "compare-explainer":
      return 2500;
    // timeline：enterMs 1400 + 轴线/节点 span 600+(n-1)×300+500 + 停留。
    case "timeline-explainer":
      return 2900 + Math.max(0, (shot.milestones?.length ?? 2) - 1) * 300;
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

// 用户句的「真实素材」需求识别（P1，Codex 二轮复核 2026-10-27）：能力边界
// 必须在规划前确定性判定，不能依赖模型自觉——模型可能顺从提示词把「要
// 真实照片」静默改成合法图解 IR，字段校验照样通过。高精度口径：
// 「真实/实拍/产品 × 照片/图片/素材/画面」或在使用、导入等动词后提及
// 素材；题材词（如摄影构图）不匹配。未知说法仍需在确认卡核对能力边界。
const ASSET_DEMAND =
  /(?:真实|实拍|原始|客户提供|我上传|已有|现有|产品|商品).{0,10}?(?:照片|图片|图像|素材|画面|原图|产品图|商品图|实拍视频)|(?:用|使用|插入|导入|引用|上传|配上?|加上?|放入|换上?|基于|根据|拿).{0,12}?(?:照片|图片|图像|素材|画面|原图|产品图|商品图|实拍视频)/;
const NEGATED_ASSET_DEMAND =
  /(?:不要|不需要|无需|不用|别用|不必)(?:.{0,12}?)(?:照片|图片|图像|素材|画面|原图|产品图|商品图|实拍视频)/g;

export function requiresRealAssets(sentence: string): boolean {
  return ASSET_DEMAND.test(sentence.replace(NEGATED_ASSET_DEMAND, ""));
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
  // 根级严格键集合（P1-2）。
  for (const key of Object.keys(d))
    if (!ROOT_KEYS.has(key))
      errors.push(
        `未知根字段「${key}」${ASSET_KEYS.test(key) ? `。${ASSET_GUIDANCE}` : "（只允许 topic/title/shots）"}`,
      );
  if (
    typeof d.topic !== "string" ||
    d.topic.length < 1 ||
    d.topic.length > 40
  ) {
    errors.push("topic 须为 1..40 字");
  }
  if (
    typeof d.title !== "string" ||
    d.title.length < 1 ||
    d.title.length > 30
  ) {
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
  for (const [i, rawShot] of (d.shots as unknown[]).entries()) {
    const result = validateSemanticShot(rawShot, `shots[${i}]`);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    shots.push(result.shot);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: { topic: d.topic as string, title: d.title as string, shots },
  };
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
  componentVersion = 1,
): SceneSpec {
  return {
    specVersion: 1,
    componentId,
    componentVersion,
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
  return baseSpec(
    "text-animation",
    effectiveDurationMs(shot),
    {
      title: shot.title,
      subtitle: shot.narrationText,
      titleColor: "#f3f5f7",
      subtitleColor: "#b4d8e4",
      entrance: "fade-up",
      enterMs: 450,
    },
    seed,
  );
}

function compileTextExplainer(
  shot: SemanticDraftShot,
  seed: number,
): SceneSpec {
  return baseSpec(
    "sketch-note",
    effectiveDurationMs(shot),
    {
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
    },
    seed,
  );
}

function compileCycleExplainer(
  shot: SemanticDraftShot,
  seed: number,
): SceneSpec {
  return baseSpec(
    "explainer-composition",
    effectiveDurationMs(shot),
    {
      ...CYCLE_COLORS,
      title: shot.title,
      titleY: 145,
      titleEnterMs: 0,
      diagramOffsetX: 0,
      // -60：竖版顶部净空（-30 实测首阶段 caption 撞标题，2026-10-26）。
      diagramOffsetY: -60,
      diagramEnterMs: 450,
      diagram: {
        kind: "cycle",
        // 阶段只上屏 label（P2-3：IR 已无 caption——上屏 caption 与底部旁白
        // 注解恒碰撞，细节信息必须写进 label 或旁白，编译不静默丢内容）。
        steps: (shot.cycleSteps ?? []).map((label) => ({ label })),
      },
      // 旁白注解 enterMs=400：阅读窗 = durationMs-400 ≥ 300×旁白字数
      // （验证器已保证 durationMs ≥ 400+300×字数），屏幕文字读得完。
      // 居中 x=500 与底部阶段 label（design y≈715..746）净空 17 单位。
      annotations: [
        {
          text: shot.narrationText,
          x: 500,
          y: 780,
          portraitY: 1340,
          enterMs: 400,
        },
      ],
    },
    seed,
  );
}

function compileFlowExplainer(
  shot: SemanticDraftShot,
  seed: number,
): SceneSpec {
  // flow 用独立 flow-steps@1（交接单预留路线）：explainer-composition 的
  // flow 竖版布局由组件内部重排（diagramOffsetY/titleY 均不生效），首步
  // 与标题恒叠位（offset-sweep 实测全参数空间无净窗）；flow-steps 自带
  // 标题布局，横/纵×2..4 步×双画幅最坏内容零碰撞（flow-steps-sweep 实测）。
  // 纵向列在横竖两版都居中可读；旁白走 TTS/确认卡，不上屏（无注解位）。
  return baseSpec(
    "flow-steps",
    effectiveDurationMs(shot),
    {
      title: shot.title,
      steps: (shot.flowSteps ?? []).map((s) => ({ label: s })),
      direction: "vertical",
      boxColor: "#dcebe1",
      arrowColor: "#f5b652",
      textColor: "#f3f5f7",
      enterMs: 700,
    },
    seed,
  );
}

const INTENT_LABEL: Record<SemanticIntent, string> = {
  title: "标题",
  "text-explainer": "要点解说",
  "cycle-explainer": "循环图解",
  "flow-explainer": "流程图解",
  "compare-explainer": "前后对比",
  "timeline-explainer": "阶段时间线",
};

// 确认卡预告观众将看到的屏幕文字（交接单 §3.3：目的、画面内容、屏幕文字、
// 旁白、时长及模板边界）——不只报组件名/意图词。
// N3：前后对比（compare-split@2）——数值/事实来自用户原话（路由层经
// verifySourcedNumbers 把关），编译器决定配色/入场/布局，不接受模型原始参数。
const COMPARE_COLORS = {
  textColor: "#f3f5f7",
  panelColor: "#1b2f4a",
  accentColor: "#f5b652",
  positiveColor: "#37b26c",
  negativeColor: "#e2654f",
};

function compileCompareExplainer(
  shot: SemanticDraftShot,
  seed: number,
): SceneSpec {
  return baseSpec(
    "compare-split",
    effectiveDurationMs(shot),
    {
      title: shot.title,
      metricLabel: shot.metricLabel ?? "",
      beforeLabel: shot.beforeLabel ?? "",
      beforeValue: shot.beforeValue ?? "",
      beforeNote: shot.beforeNote ?? "",
      afterLabel: shot.afterLabel ?? "",
      afterValue: shot.afterValue ?? "",
      afterNote: shot.afterNote ?? "",
      deltaText: shot.deltaText ?? "",
      deltaPositive: shot.deltaPositive === true,
      ...COMPARE_COLORS,
      enterMs: 900,
      sequence: "stagger",
    },
    seed,
    "#101f34",
    2,
  );
}

// N3：阶段时间线（timeline-milestones@2）——date 槽用户没给日期时用顺序词，
// 编译默认 status=done（已讲完的顺序叙事）；配色/入场为编译器常量。
const TIMELINE_COLORS = {
  textColor: "#f3f5f7",
  lineColor: "#3b5878",
  doneColor: "#37b26c",
  activeColor: "#f5b652",
  pendingColor: "#8fa3b8",
};

function compileTimelineExplainer(
  shot: SemanticDraftShot,
  seed: number,
): SceneSpec {
  return baseSpec(
    "timeline-milestones",
    effectiveDurationMs(shot),
    {
      title: shot.title,
      milestones: (shot.milestones ?? []).map((m) => ({
        date: m.date,
        label: m.label,
        status: m.status ?? "done",
      })),
      ...TIMELINE_COLORS,
      enterMs: 1400,
      sequence: "stagger",
    },
    seed,
    "#101f34",
    2,
  );
}

function renderHintFor(shot: SemanticDraftShot): string {
  const base = `${INTENT_LABEL[shot.intent]}「${shot.title}」`;
  switch (shot.intent) {
    case "title":
      return `${base}，副标题「${shot.narrationText}」`;
    case "text-explainer":
      return `${base}，要点：${(shot.bullets ?? []).join("、")}`;
    case "cycle-explainer":
      return `${base}，循环阶段：${(shot.cycleSteps ?? []).join(" → ")}`;
    case "flow-explainer":
      return `${base}，流程：${(shot.flowSteps ?? []).join(" → ")}`;
    case "compare-explainer":
      return `${base}，${shot.metricLabel ?? ""}：${shot.beforeLabel ?? ""}${shot.beforeValue ?? ""} → ${shot.afterLabel ?? ""}${shot.afterValue ?? ""}（${shot.deltaText ?? ""}）`;
    case "timeline-explainer":
      return `${base}，阶段：${(shot.milestones ?? [])
        .map((m) => `${m.date}·${m.label}`)
        .join(" → ")}`;
  }
}

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
    try {
      shots.push(compileSemanticShot(shot, 5000 + i * 7));
    } catch (err) {
      errors.push(
        `镜 ${i + 1} 编译失败：${err instanceof Error ? err.message : String(err)}`,
      );
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

// —— N2（交接单 2026-10-27）：单镜校验/编译导出 ——
// 与整片路径同一套规则（严格键集合、旁白预算、确定性延长、renderHint），
// 「AI 修改此镜头」候选与整片规划行为同源；field 用于错误定位前缀。
export function validateSemanticShot(
  raw: unknown,
  field = "shot",
): { ok: true; shot: SemanticDraftShot } | { ok: false; errors: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`${field} 须为对象`] };
  }
  const shot = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof shot.intent !== "string" || !INTENTS.has(shot.intent)) {
    return {
      ok: false,
      errors: [`${field}.intent 须为 ${[...INTENTS].join("/")}`],
    };
  }
  const intent = shot.intent as SemanticIntent;
  const allowedKeys = new Set([
    ...SHOT_BASE_KEYS,
    ...SHOT_KEYS_BY_INTENT[intent],
  ]);
  for (const key of Object.keys(shot))
    if (!allowedKeys.has(key))
      errors.push(
        `未知字段 ${field}.${key}${ASSET_KEYS.test(key) ? `。${ASSET_GUIDANCE}` : "（不在该 intent 的契约内）"}`,
      );
  // I-3（独立评审）：compare-split/timeline-milestones 组件 title 上限 30，
  // 其余组件 ≥40——按 intent 取各自真实契约，不共用 32。
  const titleMax =
    intent === "compare-explainer" || intent === "timeline-explainer" ? 30 : 32;
  if (
    typeof shot.title !== "string" ||
    shot.title.length < 1 ||
    shot.title.length > titleMax
  ) {
    errors.push(`${field}.title 须为 1..${titleMax} 字`);
  }
  if (typeof shot.narrationText !== "string" || shot.narrationText.length < 1) {
    errors.push(`${field}.narrationText 须为非空字符串`);
  }
  if (
    typeof shot.durationMs !== "number" ||
    !Number.isInteger(shot.durationMs) ||
    shot.durationMs < 2000 ||
    shot.durationMs > 6000
  ) {
    errors.push(`${field}.durationMs 须为 2000..6000 的整数`);
  }
  if (typeof shot.narrationText === "string") {
    const chars = [...shot.narrationText.trim()].length;
    const absoluteBudget = narrationCharBudget(6000);
    if (chars > absoluteBudget) {
      errors.push(
        `${field} 旁白 ${chars} 字超出可读上限：单镜最长 6000ms 最多 ${absoluteBudget} 字，请精简或拆镜`,
      );
    }
  }
  if (intent === "text-explainer") {
    if (
      !Array.isArray(shot.bullets) ||
      shot.bullets.length < 1 ||
      shot.bullets.length > 3
    ) {
      errors.push(`${field}.bullets 须为 1..3 条`);
    } else {
      for (const [j, b] of (shot.bullets as unknown[]).entries()) {
        if (typeof b !== "string" || [...b].length < 1 || [...b].length > 12) {
          errors.push(`${field}.bullets[${j}] 须为 1..12 字`);
        }
      }
    }
  }
  if (intent === "cycle-explainer") {
    if (
      !Array.isArray(shot.cycleSteps) ||
      shot.cycleSteps.length < 3 ||
      shot.cycleSteps.length > 5
    ) {
      errors.push(`${field}.cycleSteps 须为 3..5 个字符串阶段名`);
    } else {
      for (const [j, step] of (shot.cycleSteps as unknown[]).entries()) {
        if (typeof step !== "string" || step.length < 1 || step.length > 6) {
          errors.push(`${field}.cycleSteps[${j}] 须为 1..6 字的字符串`);
        }
      }
    }
  }
  if (intent === "flow-explainer") {
    if (
      !Array.isArray(shot.flowSteps) ||
      shot.flowSteps.length < 2 ||
      shot.flowSteps.length > 4
    ) {
      errors.push(`${field}.flowSteps 须为 2..4 步`);
    } else {
      for (const [j, s] of (shot.flowSteps as unknown[]).entries()) {
        if (typeof s !== "string" || s.length < 1 || s.length > 10) {
          errors.push(`${field}.flowSteps[${j}] 须为 1..10 字`);
        }
      }
    }
  }
  // P1-1（Codex 复核 2026-10-27）：新 intent 的全部字段在校验层拦形状——
  // 坏数据不得漏进数值闸（TypeError→500）或拖到编译期才失败。
  if (intent === "compare-explainer") {
    // compare-split@2 契约：metric ≤20、label/value ≤12、note ≤20、delta ≤16。
    const stringFields: Array<[string, number]> = [
      ["metricLabel", 20],
      ["beforeLabel", 12],
      ["beforeValue", 12],
      ["beforeNote", 20],
      ["afterLabel", 12],
      ["afterValue", 12],
      ["afterNote", 20],
      ["deltaText", 16],
    ];
    for (const [key, max] of stringFields) {
      const value = (shot as Record<string, unknown>)[key];
      if (typeof value !== "string" || value.length < 1 || value.length > max)
        errors.push(`${field}.${key} 须为 1..${max} 字`);
    }
    if (typeof shot.deltaPositive !== "boolean")
      errors.push(`${field}.deltaPositive 须为布尔（true=改善）`);
  }
  if (intent === "timeline-explainer") {
    // timeline-milestones@2 契约：2..6 项，date ≤10（无日期用顺序词）、
    // label ≤12；status 可省（编译默认 done=已讲完的顺序）。
    if (
      !Array.isArray(shot.milestones) ||
      shot.milestones.length < 2 ||
      shot.milestones.length > 6
    ) {
      errors.push(`${field}.milestones 须为 2..6 项`);
    } else {
      for (const [j, item] of (
        shot.milestones as Array<Record<string, unknown> | null>
      ).entries()) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          errors.push(`${field}.milestones[${j}] 须为对象`);
          continue;
        }
        if (
          typeof item.date !== "string" ||
          item.date.length < 1 ||
          item.date.length > 10
        )
          errors.push(
            `${field}.milestones[${j}].date 须为 1..10 字（无日期用顺序词，不得编造）`,
          );
        if (
          typeof item.label !== "string" ||
          item.label.length < 1 ||
          item.label.length > 12
        )
          errors.push(`${field}.milestones[${j}].label 须为 1..12 字`);
        if (
          item.status !== undefined &&
          !["done", "active", "pending"].includes(String(item.status))
        )
          errors.push(
            `${field}.milestones[${j}].status 须为 done/active/pending`,
          );
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, shot: shot as unknown as SemanticDraftShot };
}

// 单镜编译：编译失败抛错（调用方定位镜头后转用户可见错误）。
export function compileSemanticShot(
  shot: SemanticDraftShot,
  seed: number,
): StoryboardShot {
  let spec: SceneSpec;
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
    case "compare-explainer":
      spec = compileCompareExplainer(shot, seed);
      break;
    case "timeline-explainer":
      spec = compileTimelineExplainer(shot, seed);
      break;
  }
  validateSceneSpec(spec, defaultRegistry);
  return {
    label: INTENT_LABEL[shot.intent],
    description: `${shot.title}（${INTENT_LABEL[shot.intent]}）`,
    narrationText: shot.narrationText,
    plan: {
      ok: true,
      spec,
      title: shot.title,
      renderHint: renderHintFor(shot),
    },
  };
}

// N3 数值/日期防伪造闸（交接单：时间点、数值和事实不能由模型伪造）。
// P1-2（Codex 复核 2026-10-27）收紧口径：
//  - 覆盖所有会展示/朗读的字段（title/narrationText/各 intent 的文字
//    条目），不再只查 value/delta/date——旁白里的编造数字同样拦。
//  - 只接受用户原话原样出现的数字；「两数之差」推导已移除（单位与可比
//    量无法可靠判定：1小时-30分钟 的差曾是 29 也被放行）。差值请模型
//    用原话数字表述（「从40缩短到15」）。
//  - 结构性序号豁免：「第N步/阶段/部分/幕/条/镜」不算事实数字。
// 注意：本闸只核数字来源，不证明文字事实为真——通用事实核验另行评估。
function numeralsOf(text: string): string[] {
  // 全角数字归一为半角（I-1：２５ 不得绕过）。
  const normalized = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  return [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

// 汉字数值 token（I-1）：一二三…千萬 组合视为数值表述，按原样子集闸——
// 原话没出现的组合（如「二十五」）不放行，原样引用（原话有「三十」）通过。
const CHINESE_NUMERAL = /[一二三四五六七八九十百千万]+/g;
function chineseNumeralsOf(text: string): string[] {
  return [...text.matchAll(CHINESE_NUMERAL)].map((m) => m[0]);
}
// Remove only the ordinal span, then check every remaining number. A field
// such as "第6步提高6%" contains one structural number and one factual claim.
const STRUCTURAL_ORDINAL =
  /第\s*[0-9０-９一二三四五六七八九十百千万]+\s*(?:步|阶段|部分|幕|条|镜)|[一二三四五六七八九十百千万]+(?:个阶段|阶段|步|部分|幕|条|镜|大|种|类|方面)/g;

function withoutStructuralOrdinals(value: string): string {
  return value.replace(STRUCTURAL_ORDINAL, "");
}

// 该镜头全部会上屏/被朗读的文字字段（P1-2 全覆盖口径）。
function displayedTexts(shot: SemanticDraftShot): Array<[string, string]> {
  const fields: Array<[string, string | undefined]> = [
    ["title", shot.title],
    ["narrationText", shot.narrationText],
  ];
  switch (shot.intent) {
    case "text-explainer":
      (shot.bullets ?? []).forEach((b, i) => fields.push([`bullets[${i}]`, b]));
      break;
    case "cycle-explainer":
      (shot.cycleSteps ?? []).forEach((s, i) =>
        fields.push([`cycleSteps[${i}]`, s]),
      );
      break;
    case "flow-explainer":
      (shot.flowSteps ?? []).forEach((s, i) =>
        fields.push([`flowSteps[${i}]`, s]),
      );
      break;
    case "compare-explainer":
      fields.push(
        ["metricLabel", shot.metricLabel],
        ["beforeLabel", shot.beforeLabel],
        ["beforeValue", shot.beforeValue],
        ["beforeNote", shot.beforeNote],
        ["afterLabel", shot.afterLabel],
        ["afterValue", shot.afterValue],
        ["afterNote", shot.afterNote],
        ["deltaText", shot.deltaText],
      );
      break;
    case "timeline-explainer":
      (shot.milestones ?? []).forEach((m, i) => {
        fields.push([`milestones[${i}].date`, m.date]);
        fields.push([`milestones[${i}].label`, m.label]);
      });
      break;
  }
  return fields.filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
}

export function verifySourcedNumbers(
  shot: SemanticDraftShot,
  userText: string,
): string[] {
  const sourced = new Set(numeralsOf(userText));
  const sourcedChinese = new Set(chineseNumeralsOf(userText));
  const errors: string[] = [];
  for (const [label, value] of displayedTexts(shot)) {
    const claims = withoutStructuralOrdinals(value);
    for (const numeral of numeralsOf(claims)) {
      if (sourced.has(numeral)) continue;
      errors.push(
        `数字「${numeral}」（${label}）不在你的原话里：数值/日期必须原样来自用户输入（差值也用原话数字表述），没给就改用文字表述`,
      );
    }
    // 汉字数值组合：原话没出现且非结构性序数 → 拒绝（I-1）。
    for (const token of chineseNumeralsOf(claims)) {
      if (sourcedChinese.has(token)) continue;
      errors.push(
        `数值表述「${token}」（${label}）不在你的原话里：汉字数字同样不得编造，没给就改用定性文字`,
      );
    }
  }
  return errors;
}
