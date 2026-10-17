"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  beginCloudLogin,
  cloudConfig,
  cloudSession,
  finishCloudLogin,
} from "../cloud-auth";
import {
  batchStepsFromConfirmedPlans,
  deriveBatchRequestKey,
  describePhotoCraftBatchStep,
  PHOTO_CRAFT_BATCH_PROJECT_LIMIT,
  type PhotoCraftBatchStep,
} from "./batch-recipe";
import {
  binarizeMaskPixels,
  decodeMaskPng,
  shouldRetryCandidateMaskAsOutline,
} from "./candidate-mask";
import * as CANDIDATE_RING from "./candidate-ring";
import {
  appendPhotoCraftCloudQualityReview,
  createPhotoCraftBatchConfirmation,
  enqueuePhotoCraftBatchRecipe,
  getPhotoCraftBatchRecipeStatus,
  getPhotoCraftCloudCredits,
  getPhotoCraftCloudEditJob,
  listPhotoCraftCloudProjects,
  listPhotoCraftCloudQualityReviews,
  loadPhotoCraftCloudSource,
  type PhotoCraftBatchConfirmation,
  type PhotoCraftBatchRecipeStatus,
  type PhotoCraftCloudEditJob,
  type PhotoCraftCloudProject,
  type PhotoCraftCloudQualityReview,
  savePhotoCraftCloudProject,
  submitPhotoCraftCloudEditJob,
} from "./cloud-projects";
import type { DefaultedSlot } from "./default-strategy";
import {
  describePhotoCraftPlan,
  type PhotoCraftInstructionPlan,
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  protectPhraseOf,
} from "./instruction";
import { extractTargetPhrase } from "./instruction-ir";
import {
  cachePhotoCraftCloudProject,
  hasUnsyncedPhotoCraftDraft,
  listPhotoCraftProjects,
  loadPhotoCraftProject,
  markPhotoCraftCloudVersion,
  type PhotoCraftLocalProject,
  type PhotoCraftQualityGrade,
  type PhotoCraftQualityReview,
  reviewPhotoCraftProject,
  savePhotoCraftProject,
} from "./local-projects";
import {
  canOfferExcludeRefine,
  classifyTargetPhrase,
  EXCLUDE_POINT_LIMIT,
  normalizeExcludePoint,
  normalizePromptBox,
  parseStatusMessage,
  shouldOfferSelectionEntry,
  topCandidatesSpread,
} from "./target-entry";
import "./photocraft.css";

const bridge = "http://127.0.0.1:4112";
const protocol = "acs-photocraft/1";
const qualityLabels: Record<PhotoCraftQualityGrade, string> = {
  ready: "可直接使用",
  minor: "可使用但有轻微瑕疵",
  manual: "需人工精修",
  unsuitable: "不适合该用途",
};
type EditResult = {
  id: string;
  width: number;
  height: number;
  layers: number;
  previewUrl: string;
  sourceUrl: string;
  selectionFallback?: "outline";
};
// M2 滑杆交接：数值表与 scripts/photocraft/live-adjustments.mjs 同源（桥端按
// 同一张表硬校验），这里只负责给 <input type="range"> 提供边界和中文标签。
const liveAdjustmentRanges: Record<string, Record<string, [number, number]>> = {
  BrightnessContrast: { brightness: [-150, 150], contrast: [-50, 100] },
  HueSaturation: {
    hue: [-180, 180],
    saturation: [-100, 100],
    lightness: [-100, 100],
  },
  Exposure: { exposure: [-20, 20], offset: [-0.5, 0.5], gamma: [0.01, 9.99] },
  Vibrance: { vibrance: [-100, 100], saturation: [-100, 100] },
  Levels: {
    inBlack: [0, 253],
    inWhite: [2, 255],
    gamma: [0.01, 9.99],
    outBlack: [0, 255],
    outWhite: [0, 255],
  },
};
// M3 §5 τ_auto 决策（含补充A 的默认关闭门控）抽在 candidate-ring.ts，
// 与自动选中/override 遥测分桶共用同一份纯函数。
const TAU_AUTO = CANDIDATE_RING.TAU_AUTO;
// M4 §7 线上回流（方案 §10 τ 校准）：确认环点击率 / 滑杆修改幅度 / 撤销率
// 按解析器分桶。事件只发本机桥接的 JSONL sink（dev 拓扑，.tools 本机目录），
// fire-and-forget——遥测失败绝不影响编辑本身；scripts/photocraft/calibrate-tau.mjs
// 离线汇总后月度调 TAU_AUTO。
function trackPhotoCraftTelemetry(
  event:
    | "interpret"
    | "ring-open"
    | "ring-outcome"
    | "slider"
    | "undo"
    | "apply",
  fields: Record<string, string | number | boolean | null>,
) {
  void fetch(`${bridge}/v1/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, ...fields }),
  }).catch(() => undefined);
}
const liveAdjustmentLabels: Record<string, string> = {
  BrightnessContrast: "亮度/对比度",
  HueSaturation: "色相/饱和度",
  Exposure: "曝光",
  Vibrance: "自然饱和度",
  Levels: "色阶",
};
const liveParamLabels: Record<string, string> = {
  brightness: "亮度",
  contrast: "对比度",
  hue: "色相",
  saturation: "饱和度",
  lightness: "明度",
  exposure: "曝光",
  offset: "偏移",
  gamma: "伽马",
  vibrance: "自然饱和度",
  inBlack: "黑场",
  inWhite: "白场",
  outBlack: "输出黑场",
  outWhite: "输出白场",
};
type LiveLayerInfo = {
  id: number;
  name: string;
  kind: string;
  visible: boolean;
  hasMask: boolean;
  adjustment: Record<string, Record<string, number>> | null;
};
type LiveTuningSession = {
  id: string;
  job: string;
  layer: number;
  layerName: string;
  kind: string;
  params: Record<string, number>;
  previewUrl: string;
};
type SourceInfo = {
  width: number;
  height: number;
  layers: number;
  profile: string;
  colorSpace: string;
  activeLayer: number | null;
  selectedLayers: number[];
  layerDetails: Array<{
    id: number;
    name: string;
    kind: string;
    visible: boolean;
    selected: boolean;
    hasMask: boolean;
  }>;
  hasSelection: boolean;
  selectionBounds: [number, number, number, number] | null;
};
type SelectionPatch = {
  mode: "add" | "subtract";
  points: Array<[number, number]>;
};

function qualityCriteria(plan: PhotoCraftInstructionPlan | null): string[] {
  switch (plan?.operation) {
    case "text":
      return [
        "文字内容、字号和颜色符合要求",
        "文字位置没有遮挡主体",
        "字体清晰，边缘没有异常",
        "背景和原图没有被误改",
      ];
    case "image-size":
      return [
        "输出宽高符合要求",
        "主体比例符合预期",
        "原尺寸检查没有明显锯齿或模糊",
        "重要细节和文字仍清晰",
      ];
    case "canvas-size":
      return [
        "画布宽高符合要求",
        "主体位置符合预期",
        "新增边缘颜色和内容正确",
        "原图内容完整保留",
      ];
    case "orient":
      return [
        "旋转或翻转方向符合指令",
        "文字、标志的方向符合预期",
        "主体完整且构图符合预期",
        "保存后仍可在 PhotoCraft 中继续编辑",
      ];
    case "layer-action":
      return [
        "操作的是当前选中的图层",
        "图层列表和可见状态符合要求",
        "画面中其他图层保持原样",
        "保存后仍可继续编辑或撤销",
      ];
    case "levels":
      return [
        "黑场、白场和伽马符合要求",
        "暗部没有意外死黑",
        "高光没有意外过曝",
        "颜色和细节自然",
      ];
    case "text-style":
      return [
        "字重和下划线符合要求",
        "文字内容不变",
        "排版没有意外移位",
        "文字图层仍可编辑",
      ];
    case "drop-shadow":
      return [
        "投影清晰可见",
        "距离和柔和程度符合要求",
        "主体和文字保持清晰",
        "背景没有异常阴影",
      ];
    default:
      return [
        "目标区域已完整改变，没有明显漏选",
        "目标之外及背景没有被误改",
        "文字、标签与重要细节保持清晰",
        "边缘、纹理、阴影和色彩过渡自然",
      ];
  }
}

function previewQualityCriteria(
  plan: PhotoCraftInstructionPlan | null,
  generative: boolean,
  mode: "local" | "background",
): string[] {
  if (!generative) return qualityCriteria(plan);
  return mode === "background"
    ? [
        "主体完整，旁边物体和旧阴影没有误入",
        "背景没有残留原物体或重复影像",
        "边缘、毛发和接地投影自然",
        "前景蒙版与背景图层可在 PhotoCraft 继续编辑",
      ]
    : [
        "画框内生成内容符合要求",
        "画框外原图、文字和标志保持不变",
        "边界过渡自然，没有明显拼接",
        "生成图层及蒙版可在 PhotoCraft 继续精修",
      ];
}

function mime(file: File): string {
  if (file.name.toLowerCase().endsWith(".pcraft"))
    return "application/x-photocraft";
  return file.type;
}

export default function PhotoCraftStudio() {
  const frame = useRef<HTMLIFrameElement>(null);
  const currentId = useRef<string | null>(null);
  const title = useRef("未命名 PhotoCraft 项目");
  const original = useRef<File | null>(null);
  const activeSource = useRef<File | null>(null);
  const currentCloudVersion = useRef(0);
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [focusCanvas, setFocusCanvas] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [hue, setHue] = useState(90);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<EditResult | null>(null);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [exportFormat, setExportFormat] = useState("png");
  const [exportProfile, setExportProfile] = useState("preserve");
  const [projects, setProjects] = useState<PhotoCraftLocalProject[]>([]);
  const [cloudProjects, setCloudProjects] = useState<PhotoCraftCloudProject[]>(
    [],
  );
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudSourceReady, setCloudSourceReady] = useState(false);
  const [cloudJob, setCloudJob] = useState<PhotoCraftCloudEditJob | null>(null);
  const [cloudJobBusy, setCloudJobBusy] = useState(false);
  const [cloudCredits, setCloudCredits] = useState<number | null>(null);
  const [cloudReview, setCloudReview] =
    useState<PhotoCraftCloudQualityReview | null>(null);
  const [cloudConflict, setCloudConflict] = useState<{
    project: PhotoCraftCloudProject;
    localVersion: number;
  } | null>(null);
  // P2-2 批量配方确认工作流：单图确认过的计划 → 选目标目录 → 明确一次提交，
  // 之后轮询整批状态（含跳过清单、抽样复检与失败明细）。
  // R1：确认动作在服务端落不可变确认快照（batchConfirmation）；R3：请求键由
  // 确认引用+目标清单+批次序号派生，同一内容重试不换键（防丢响应双计费）。
  const [batchTargets, setBatchTargets] = useState<string[]>([]);
  const [batchAck, setBatchAck] = useState(false);
  const [batchConfirmation, setBatchConfirmation] =
    useState<PhotoCraftBatchConfirmation | null>(null);
  const [batchAttempt, setBatchAttempt] = useState(0);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchSkipped, setBatchSkipped] = useState<
    { projectId: string; reason: string }[] | null
  >(null);
  const [batchStatus, setBatchStatus] =
    useState<PhotoCraftBatchRecipeStatus | null>(null);
  const [instruction, setInstruction] = useState("将帽子的颜色换成黑色");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"local" | "background">(
    "local",
  );
  const [generationShadow, setGenerationShadow] = useState(true);
  const [foregroundStage, setForegroundStage] = useState(false);
  const [backgroundSelection, setBackgroundSelection] = useState<
    "provider" | "existing" | "object" | "outline"
  >("provider");
  const [generationUseSavedSelection, setGenerationUseSavedSelection] =
    useState(false);
  const [generationUseOutline, setGenerationUseOutline] = useState(true);
  const [generationEdgeShift, setGenerationEdgeShift] = useState(0);
  const [generativePreview, setGenerativePreview] = useState(false);
  const [plan, setPlan] = useState<PhotoCraftInstructionPlan | null>(null);
  const [steps, setSteps] = useState<PhotoCraftInstructionPlan[]>([]);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(0);
  // M2 §6-2 解释确认：云解析 round-trip 不蕴含时，先「我理解为…对吗？」再落地。
  const [explainConfirm, setExplainConfirm] = useState<{
    description: string;
    issues: string[];
    steps: PhotoCraftInstructionPlan[];
  } | null>(null);
  // M2 §5 默认策略溯源：哪些数值是表代填的（原话没有依据），预览旁聚焦滑杆。
  const [planDefaults, setPlanDefaults] = useState<DefaultedSlot[]>([]);
  // M2 §5 滑杆交接：常驻 live 会话直改 PhotoCraft 原生调整层。
  const [liveTuning, setLiveTuning] = useState<LiveTuningSession | null>(null);
  const [liveTuningBusy, setLiveTuningBusy] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  // M2 目标审核提议-确认环：蒙版审核升级——候选区域编号描边叠在画布上，
  // 点一下（或说「第二个」）确认/换目标；蒙版画笔仍可手工修。
  const [targetReview, setTargetReview] = useState<{
    confirmed: boolean;
    maskUrl: string;
  } | null>(null);
  const [maskBounds, setMaskBounds] = useState<{
    subject: [number, number, number, number];
    background: [number, number, number, number];
  } | null>(null);
  // M3 grounding L3：目标缺口名词（屋顶/花瓣…）与本地 SAM+CLIP 开放词汇候选。
  // 坐标已换算回原图分辨率；chosen=null 表示提议-确认环打开待确认。
  // mode=protect 时同一环圈的是 protect 清单的保护框（§4 protect 走同一环）。
  const [targetGap, setTargetGap] = useState<{ phrase: string } | null>(null);
  const [protectGap, setProtectGap] = useState<{ phrase: string } | null>(null);
  const [partCandidates, setPartCandidates] = useState<{
    mode: "target" | "protect";
    phrase: string;
    // D 项入口：本环是否按用户画框限定重圈（归一化框，展示与重置用）。
    promptBox: [number, number, number, number] | null;
    // 剔除点（蒙版代数交互）：本次圈选附带的归一化负点（候选 − 误选区域，
    // 服务端转 SAM label 0 背景点）。仅与 promptBox 同现；环关闭时清空。
    excludePoints: Array<[number, number]>;
    // C 项：服务返回图尺寸（mask_png_b64 的像素空间，bounds/outline 同空间，
    // 坐标按 sampleSize/服务尺寸换算——与候选坐标同一次换算）。
    serviceWidth: number;
    serviceHeight: number;
    candidates: Array<{
      index: number;
      score: number;
      clipScore: number;
      bounds: [number, number, number, number];
      outline: Array<[number, number]>;
      // 服务端 mask_png_b64（正常候选必带）；缺失/损坏时确认环退回轮廓套索。
      maskPngB64: string;
      areaRatio: number;
    }>;
    chosen: number | null;
    // M4 τ 校准：top-1 是否曾被 τ_auto 自动选中（后续手动换候选 = override，
    // 是 τ 校准回流里最要紧的负样本）。
    autoTop?: boolean;
  } | null>(null);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const candidateConfirmationPending = useRef(false);
  // D 项入口：等待用户在图上拖画限定框（方位词/多实例消歧）。非空时画布
  // pointerUp 把拖画矩形交给 findPartCandidates 的画框限定重圈，而非普通
  // scope/protect 取样。
  const [awaitTargetBox, setAwaitTargetBox] = useState<{
    phrase: string;
  } | null>(null);
  // 剔除点采集态（蒙版代数交互）：非空（true）时图片点击 = 添加归一化剔除点
  // （≤EXCLUDE_POINT_LIMIT 个），配合「按剔除点重圈」重新请求候选。仅画框
  // 限定后的目标环提供；PhotoCraft 蒙版笔刷仍是逐像素剔除的精细工具。
  const [awaitExcludeClick, setAwaitExcludeClick] = useState(false);
  const [excludePoints, setExcludePoints] = useState<Array<[number, number]>>(
    [],
  );
  // C 项：已上传候选蒙版的 id（POST /v1/selection-mask 返回）。仅目标模式确认
  // 候选时置位；蒙版不可用或切换选区来源时清空，executeInstructionStep 只在
  // selectionMethod==="mask" 且 id 在场时带蒙版头（outline 恒为套索兜底数据）。
  const [candidateMaskId, setCandidateMaskId] = useState<string | null>(null);
  // 补充B 整改：换色缺目标色（语义必需槽）时打开的选色行——点色块以
  // 「原话 + 改成X色」重解析，未选色不出预览、不生成计划。
  const [colorChoice, setColorChoice] = useState(false);
  const [qualityChecks, setQualityChecks] = useState([
    false,
    false,
    false,
    false,
  ]);
  const [qualityGrade, setQualityGrade] =
    useState<PhotoCraftQualityGrade>("manual");
  const [qualityNote, setQualityNote] = useState("");
  const [savedReview, setSavedReview] =
    useState<PhotoCraftQualityReview | null>(null);
  const [reviewHistory, setReviewHistory] = useState<PhotoCraftQualityReview[]>(
    [],
  );
  const [savedGrade, setSavedGrade] =
    useState<PhotoCraftQualityGrade>("manual");
  const [savedNote, setSavedNote] = useState("");
  const [savedChecks, setSavedChecks] = useState([false, false, false, false]);
  const [points, setPoints] = useState<Array<[number, number]>>([]);
  const [selectionMethod, setSelectionMethod] = useState<
    "manual" | "object" | "provider" | "existing" | "mask"
  >("object");
  const [selectionMode, setSelectionMode] = useState<
    | "sample"
    | "heal-point"
    | "text-point"
    | "scope"
    | "outline"
    | "freehand"
    | "protect"
    | "patch-add"
    | "patch-subtract"
  >("scope");
  const [outline, setOutline] = useState<Array<[number, number]>>([]);
  const [freehandDraft, setFreehandDraft] = useState<Array<[number, number]>>(
    [],
  );
  const freehandPoints = useRef<Array<[number, number]>>([]);
  const [patches, setPatches] = useState<SelectionPatch[]>([]);
  const [draftPatch, setDraftPatch] = useState<Array<[number, number]>>([]);
  const [edgeShift, setEdgeShift] = useState(0);
  const [edgeFeather, setEdgeFeather] = useState(0);
  const [providerScopeFeather, setProviderScopeFeather] = useState(80);
  const [healSize, setHealSize] = useState(55);
  const [rectCorner, setRectCorner] = useState<[number, number] | null>(null);
  const [dragRect, setDragRect] = useState<
    [number, number, number, number] | null
  >(null);
  const [scopeRect, setScopeRect] = useState<
    [number, number, number, number] | null
  >(null);
  const [protectRect, setProtectRect] = useState<
    [number, number, number, number] | null
  >(null);
  const pointerStart = useRef<[number, number] | null>(null);
  const [samplePreview, setSamplePreview] = useState("");
  const [sampleSize, setSampleSize] = useState<[number, number]>([1, 1]);
  const [pending, setPending] = useState<EditResult | null>(null);
  const pendingRef = useRef<EditResult | null>(null);
  const [maskTool, setMaskTool] = useState<"off" | "add" | "erase">("off");
  const [maskBrushSize, setMaskBrushSize] = useState(32);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [maskHistory, setMaskHistory] = useState<EditResult[]>([]);
  const [draftStroke, setDraftStroke] = useState<Array<[number, number]>>([]);
  const strokePoints = useRef<Array<[number, number]>>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const canvasNeedsSync = useRef(false);
  const contextRevision = useRef(0);
  // M4 τ 校准回流：当前指令走的是哪条解析道（sequence/express/model/gap），
  // 以及滑杆会话打开时的计划初值——修改幅度 = 定稿值 − 初值。
  const nlLaneRef = useRef(
    "none" as
      | "none"
      | "sequence"
      | "express"
      | "model"
      | "gap-target"
      | "gap-param",
  );
  const liveBaselineRef = useRef<Record<string, number> | null>(null);
  const sourceOpenRequest = useRef(0);
  const [canvasOutOfSync, setCanvasOutOfSync] = useState(false);
  const syncBeforePreview = useRef(false);
  const returnAfterCanvasSave = useRef(false);
  const canvasSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasSaveTimedOut = useRef(false);

  useEffect(
    () => () => {
      if (canvasSaveTimer.current) clearTimeout(canvasSaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  function resetEditContext() {
    contextRevision.current += 1;
    pendingRef.current = null;
    setPending(null);
    setResult(null);
    setMaskHistory([]);
    setCompletedSteps(0);
    setQualityChecks([false, false, false, false]);
    setQualityGrade("manual");
    setQualityNote("");
    setSavedReview(null);
    setReviewHistory([]);
    setSavedGrade("manual");
    setSavedNote("");
    setSavedChecks([false, false, false, false]);
    setCloudSourceReady(false);
    setCloudReview(null);
    setCloudConflict(null);
    setCloudJob(null);
    setBatchTargets([]);
    setBatchAck(false);
    setBatchConfirmation(null);
    setBatchAttempt(0);
    setBatchSkipped(null);
    setBatchStatus(null);
    setForegroundStage(false);
    setGenerativePreview(false);
    setShowOriginal(false);
    setPlan(null);
    setSteps([]);
    setPlanConfirmed(false);
    setSourceInfo(null);
    setSamplePreview("");
    setPoints([]);
    setScopeRect(null);
    setOutline([]);
    setPatches([]);
    setDraftPatch([]);
    setRectCorner(null);
    setProtectRect(null);
    setSelectionMethod("object");
    setCandidateMaskId(null);
    setAwaitTargetBox(null);
    canvasNeedsSync.current = false;
    setCanvasOutOfSync(false);
  }

  const refresh = useCallback(async () => {
    setProjects(await listPhotoCraftProjects());
  }, []);

  const refreshCloud = useCallback(async () => {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) {
      setCloudReady(false);
      setCloudCredits(null);
      return;
    }
    const [projects, credits] = await Promise.all([
      listPhotoCraftCloudProjects(config, session.accessToken),
      getPhotoCraftCloudCredits(config, session.accessToken),
    ]);
    setCloudProjects(projects);
    setCloudCredits(credits.available);
    setCloudReady(true);
  }, []);

  // P2-2：单图确认环通过的计划序列 → 可跨目录复用的批量配方（纯转换，
  // 与单图绑定的操作在此给出可读拒绝原因）。
  const batchRecipeDraft = useMemo(
    () => batchStepsFromConfirmedPlans(steps.length > 0 ? steps : []),
    [steps],
  );

  // R3（codex 第二轮复审）：配方确认或目标清单变化即撤销已勾选的批量确认
  // ——确认勾选必须针对当前展示的内容，内容变了旧确认不得残留。
  useEffect(() => {
    setBatchAck(false);
  }, [batchConfirmation, batchTargets]);

  /**
   * R1（codex 第二轮复审）：把用户确认的计划登记为服务端确认快照（谁、
   * 何时、在哪张图哪个版本上确认了哪些步骤）。只在源项目已保存云端时登记；
   * 登记失败则回退确认勾选——没有服务端确认记录不得发起批量。
   */
  async function ensureBatchConfirmation(
    stepsForRecipe: PhotoCraftBatchStep[],
  ) {
    const config = cloudConfig();
    const session = cloudSession();
    if (
      !config ||
      !session ||
      !cloudSourceReady ||
      !currentId.current ||
      !currentCloudVersion.current
    )
      return;
    const revision = contextRevision.current;
    try {
      const confirmation = await createPhotoCraftBatchConfirmation(
        config,
        session.accessToken,
        {
          source: {
            projectId: currentId.current,
            version: currentCloudVersion.current,
          },
          steps: stepsForRecipe,
        },
      );
      if (revision !== contextRevision.current) return;
      setBatchConfirmation(confirmation);
    } catch (error) {
      if (revision === contextRevision.current) {
        setPlanConfirmed(false);
        setMessage(`配方确认登记失败：${String(error)}`);
      }
    }
  }

  /** 计划确认勾选（R1）：勾上时若有云端来源，同步登记服务端确认快照。 */
  function togglePlanConfirmed(checked: boolean) {
    setPlanConfirmed(checked);
    if (!checked) {
      setBatchConfirmation(null);
      return;
    }
    const draft = batchStepsFromConfirmedPlans(steps);
    if (draft.steps && cloudSourceReady && currentCloudVersion.current > 0)
      void ensureBatchConfirmation(draft.steps);
  }

  /**
   * P2-2 批量确认提交：目标/积分/跳过语义都展示给用户、勾选确认后一次性
   * 入队，随后轮询整批状态直到收敛（成功/失败/超时），失败项如实列出。
   * R3：requestKey 由确认引用+目标清单+批次序号派生——网络失败后重试、
   * 刷新后恢复都用同一键，服务端同键幂等返回原批次，不重复扣费；只有用户
   * 明确「再跑一批」（batchAttempt+1）或内容变化才产生新键。
   */
  async function submitBatchRecipe() {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) {
      setMessage("云端登录会话已失效，请重新登录后再提交批量任务。");
      return;
    }
    if (!batchRecipeDraft.steps) {
      setMessage(batchRecipeDraft.error);
      return;
    }
    if (
      !cloudSourceReady ||
      !currentId.current ||
      !currentCloudVersion.current
    ) {
      setMessage("请先打开已保存到云端的 PhotoCraft 项目，再发起批量套用。");
      return;
    }
    if (
      batchTargets.length === 0 ||
      batchTargets.length > PHOTO_CRAFT_BATCH_PROJECT_LIMIT
    ) {
      setMessage(
        `请选择 1~${PHOTO_CRAFT_BATCH_PROJECT_LIMIT} 个目标项目后再提交。`,
      );
      return;
    }
    if (cloudCredits !== null && cloudCredits < batchTargets.length) {
      setMessage(
        `工作区积分不足：批量按张计费需 ${batchTargets.length}，当前可用 ${cloudCredits}。`,
      );
      return;
    }
    if (!batchConfirmation) {
      setMessage(
        "尚未登记配方确认记录：请先在单图上勾选确认编辑计划，再提交批量。",
      );
      return;
    }
    if (
      batchConfirmation.source.projectId !== currentId.current ||
      batchConfirmation.source.version !== currentCloudVersion.current
    ) {
      // 源项目在确认后产生了新版本：本地确认快照已过期，交回用户重新确认。
      setBatchConfirmation(null);
      setPlanConfirmed(false);
      setMessage("配方确认记录已过期（源项目版本变化），请重新确认后再提交。");
      return;
    }
    if (batchBusy || cloudJobBusy) {
      setMessage("已有云端任务在执行，请等它完成后再提交批量。");
      return;
    }
    const revision = contextRevision.current;
    const requestKey = deriveBatchRequestKey({
      confirmationId: batchConfirmation.id,
      projectIds: batchTargets,
      attempt: batchAttempt,
    });
    setBatchBusy(true);
    setBatchStatus(null);
    setBatchSkipped(null);
    try {
      const enqueue = await enqueuePhotoCraftBatchRecipe(
        config,
        session.accessToken,
        {
          requestKey,
          projectIds: batchTargets,
          confirmationId: batchConfirmation.id,
        },
      );
      if (revision !== contextRevision.current) return;
      setBatchSkipped(enqueue.skipped);
      setCloudCredits((value) =>
        value === null ? null : value - enqueue.jobs.length,
      );
      let status = await getPhotoCraftBatchRecipeStatus(
        config,
        session.accessToken,
        requestKey,
      );
      if (revision !== contextRevision.current) return;
      setBatchStatus(status);
      for (
        let attempt = 0;
        attempt < 240 &&
        (status.statuses.queued ?? 0) + (status.statuses.running ?? 0) > 0;
        attempt++
      ) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
        if (revision !== contextRevision.current) return;
        status = await getPhotoCraftBatchRecipeStatus(
          config,
          session.accessToken,
          requestKey,
        );
        if (revision !== contextRevision.current) return;
        setBatchStatus(status);
      }
      const succeeded = status.statuses.succeeded ?? 0;
      const failed = status.statuses.failed ?? 0;
      const pending = status.total - succeeded - failed;
      if (pending > 0)
        setMessage(
          `批量任务仍在执行：成功 ${succeeded}、失败 ${failed}、未完成 ${pending}；可稍后在本面板刷新查看。`,
        );
      else if (failed > 0)
        setMessage(
          `批量完成：成功 ${succeeded}、失败 ${failed}。失败项目保持原版本，积分已退回；请逐张检查失败原因。`,
        );
      else
        setMessage(
          `批量完成：${succeeded} 张全部成功；抽样复检 ${status.sampledJobIds.length} 张（清单见下方）。`,
        );
      await refreshCloud();
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setBatchBusy(false);
      setBatchAck(false);
    }
  }

  const storeCanvasSave = useCallback(
    async (name: string, bytes: ArrayBuffer) => {
      let native = bytes;
      if (!name.toLowerCase().endsWith(".pcraft")) {
        const response = await fetch(`${bridge}/v1/normalize`, {
          method: "POST",
          headers: { "content-type": "image/vnd.adobe.photoshop" },
          body: bytes,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "PhotoCraft 格式转换失败");
        const source = await fetch(`${bridge}${data.sourceUrl}`);
        if (!source.ok) throw new Error("无法读取转换后的原生文件");
        native = await source.arrayBuffer();
      }
      const saved = await savePhotoCraftProject(
        currentId.current,
        title.current,
        native,
        original.current,
      );
      currentId.current = saved.id;
      title.current = saved.title;
      activeSource.current = new File([native], `${saved.title}.pcraft`, {
        type: "application/x-photocraft",
      });
      setResult(null);
      setPending(null);
      setMaskHistory([]);
      setSavedReview(null);
      setReviewHistory(saved.qualityHistory ?? []);
      setSavedGrade("manual");
      setSavedNote("");
      setSavedChecks([false, false, false, false]);
      setCloudSourceReady(false);
      await refresh();
      try {
        await showPreview(activeSource.current);
        setMessage(
          `已保存项目「${saved.title}」第 ${saved.version} 版，预览已更新${syncBeforePreview.current ? "；请重新指定选区后预览编辑" : ""}`,
        );
      } catch (error) {
        throw new Error(
          `已保存项目「${saved.title}」第 ${saved.version} 版；预览更新失败：${String(error)}`,
        );
      } finally {
        syncBeforePreview.current = false;
      }
    },
    [refresh],
  );

  const openInCanvas = useCallback(
    (name: string, bytes: ArrayBuffer) => {
      if (!ready || !frame.current?.contentWindow)
        throw new Error("PhotoCraft 画布尚未准备好");
      frame.current.contentWindow.postMessage(
        { protocol, type: "open", name, bytes },
        window.location.origin,
        [bytes],
      );
    },
    [ready],
  );

  function requestCanvasSave(returnToWorkbench: boolean) {
    if (!ready || busy) return;
    returnAfterCanvasSave.current = returnToWorkbench;
    canvasSaveTimedOut.current = false;
    setBusy(true);
    setMessage(
      returnToWorkbench
        ? "正在保存 PhotoCraft 精修并同步工作台预览…"
        : "正在保存 PhotoCraft 画布并同步工作台预览…",
    );
    canvasSaveTimer.current = setTimeout(() => {
      returnAfterCanvasSave.current = false;
      canvasSaveTimedOut.current = true;
      canvasSaveTimer.current = null;
      setBusy(false);
      setMessage("等待 PhotoCraft 保存超时；请在画布中检查项目后重试。");
    }, 30_000);
    frame.current?.blur();
    frame.current?.contentWindow?.postMessage(
      { protocol, type: "save" },
      window.location.origin,
    );
  }

  function saveCanvas() {
    requestCanvasSave(false);
  }

  function saveCanvasAndReturn() {
    requestCanvasSave(true);
  }

  async function showPreview(sourceFile: File) {
    const revision = contextRevision.current;
    const inspect = await fetch(`${bridge}/v1/inspect`, {
      method: "POST",
      headers: { "content-type": mime(sourceFile) },
      body: sourceFile,
    });
    const inspection = await inspect.json();
    if (!inspect.ok)
      throw new Error(inspection.error ?? "无法读取图片色彩配置");
    let nextPreview: string;
    if (sourceFile.name.toLowerCase().endsWith(".pcraft")) {
      const response = await fetch(`${bridge}/v1/preview`, {
        method: "POST",
        headers: { "content-type": "application/x-photocraft" },
        body: sourceFile,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "取样预览失败");
      nextPreview = `${bridge}${data.previewUrl}`;
    } else {
      nextPreview = URL.createObjectURL(sourceFile);
    }
    if (
      revision !== contextRevision.current ||
      activeSource.current !== sourceFile
    ) {
      if (nextPreview.startsWith("blob:")) URL.revokeObjectURL(nextPreview);
      throw new Error("图片已切换或画布状态已变化；请重新同步当前项目");
    }
    setSourceInfo(inspection as SourceInfo);
    setSamplePreview(nextPreview);
    if (!inspection.hasSelection) {
      setSelectionMethod((method) =>
        method === "existing" ? "object" : method,
      );
      setBackgroundSelection((method) =>
        method === "existing" ? "object" : method,
      );
    }
    setPoints([]);
    setScopeRect(null);
    setOutline([]);
    setPatches([]);
    setDraftPatch([]);
    setRectCorner(null);
    setProtectRect(null);
    setCandidateMaskId(null);
  }

  async function exportCurrentImage() {
    const source = activeSource.current ?? file;
    if (!source) return;
    if (pending) {
      setMessage("请先应用或取消当前编辑预览，再导出项目");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${bridge}/v1/export?format=${exportFormat}&profile=${exportProfile}`,
        {
          method: "POST",
          headers: { "content-type": mime(source) },
          body: source,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "PhotoCraft 导出失败");
      const link = document.createElement("a");
      link.href = `${bridge}${data.downloadUrl}`;
      link.download = `photocraft-export.${exportFormat}`;
      link.click();
      setMessage(
        `PhotoCraft 已导出 ${exportFormat.toUpperCase()}（${exportProfile === "srgb" ? "转换为 sRGB" : "保留原色彩配置"}）。`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetch(`${bridge}/health`)
      .then(async (response) => {
        const status = response.ok ? await response.json() : null;
        const compatible =
          status?.engine === "PhotoCraft" && status?.version === "0.6.0";
        setAvailable(compatible);
        if (response.ok && !compatible)
          setMessage(
            "PhotoCraft 桥接版本与当前画布不一致，请检查固定版本 0.6.0",
          );
      })
      .catch(() => setAvailable(false));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const config = cloudConfig();
    if (!config) return;
    void finishCloudLogin(config)
      .then(() => refreshCloud())
      .catch((error) => setMessage(String(error)));
  }, [refreshCloud]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.protocol !== protocol
      )
        return;
      const data = event.data as {
        type: string;
        name?: string;
        message?: string;
        accepted?: boolean;
        bytes?: ArrayBuffer;
      };
      if (data.type === "ready") setReady(true);
      if (data.type === "canvas-interaction") {
        contextRevision.current += 1;
        canvasNeedsSync.current = true;
        setCanvasOutOfSync(true);
        if (pendingRef.current) {
          pendingRef.current = null;
          setPending(null);
          setMaskHistory([]);
          setMessage(
            "PhotoCraft 画布在预览后被操作，旧预览已取消。保存画布后重新指定选区。",
          );
        }
      }
      if (data.type === "open-dispatched") {
        if (data.accepted) {
          canvasNeedsSync.current = false;
          setCanvasOutOfSync(false);
        }
        setMessage(
          data.accepted
            ? `已将 ${data.name ?? "项目"} 送入 PhotoCraft 画布`
            : "画布未确认接收文件，请检查画布是否打开",
        );
      }
      if (data.type === "error") {
        if (canvasSaveTimer.current) clearTimeout(canvasSaveTimer.current);
        canvasSaveTimer.current = null;
        returnAfterCanvasSave.current = false;
        syncBeforePreview.current = false;
        setBusy(false);
        setMessage(data.message ?? "PhotoCraft 出错");
      }
      if (data.type === "saved" && data.bytes instanceof ArrayBuffer) {
        const shouldReturn = returnAfterCanvasSave.current;
        returnAfterCanvasSave.current = false;
        setMessage("正在保存 PhotoCraft 原生项目…");
        void storeCanvasSave(data.name ?? "project.pcraft", data.bytes)
          .then(() => {
            canvasNeedsSync.current = false;
            setCanvasOutOfSync(false);
            if (shouldReturn && !canvasSaveTimedOut.current)
              setFocusCanvas(false);
          })
          .catch((error) => setMessage(String(error)))
          .finally(() => {
            syncBeforePreview.current = false;
            if (canvasSaveTimer.current) clearTimeout(canvasSaveTimer.current);
            canvasSaveTimer.current = null;
            setBusy(false);
          });
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [storeCanvasSave]);

  async function openFile() {
    if (!file) return;
    const request = ++sourceOpenRequest.current;
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (request !== sourceOpenRequest.current) return;
      resetEditContext();
      currentId.current = null;
      currentCloudVersion.current = 0;
      original.current = file.name.toLowerCase().endsWith(".pcraft")
        ? null
        : file;
      activeSource.current = file;
      title.current = file.name.replace(/\.[^.]+$/, "");
      openInCanvas(file.name, bytes);
      await showPreview(file);
    } catch (error) {
      if (request === sourceOpenRequest.current) setMessage(String(error));
    } finally {
      if (request === sourceOpenRequest.current) setBusy(false);
    }
  }

  async function openProject(id: string) {
    const request = ++sourceOpenRequest.current;
    setBusy(true);
    try {
      const project = await loadPhotoCraftProject(id);
      if (request !== sourceOpenRequest.current) return;
      if (!project) throw new Error("本地项目不存在");
      resetEditContext();
      currentId.current = project.id;
      setSavedReview(project.qualityReview ?? null);
      setReviewHistory(project.qualityHistory ?? []);
      setSavedGrade(project.qualityReview?.grade ?? "manual");
      setSavedNote(project.qualityReview?.note ?? "");
      setSavedChecks(
        project.qualityReview?.checks ?? [false, false, false, false],
      );
      currentCloudVersion.current = project.cloudVersion ?? 0;
      original.current = project.original
        ? new File([project.original.bytes], project.original.name, {
            type: project.original.type,
          })
        : null;
      activeSource.current = new File(
        [project.bytes],
        `${project.title}.pcraft`,
        {
          type: "application/x-photocraft",
        },
      );
      title.current = project.title;
      openInCanvas(`${project.title}.pcraft`, project.bytes);
      await showPreview(activeSource.current);
    } catch (error) {
      if (request === sourceOpenRequest.current) setMessage(String(error));
    } finally {
      if (request === sourceOpenRequest.current) setBusy(false);
    }
  }

  async function openCloudProject(
    project: PhotoCraftCloudProject,
    preserveDraft = false,
  ) {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) return;
    const request = ++sourceOpenRequest.current;
    setBusy(true);
    try {
      const local = await loadPhotoCraftProject(project.id);
      if (request !== sourceOpenRequest.current) return;
      if (local && hasUnsyncedPhotoCraftDraft(local) && !preserveDraft) {
        setCloudConflict({ project, localVersion: local.version });
        setMessage(
          `本地第 ${local.version} 版尚未同步。选择打开云端版时，会先保留独立本地草稿。`,
        );
        return;
      }
      setCloudConflict(null);
      const bytes = await loadPhotoCraftCloudSource(
        config,
        session.accessToken,
        project.id,
      );
      const reviews = await listPhotoCraftCloudQualityReviews(
        config,
        session.accessToken,
        project.id,
        project.version,
      );
      if (request !== sourceOpenRequest.current) return;
      const cached = await cachePhotoCraftCloudProject({
        id: project.id,
        title: project.title,
        version: project.version,
        bytes: bytes.slice(0),
      });
      if (request !== sourceOpenRequest.current) return;
      resetEditContext();
      setCloudReview(reviews[0] ?? null);
      const cloudHistory: PhotoCraftQualityReview[] = [...reviews]
        .reverse()
        .map((review) => ({
          grade: review.grade,
          note: review.note,
          checks: review.checks,
          criteria: review.criteria,
          reviewedAt: Date.parse(review.createdAt),
          sourceVersion: review.sourceVersion,
        }));
      const latestCloudReview = cloudHistory.at(-1) ?? null;
      currentId.current = project.id;
      setSavedReview(latestCloudReview);
      setReviewHistory(
        cloudHistory.length
          ? cloudHistory
          : (cached.project.qualityHistory ?? []),
      );
      setSavedGrade(latestCloudReview?.grade ?? "manual");
      setSavedNote(latestCloudReview?.note ?? "");
      setSavedChecks(latestCloudReview?.checks ?? [false, false, false, false]);
      currentCloudVersion.current = project.version;
      original.current = null;
      activeSource.current = new File([bytes], `${project.title}.pcraft`, {
        type: "application/x-photocraft",
      });
      title.current = project.title;
      openInCanvas(`${project.title}.pcraft`, bytes);
      await showPreview(activeSource.current);
      setMessage(
        cached.preservedDraft
          ? `已保留「${cached.preservedDraft.title}」第 ${cached.preservedDraft.version} 版；打开云端项目第 ${project.version} 版。`
          : `已打开云端项目「${project.title}」第 ${project.version} 版`,
      );
      setCloudSourceReady(true);
      await refresh();
    } catch (error) {
      if (request === sourceOpenRequest.current) setMessage(String(error));
    } finally {
      if (request === sourceOpenRequest.current) setBusy(false);
    }
  }

  async function saveCloud(): Promise<boolean> {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session || !currentId.current) {
      setMessage(
        "云端登录会话不可用；本地可编辑源已保留，请重新登录后保存到云端。",
      );
      return false;
    }
    try {
      const project = await loadPhotoCraftProject(currentId.current);
      if (!project) throw new Error("请先保存画布项目");
      setMessage("正在保存云端项目…");
      const saved = await savePhotoCraftCloudProject(
        config,
        session.accessToken,
        {
          id: project.id,
          title: project.title,
          expectedVersion: currentCloudVersion.current,
          bytes: project.bytes,
          original:
            original.current ??
            (project.original
              ? new File([project.original.bytes], project.original.name, {
                  type: project.original.type,
                })
              : null),
        },
      );
      currentCloudVersion.current = saved.version;
      // R1：版本前进使旧的服务端确认快照过期——清掉；若计划仍处于已确认
      // 态，立即在新版本上补登记（确认时间以服务端记录为准）。
      setBatchConfirmation(null);
      if (planConfirmed) {
        const draft = batchStepsFromConfirmedPlans(steps);
        if (draft.steps) void ensureBatchConfirmation(draft.steps);
      }
      setCloudReview(null);
      const sourceStillCurrent = await markPhotoCraftCloudVersion(
        saved.id,
        saved.version,
        project.version,
      );
      setCloudSourceReady(sourceStillCurrent);
      let reviewMessage = "";
      if (
        sourceStillCurrent &&
        project.qualityReview?.sourceVersion === project.version
      ) {
        try {
          const review = await appendPhotoCraftCloudQualityReview(
            config,
            session.accessToken,
            saved.id,
            saved.version,
            project.qualityReview,
          );
          setCloudReview(review);
          reviewMessage = "，质量记录已同步";
        } catch (reviewError) {
          reviewMessage = `；质量记录同步失败：${String(reviewError)}`;
        }
      }
      await Promise.all([refresh(), refreshCloud()]);
      setMessage(
        `云端项目已保存第 ${saved.version} 版${reviewMessage}${sourceStillCurrent ? "" : "；本地已有更新草稿，请重新打开或上传"}`,
      );
      return true;
    } catch (error) {
      setMessage(String(error));
      return false;
    }
  }

  async function submitCloudEditJob() {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) {
      setMessage("云端登录会话已失效，请重新登录后提交编辑任务。");
      return;
    }
    if (
      !currentId.current ||
      !cloudSourceReady ||
      !currentCloudVersion.current
    ) {
      setMessage("请先打开已保存的云端 PhotoCraft 项目。");
      return;
    }
    if (
      !plan ||
      !["orient", "layer-action", "levels", "adjust"].includes(
        plan.operation,
      ) ||
      steps.length > 1
    ) {
      setMessage("该编辑计划尚不能作为单步云端任务执行。");
      return;
    }
    if (pending || canvasNeedsSync.current || cloudJobBusy) {
      setMessage("请先保存画布或完成当前预览与任务，再提交云端编辑。");
      return;
    }
    const revision = contextRevision.current;
    const projectId = currentId.current;
    const expectedVersion = currentCloudVersion.current;
    setCloudJobBusy(true);
    try {
      const selectedPlan = plan as Extract<
        PhotoCraftInstructionPlan,
        { operation: "orient" | "layer-action" | "levels" | "adjust" }
      >;
      if (
        selectedPlan.operation === "adjust" &&
        selectedPlan.target !== "whole-image" &&
        selectionMethod === "provider"
      )
        throw new Error(
          "AI 边缘蒙版暂由本机桥接执行；云端任务请选择 PhotoCraft 智能选物体、手动轮廓或已有原生选区。",
        );
      const selection =
        selectedPlan.operation === "adjust" &&
        selectedPlan.target !== "whole-image"
          ? selectionMethod === "existing"
            ? sourceInfo?.hasSelection
              ? { kind: "existing" as const }
              : null
            : selectionMethod === "object"
              ? scopeRect
                ? { kind: "object" as const, rect: scopeRect }
                : null
              : outline.length >= 3
                ? { kind: "lasso" as const, points: outline }
                : scopeRect
                  ? { kind: "rect" as const, rect: scopeRect }
                  : null
          : null;
      if (
        selectedPlan.operation === "adjust" &&
        selectedPlan.target !== "whole-image" &&
        !selection
      )
        throw new Error(
          "局部云端调整需要先在下方图片画范围或轮廓；已有原生选区需保存在 .pcraft 中。",
        );
      if (draftPatch.length)
        throw new Error("请先完成或撤销当前补选/剔除轮廓。");
      if (
        selectedPlan.operation === "adjust" &&
        selectedPlan.protectLabel &&
        !protectRect
      )
        throw new Error("请先画出要保护的标签范围。");
      const operation: PhotoCraftCloudEditJob["operation"] =
        selectedPlan.operation === "orient"
          ? selectedPlan.mode
          : selectedPlan.operation === "layer-action"
            ? (
                {
                  duplicate: "duplicate-layer",
                  hide: "hide-layer",
                  show: "show-layer",
                } as const
              )[selectedPlan.action]
            : selectedPlan.operation === "levels"
              ? "levels"
              : `${selectedPlan.target === "whole-image" ? "" : "masked-"}adjust-${selectedPlan.adjustment}`;
      const params: Record<string, unknown> =
        selectedPlan.operation === "levels"
          ? {
              inBlack: selectedPlan.inBlack,
              inWhite: selectedPlan.inWhite,
              gamma: selectedPlan.gamma,
            }
          : selectedPlan.operation === "adjust"
            ? selection
              ? {
                  amount: selectedPlan.amount,
                  selection,
                  edgeShift,
                  edgeFeather,
                  patches,
                  ...(protectRect ? { protectRect } : {}),
                }
              : { amount: selectedPlan.amount }
            : {};
      let job = await submitPhotoCraftCloudEditJob(
        config,
        session.accessToken,
        {
          projectId,
          expectedVersion,
          operation,
          params,
          requestKey: `browser-${crypto.randomUUID()}`,
        },
      );
      if (revision !== contextRevision.current) return;
      setCloudJob(job);
      for (
        let attempt = 0;
        attempt < 120 && job.status !== "succeeded" && job.status !== "failed";
        attempt++
      ) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        if (revision !== contextRevision.current) return;
        job = await getPhotoCraftCloudEditJob(
          config,
          session.accessToken,
          projectId,
          job.id,
        );
        setCloudJob(job);
      }
      if (revision !== contextRevision.current) return;
      if (job.status === "failed") {
        setMessage(
          `云端 PhotoCraft 任务失败（${job.errorCode ?? "UNKNOWN"}）；原项目版本未被替换。`,
        );
        return;
      }
      if (job.status !== "succeeded") {
        setMessage(
          `云端任务仍在排队或执行中，任务 ID：${job.id}。稍后刷新云端项目。`,
        );
        return;
      }
      const updated = await listPhotoCraftCloudProjects(
        config,
        session.accessToken,
      );
      setCloudProjects(updated);
      const project = updated.find(
        (item) => item.id === projectId && item.version === job.outputVersion,
      );
      if (!project)
        throw new Error("任务已完成，但云端项目列表未返回新版本；请刷新项目");
      await openCloudProject(project, true);
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setCloudJobBusy(false);
    }
  }

  async function submitCloudGenerationJob() {
    const config = cloudConfig();
    const session = cloudSession();
    if (
      !config ||
      !session ||
      !cloudSourceReady ||
      !currentId.current ||
      !currentCloudVersion.current
    ) {
      setMessage("请先登录并打开已保存的云端 PhotoCraft 项目。");
      return;
    }
    if (
      generationMode !== "local" ||
      generationPrompt.trim().length < 3 ||
      generationPrompt.length > 400
    ) {
      setMessage("当前云端任务支持 3～400 字的局部生成要求。");
      return;
    }
    if (pending || canvasNeedsSync.current || busy || cloudJobBusy) {
      setMessage("请先完成当前预览并保存画布，再提交云端生成。");
      return;
    }
    const selection =
      generationUseSavedSelection && sourceInfo?.hasSelection
        ? { kind: "existing" as const }
        : generationUseOutline && outline.length >= 3
          ? { kind: "lasso" as const, points: outline }
          : scopeRect
            ? { kind: "object" as const, rect: scopeRect }
            : null;
    if (!selection) {
      setMessage("请先在图片上框住目标，或沿目标画出轮廓。");
      return;
    }
    if (cloudCredits === null || cloudCredits < 1) {
      setMessage("工作区生成积分不足；云端任务不会调用图片模型。");
      return;
    }
    const revision = contextRevision.current;
    const projectId = currentId.current;
    setCloudJobBusy(true);
    try {
      let job = await submitPhotoCraftCloudEditJob(
        config,
        session.accessToken,
        {
          projectId,
          expectedVersion: currentCloudVersion.current,
          operation: "generate-local",
          params: {
            prompt: generationPrompt.trim(),
            selection,
            edgeShift: generationEdgeShift,
            edgeFeather: 3,
          },
          requestKey: `browser-${crypto.randomUUID()}`,
        },
      );
      setCloudJob(job);
      setCloudCredits((value) => (value === null ? null : value - 1));
      for (
        let attempt = 0;
        attempt < 240 && job.status !== "succeeded" && job.status !== "failed";
        attempt++
      ) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        if (revision !== contextRevision.current) return;
        job = await getPhotoCraftCloudEditJob(
          config,
          session.accessToken,
          projectId,
          job.id,
        );
        setCloudJob(job);
      }
      if (revision !== contextRevision.current) return;
      if (job.status === "failed") {
        const reason =
          job.errorCode === "QUALITY_REJECTED"
            ? "检测到明显拼接或范围外改动，结果未保存，积分已退回"
            : `失败（${job.errorCode ?? "UNKNOWN"}），最终失败后积分退回`;
        setMessage(`云端生成${reason}。`);
        setCloudCredits(
          (await getPhotoCraftCloudCredits(config, session.accessToken))
            .available,
        );
        return;
      }
      if (job.status !== "succeeded") {
        setMessage(
          `云端生成仍在执行，任务 ID：${job.id}；稍后可重新打开云端项目。`,
        );
        return;
      }
      const updated = await listPhotoCraftCloudProjects(
        config,
        session.accessToken,
      );
      setCloudProjects(updated);
      const project = updated.find(
        (item) => item.id === projectId && item.version === job.outputVersion,
      );
      if (!project) throw new Error("生成完成，但新版本暂未出现在项目列表");
      await openCloudProject(project, true);
      setMessage(
        `云端生成已写入第 ${job.outputVersion} 版可编辑源；请按原尺寸评估，未通过时标为需人工精修。`,
      );
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setCloudJobBusy(false);
      if (config && session)
        getPhotoCraftCloudCredits(config, session.accessToken)
          .then((balance) => setCloudCredits(balance.available))
          .catch(() => undefined);
    }
  }

  async function interpretInstruction(forcedText?: string) {
    // forcedText（补充B 选色重解析等程序化重试）直接作为本次要解析的原话，
    // 不依赖异步的 setInstruction 重渲染——闭包里的 instruction 还是旧值。
    const text = forcedText ?? instruction;
    if (canvasNeedsSync.current) {
      setMessage("画布有未同步的操作。请先保存画布，再解析编辑要求。");
      return;
    }
    if (!activeSource.current && !file) {
      setMessage("请先导入图片或打开项目");
      return;
    }
    // 提议-确认环打开时，「第二个」式口语直接映射到编号候选（§4）。
    const review = targetReview;
    if (review && !review.confirmed) {
      const ordinalCandidate = candidateFromOrdinal(instruction);
      if (ordinalCandidate) {
        selectTargetCandidate(ordinalCandidate);
        return;
      }
    }
    const parts = partCandidates;
    if (parts && parts.chosen === null) {
      const ordinal = ordinalIndex(instruction);
      if (ordinal !== null && parts.candidates[ordinal]) {
        // D-5 整改：蒙版还在准备时「第几个」不再被静默吞掉——明说等一下。
        if (candidateConfirmationPending.current) {
          setMessage(
            "正在准备上一个候选的像素蒙版选区，请稍候几秒再确认编号。",
          );
          return;
        }
        void choosePartCandidate(ordinal, false, parts);
        return;
      }
    }
    const revision = contextRevision.current;
    try {
      setBusy(true);
      setPending(null);
      setMaskHistory([]);
      setTargetReview(null);
      setMaskBounds(null);
      void closeLiveTuning(true);
      setExplainConfirm(null);
      setPlanDefaults([]);
      setTargetGap(null);
      setProtectGap(null);
      setPartCandidates(null);
      setAwaitTargetBox(null);
      setColorChoice(false);
      setAwaitExcludeClick(false);
      setExcludePoints([]);
      const directSequence = planPhotoCraftSequence(text);
      const direct = directSequence?.[0] ?? planPhotoCraftInstruction(text);
      let nextSteps = directSequence ?? (direct ? [direct] : []);
      let explain: { description: string; issues: string[] } | null = null;
      let defaults: DefaultedSlot[] = [];
      if (!nextSteps.length) {
        const response = await fetch("/api/photocraft-instruction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction: text }),
        });
        const data = await response.json();
        if (!response.ok) {
          // M3 L3a：目标缺口不报死了事——留下名词，交给开放词汇候选环。
          const gaps: Array<{
            kind?: string;
            slot?: string;
            phrase?: unknown;
          }> = Array.isArray(data.gaps) ? data.gaps : [];
          const gap = gaps.find(
            (item) =>
              item.kind === "target" &&
              typeof item.phrase === "string" &&
              item.phrase.trim().length > 0,
          );
          if (response.status === 422 && gap) {
            if (revision !== contextRevision.current) return;
            const phrase = String(gap.phrase).trim();
            // M4 分桶：目标名词走开放词汇候选环（本地快轨解析不出目标）。
            nlLaneRef.current = "gap-target";
            trackPhotoCraftTelemetry("interpret", {
              lane: "gap-target",
              outcome: "gap",
              instruction: text,
              phrase,
            });
            setPlan(null);
            setSteps([]);
            setPlanConfirmed(false);
            setTargetGap({ phrase });
            setMessage(
              `${String(data.error ?? "目标未能自动识别")}。可点「智能找目标」让本机视觉模型圈出「${phrase}」候选，或继续手动画框/套索。`,
            );
            return;
          }
          // P1-2 整改：目标缺口提不出名词（句式不在句框/主谓式内）时不能只报
          // 422 死路——给出明确的改写建议与手画路径，能力边界不变。
          if (
            response.status === 422 &&
            gaps.some((item) => item.kind === "target")
          ) {
            if (revision !== contextRevision.current) return;
            nlLaneRef.current = "gap-target";
            trackPhotoCraftTelemetry("interpret", {
              lane: "gap-target",
              outcome: "gap-no-phrase",
              instruction: text,
            });
            setPlan(null);
            setSteps([]);
            setPlanConfirmed(false);
            setMessage(
              `${String(data.error ?? "目标未能自动识别")}。可改成「把屋顶提亮一点」式的说法让目标名词可提取（点「智能找目标」圈选），或直接用蒙版工具画框/套索指定范围。`,
            );
            return;
          }
          // 补充B 整改：换色缺目标色是语义必需槽——不再默认灰色预览，界面
          // 点选目标色后以补全原话重解析。
          if (
            response.status === 422 &&
            gaps.some((item) => item.kind === "param" && item.slot === "color")
          ) {
            if (revision !== contextRevision.current) return;
            nlLaneRef.current = "gap-param";
            trackPhotoCraftTelemetry("interpret", {
              lane: "gap-param",
              outcome: "gap",
              instruction: text,
            });
            setPlan(null);
            setSteps([]);
            setPlanConfirmed(false);
            setColorChoice(true);
            setMessage(
              `${String(data.error ?? "未说明目标颜色")}；请点选目标色后再预览。`,
            );
            return;
          }
          trackPhotoCraftTelemetry("interpret", {
            lane: "model",
            outcome: "reject",
            instruction: text,
          });
          throw new Error(data.error ?? "无法理解编辑要求");
        }
        nextSteps = Array.isArray(data.steps)
          ? data.steps.map((step: unknown) =>
              parsePhotoCraftModelPlan({
                ...(step as object),
                unsupported: "",
              }),
            )
          : [parsePhotoCraftModelPlan({ ...data.plan, unsupported: "" })];
        if (
          data.explainConfirm &&
          typeof data.explainConfirm.description === "string"
        )
          explain = {
            description: data.explainConfirm.description,
            issues: Array.isArray(data.explainConfirm.issues)
              ? data.explainConfirm.issues
                  .filter(
                    (issue: unknown): issue is string =>
                      typeof issue === "string",
                  )
                  .slice(0, 6)
              : [],
          };
        if (Array.isArray(data.defaults)) defaults = data.defaults;
      }
      const nextPlan = nextSteps[0];
      if (revision !== contextRevision.current) return;
      if (!nextPlan) throw new Error("编辑计划为空");
      // M4 双轨遥测：本地快轨（sequence/express）与模型轨分桶记录路由结果。
      const lane = directSequence ? "sequence" : direct ? "express" : "model";
      nlLaneRef.current = lane;
      trackPhotoCraftTelemetry("interpret", {
        lane,
        outcome: explain ? "explain-confirm" : "plan",
        steps: nextSteps.length,
        instruction: text,
      });
      if (explain) {
        // round-trip 蕴含核对未通过（§6-2）：不直接落地，先解释确认。
        setPlanDefaults(defaults);
        setExplainConfirm({ ...explain, steps: nextSteps });
        trackPhotoCraftTelemetry("ring-open", {
          ring: "explain",
          lane: "model",
        });
        setMessage("模型对这句话的理解需要确认：请核对下方的解释。");
        return;
      }
      applyParsedSteps(nextSteps, text);
      if (defaults.length > 0) {
        setPlanDefaults(defaults);
        setMessage(
          `${describePhotoCraftPlan(nextPlan)}（${defaults
            .map((slot) => `${slot.slot} 按默认 ${slot.value} 代填`)
            .join("、")}；预览后可微调）`,
        );
      }
    } catch (error) {
      if (revision === contextRevision.current) {
        setPlan(null);
        setSteps([]);
        setPlanConfirmed(false);
        setMessage(String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  /** 解析结果落地为待预览计划：登记步骤并按目标重置选区工具。 */
  function applyParsedSteps(
    nextSteps: PhotoCraftInstructionPlan[],
    sourceText: string = instruction,
  ) {
    const nextPlan = nextSteps[0];
    if (!nextPlan) throw new Error("编辑计划为空");
    setSteps(nextSteps);
    // R1（codex 第二轮复审）：单步计划同样需要用户明确确认——单纯解析成功
    // 不能自动变成「用户已确认」。新计划落地同时作废旧的服务端确认快照。
    setPlanConfirmed(false);
    setBatchConfirmation(null);
    setPlan(nextPlan);
    if (
      sourceInfo?.hasSelection &&
      nextPlan.target === "selected-area" &&
      (nextPlan.operation === "recolor" || nextPlan.operation === "adjust")
    )
      setSelectionMethod("existing");
    // D 项入口（codex §D 整改）：「左耳」这类固定 selected-area 词不再默默
    // 切到 provider 主体蒙版——那等于把整只猫当耳朵改。没有原生选区、画框、
    // 轮廓、点位任何手绘范围时，落 targetGap 入口：智能找目标出候选环，或
    // 点击/画框限定位置，位置由用户定，不替用户猜。
    let targetGapPhrase: string | null = null;
    if (
      nextPlan.target === "selected-area" &&
      shouldOfferSelectionEntry(
        nextPlan,
        {
          hasNativeSelection: sourceInfo?.hasSelection === true,
          outlineLength: outline.length,
          hasScopeRect: scopeRect !== null,
          pointsLength: points.length,
        },
        extractTargetPhrase(sourceText.replace(/\s+/g, "")),
      )
    ) {
      const phrase = extractTargetPhrase(sourceText.replace(/\s+/g, ""));
      if (phrase) {
        targetGapPhrase = phrase;
        setTargetGap({ phrase });
      }
    }
    if (nextPlan.target === "whole-image") {
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
    }
    if (nextPlan.target === "subject" || nextPlan.target === "background") {
      // The provider mask fully defines these targets, so no drawn scope is
      // required; clear stale scope so the first preview is the mask alone.
      setSelectionMethod("provider");
      setSelectionMode("scope");
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
    }
    if (nextPlan.operation === "crop") setSelectionMode("scope");
    if (nextPlan.operation === "heal") {
      setSelectionMode("heal-point");
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
      setEdgeShift(0);
      setEdgeFeather(0);
    }
    if (nextPlan.operation === "text") {
      setSelectionMode("text-point");
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setScopeRect(null);
      setProtectRect(null);
    }
    // M3 protect 清单：计划带保护名词时打开同一提议-确认环圈保护框。
    // 状态栏消息取舍集中在 parseStatusMessage——目标缺口提示不能被兜底
    // 计划描述覆盖（E-1 c3 实测回归）。
    const protectPhrase = protectPhraseOf(nextPlan);
    if (protectPhrase) setProtectGap({ phrase: protectPhrase });
    setMessage(
      parseStatusMessage({
        planDescription: describePhotoCraftPlan(nextPlan),
        targetGapPhrase,
        protectPhrase: protectPhrase ?? null,
      }),
    );
  }

  /** §6-2 解释确认：用户点头后才把云端计划落地为待预览计划。 */
  function confirmExplain() {
    if (!explainConfirm) return;
    const confirmed = explainConfirm.steps;
    setExplainConfirm(null);
    trackPhotoCraftTelemetry("ring-outcome", {
      ring: "explain",
      lane: "model",
      outcome: "confirm",
    });
    applyParsedSteps(confirmed);
    setMessage("已按确认的理解生成计划；预览后可继续微调。");
  }

  /** §6-2 解释确认：纠正 = 丢弃该计划，引导用户换一种说法。 */
  function correctExplain() {
    contextRevision.current += 1;
    trackPhotoCraftTelemetry("ring-outcome", {
      ring: "explain",
      lane: "model",
      outcome: "reject",
    });
    setExplainConfirm(null);
    setPlan(null);
    setSteps([]);
    setPlanConfirmed(false);
    setPlanDefaults([]);
    setMessage(
      "已丢弃该理解。请换一种说法描述要求（例如「把主体换成红色」），或直接写明数值。",
    );
  }

  /**
   * M2 目标审核提议-确认环：主体/背景预览后打开。取作业里已有的 rembg
   * 蒙版（无二次推理），在浏览器里算主体包围盒，把 ①主体 ②背景 编号描边
   * 叠到预览上；用户点选确认，识别不准时仍可蒙版画笔修边或手动画框。
   */
  async function openTargetReview(jobId: string) {
    setTargetReview(null);
    setMaskBounds(null);
    try {
      const maskUrl = `/v1/jobs/${jobId}/provider-mask`;
      const response = await fetch(`${bridge}${maskUrl}`);
      if (!response.ok) return; // 该作业没有 provider 蒙版（如整图操作）
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      // rembg 蒙版：主体白（红通道 ≥128）、背景黑。全量扫一遍取主体包围盒；
      // 背景候选的描边就是整幅画框。
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          if ((data[(row + x) * 4] ?? 0) >= 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return;
      setMaskBounds({
        subject: [minX, minY, maxX - minX + 1, maxY - minY + 1],
        background: [0, 0, width, height],
      });
      setTargetReview({ confirmed: false, maskUrl });
      trackPhotoCraftTelemetry("ring-open", {
        ring: "target-review",
        lane: nlLaneRef.current,
      });
    } catch {
      // 蒙版不可读时提议-确认环退化为纯文字提示，不阻塞编辑本身。
    }
  }

  /** 点选候选：①主体 ②背景 ③手动画框。当前目标 → 确认；其它 → 换目标重预览。 */
  function selectTargetCandidate(
    candidate: "subject" | "background" | "manual",
  ) {
    if (!plan) return;
    trackPhotoCraftTelemetry("ring-outcome", {
      ring: "target-review",
      lane: nlLaneRef.current,
      outcome:
        candidate === "manual"
          ? "manual"
          : plan.target === candidate
            ? "confirm"
            : "retarget",
    });
    if (candidate === "manual") {
      setTargetReview(null);
      setMaskBounds(null);
      setPending(null);
      setSelectionMethod("object");
      setSelectionMode("scope");
      setMessage(
        "已切换为手动画框：在图片上拖框包住目标，然后点「预览编辑」。",
      );
      return;
    }
    if (plan.target === candidate) {
      setTargetReview((review) =>
        review ? { ...review, confirmed: true } : review,
      );
      setMessage(
        `已确认目标：${candidate === "subject" ? "① 主体" : "② 背景"}。可继续微调或应用。`,
      );
      return;
    }
    const nextPlan = {
      ...plan,
      target: candidate,
    } as PhotoCraftInstructionPlan;
    const nextSteps = steps.map((step, index) =>
      index === steps.length - 1 ? nextPlan : step,
    );
    setPlan(nextPlan);
    setSteps(nextSteps);
    setTargetReview(null);
    setMaskBounds(null);
    setPending(null);
    setCompletedSteps(0);
    setMessage(
      `目标已切换为${candidate === "subject" ? "① 主体" : "② 背景"}；点「预览编辑」查看新目标效果。`,
    );
  }

  /** 「第X个」式口语 → 编号（0/1/2）；两个提议环共用。 */
  function ordinalIndex(text: string): number | null {
    const match = text
      .replace(/\s+/g, "")
      .match(/^(?:就|选|要|用)?第([一二两2三3])个/u);
    if (!match) return null;
    if (match[1] === "一") return 0;
    if (match[1] === "二" || match[1] === "两" || match[1] === "2") return 1;
    return 2;
  }

  /** 「第二个」式口语确认：提议环打开时直接映射到编号候选。 */
  function candidateFromOrdinal(
    text: string,
  ): "subject" | "background" | "manual" | null {
    const ordinal = ordinalIndex(text);
    if (ordinal === null) return null;
    if (ordinal === 0) return "subject";
    if (ordinal === 1) return "background";
    return "manual";
  }

  /** M3 grounding L3：当前图片 + 名词 → 桥接 → 本机 SAM+CLIP 候选服务。 */
  /** 补充B：目标色点选——原话补「改成X色」后重走完整解析链（快车道优先）。 */
  function chooseRecolorColor(color: string) {
    const base = instruction.replace(/[，。,、!！?？\s]+$/u, "");
    const next = `${base}，改成${color}色`;
    setColorChoice(false);
    setInstruction(next);
    void interpretInstruction(next);
  }

  async function findPartCandidates(
    mode: "target" | "protect",
    promptBox?: [number, number, number, number] | null,
    refineExcludePoints?: Array<[number, number]> | null,
  ) {
    const gap = mode === "target" ? targetGap : protectGap;
    if (!gap) return;
    // 画框限定只对目标环有意义（方位/多实例消歧）；protect 环无视。
    const box = mode === "target" ? (promptBox ?? null) : null;
    // 剔除点仅与画框同现（服务 422 约束在前，客户端同样不构造矛盾请求）。
    const exclude =
      mode === "target" && box && refineExcludePoints?.length
        ? refineExcludePoints.slice(0, EXCLUDE_POINT_LIMIT)
        : null;
    const source = activeSource.current ?? file;
    if (!source) {
      setMessage("请先导入图片或打开项目");
      return;
    }
    const revision = contextRevision.current;
    try {
      setCandidateBusy(true);
      // 请求已发出（无论是否带画框），画框等待态随之结束。
      setAwaitTargetBox(null);
      // 原生格式（.pcraft/.psd）先经桥接栅格化为全尺寸 PNG 再送候选服务；
      // 栅格化图与 samplePreview 同尺寸，候选坐标换算仍然一致。
      let upload: Blob = source;
      let uploadMime = mime(source);
      if (/\.(pcraft|psd)$/i.test(source.name)) {
        if (!samplePreview) throw new Error("项目尚未栅格化，无法圈选候选");
        const raster = await fetch(samplePreview);
        if (!raster.ok) throw new Error("无法把项目栅格化用于候选识别");
        upload = await raster.blob();
        uploadMime = "image/png";
      }
      const response = await fetch(`${bridge}/v1/candidates`, {
        method: "POST",
        headers: {
          "content-type": uploadMime,
          "x-acs-phrase-b64": btoa(
            String.fromCharCode(...new TextEncoder().encode(gap.phrase)),
          ),
          // D 项入口：画框限定走归一化坐标头（EXIF 两侧已归一），桥透传、
          // 服务切 box 提示模式——同模型同契约，不引入新模型。
          ...(box ? { "x-acs-prompt-box": JSON.stringify(box) } : {}),
          // 剔除点：框内候选误选的区域（花蕊/猫脸…）→ SAM 负点重圈，
          // 蒙版代数「候选 − 误选」的服务端形态。
          ...(exclude
            ? { "x-acs-exclude-points": JSON.stringify(exclude) }
            : {}),
        },
        body: upload,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "开放词汇候选服务不可用");
      if (revision !== contextRevision.current) return;
      const width = typeof data.width === "number" ? data.width : 0;
      const height = typeof data.height === "number" ? data.height : 0;
      if (!width || !height) throw new Error("候选服务返回的尺寸无效");
      // 服务按 ≤1024 分析，候选坐标换算回原图分辨率再叠加/套索。
      const scaleX = sampleSize[0] / width;
      const scaleY = sampleSize[1] / height;
      const raw = Array.isArray(data.candidates) ? data.candidates : [];
      const candidates = raw
        .map((item: Record<string, unknown>) => {
          const bounds = item.bounds;
          const outline = item.outline;
          if (
            !Array.isArray(bounds) ||
            bounds.length !== 4 ||
            !Array.isArray(outline)
          )
            return null;
          const scaledOutline = outline
            .map((point) =>
              Array.isArray(point) &&
              typeof point[0] === "number" &&
              typeof point[1] === "number"
                ? ([
                    Math.round(point[0] * scaleX),
                    Math.round(point[1] * scaleY),
                  ] as [number, number])
                : null,
            )
            .filter((point): point is [number, number] => point !== null);
          if (scaledOutline.length < 3) return null;
          return {
            index: typeof item.index === "number" ? item.index : 0,
            score: typeof item.score === "number" ? item.score : 0,
            clipScore:
              typeof item.clip_score === "number" ? item.clip_score : 0,
            bounds: [
              Math.round((bounds[0] ?? 0) * scaleX),
              Math.round((bounds[1] ?? 0) * scaleY),
              Math.round((bounds[2] ?? 0) * scaleX),
              Math.round((bounds[3] ?? 0) * scaleY),
            ] as [number, number, number, number],
            outline: scaledOutline,
            // C 项：真实像素蒙版随候选透传（不解码，确认时才按需解码缩放）；
            // 缺失时留空串，确认环自然退回轮廓套索。
            maskPngB64:
              typeof item.mask_png_b64 === "string" ? item.mask_png_b64 : "",
            areaRatio:
              typeof item.area_ratio === "number" ? item.area_ratio : 0,
          };
        })
        .filter(
          (
            item: {
              index: number;
              score: number;
              clipScore: number;
              bounds: [number, number, number, number];
              outline: Array<[number, number]>;
              areaRatio: number;
            } | null,
          ): item is NonNullable<typeof item> => item !== null,
        )
        .slice(0, 3);
      if (!candidates.length) {
        setMessage(
          mode === "target"
            ? box
              ? `在所画框内没有圈出明显的「${gap.phrase}」区域；可画一个稍大的框重试，或直接手动画框/套索指定范围。`
              : `本机视觉模型没有圈出明显的「${gap.phrase}」区域；可点「点击/画框限定」后在目标处画框重圈，或手动画框/套索指定范围。`
            : `本机视觉模型没有圈出明显的「${gap.phrase}」保护区域；请用蒙版笔刷的手画保护框模式圈出。`,
        );
        return;
      }
      const nextCandidates = {
        mode,
        phrase: gap.phrase,
        promptBox: box,
        excludePoints: exclude ?? [],
        serviceWidth: width,
        serviceHeight: height,
        candidates,
        chosen: null,
      };
      setPartCandidates(nextCandidates);
      trackPhotoCraftTelemetry("ring-open", {
        ring: "open-vocab",
        lane: nlLaneRef.current,
        mode,
        count: candidates.length,
        topScore: Number(candidates[0].score.toFixed(4)),
      });
      const top = candidates[0];
      if (CANDIDATE_RING.shouldAutoSelectCandidate(mode, candidates)) {
        // τ_auto：top-1 高分 + 计划单步可撤销（预览即提议）→ 直接选中。
        // protect 不自动：保护框选错的代价是静默漏保护，始终走确认环。
        // 候选数据直传（P1-1）：此刻 state 尚未重渲染，闭包里还是旧值。
        // await：choosePartCandidate 现在含蒙版上传（C 项），让 finally 的
        // candidateBusy 在蒙版备完后才清，避免按钮提前解禁。
        await choosePartCandidate(0, true, nextCandidates);
      } else {
        // D 项入口：方位词/多实例词典信号 + 候选分布信号（前两名不重叠=图里
        // 疑似多处同名目标）都指向同一动作——点编号选目标，或画框限定重圈。
        const classify =
          mode === "target" ? classifyTargetPhrase(gap.phrase) : null;
        const spread =
          mode === "target" &&
          !box &&
          topCandidatesSpread(
            candidates.map(
              (item: { bounds: [number, number, number, number] }) => ({
                bounds: item.bounds,
              }),
            ),
          );
        let disambiguationHint = "";
        if (classify?.directional || classify?.multiInstance) {
          const signal = classify?.multiInstance
            ? "数量词（图里可能有多处）"
            : "方位词（可能有多处同名目标）";
          disambiguationHint = `「${gap.phrase}」带${signal}，请点准目标编号，或点「点击/画框限定」后重圈；`;
        } else if (spread) {
          disambiguationHint = `前两个候选位置不同（图里可能有多处「${gap.phrase}」），点准目标编号或画框限定；`;
        }
        setMessage(
          `${box ? "已按你画的框限定范围重新圈选。" : ""}${
            exclude
              ? `已避开你点选的 ${exclude.length} 处剔除区域重新圈选（候选不再覆盖这些位置；框仍是硬边界）。`
              : ""
          }${
            mode === "target" ? "目标" : "保护范围"
          }「${gap.phrase}」找到 ${candidates.length} 个候选，已编号叠在图片上（${candidates.length === 1 ? "只有一个候选，分数不能判断选区是否准确" : `最高匹配分数 ${Math.round(top.score * 100)}%，分数只是本批候选的相对排名，非正确率`}）。${disambiguationHint}点编号框、下方按钮，或直接说「第几个」确认。`,
        );
      }
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setCandidateBusy(false);
    }
  }

  /**
   * 目标落地共用路径：原句名词替换成「选区」后重走本地解析道，拿回同一
   * 操作与参数（目标变为已选区域）。选区来源由 caller 决定（SAM 轮廓 /
   * 已保存原生选区）。返回是否成功。
   */
  function landRewrittenSelectionPlan(
    phrase: string,
    prepare: () => void,
  ): boolean {
    const rewritten = instruction.split(phrase).join("选区");
    const sequence = planPhotoCraftSequence(rewritten);
    const nextPlan =
      sequence?.[0] ?? planPhotoCraftInstruction(rewritten) ?? null;
    if (!nextPlan || nextPlan.target !== "selected-area") return false;
    prepare();
    setSteps(sequence ?? [nextPlan]);
    setPlan(nextPlan);
    // R1：与 applyParsedSteps 同款——落地新计划一律回到未确认态。
    setPlanConfirmed(false);
    setBatchConfirmation(null);
    const protectPhrase = protectPhraseOf(nextPlan);
    if (protectPhrase) setProtectGap({ phrase: protectPhrase });
    return true;
  }

  /** M3 grounding 级联 L1：图片里已保存的原生选区直接作目标（零模型）。 */
  function useExistingSelectionForGap() {
    const gap = targetGap;
    if (!gap) return;
    const landed = landRewrittenSelectionPlan(gap.phrase, () => {
      setTargetGap(null);
      setPartCandidates(null);
      setAwaitExcludeClick(false);
      setExcludePoints([]);
      setSelectionMethod("existing");
      setSelectionMode("scope");
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
      setCandidateMaskId(null);
    });
    setMessage(
      landed
        ? `已改用图片中保存的原生选区作「${gap.phrase}」目标；点「预览编辑」查看效果。`
        : "这条要求的操作仍解析不出来；请改成「把选区提亮一点」式的说法再解析。",
    );
  }

  /**
   * 候选确认：目标模式把 SAM 轮廓作为套索选区落地（原句名词替换成「选区」
   * 后重走本地解析道拿回同一操作与参数）；protect 模式把候选框设为保护框。
   * P1-1 整改：候选数据经 parts 参数传入——自动选中发生在 setPartCandidates
   * 的同一异步函数里，读渲染闭包里的旧 state（首拍为 null）永远选不上；人工
   * 点击路径不传 parts，沿用当前 state。
   */
  /**
   * C 项：把候选真实像素蒙版备成原生选区数据——解码 mask_png_b64（服务
   * 空间，须与响应宽高一致）→ sampleSize 画布平滑重采样（=文档尺寸）→
   * 红通道 ≥MASK_THRESHOLD 二值化并确认非空 → 上传 /v1/selection-mask 拿
   * id（后续 instruction 以 x-acs-selection-mask-id 引用）。任何一步失败
   * 返回 null（永不 reject）：确认环退回已存的轮廓套索，坏蒙版不阻塞预览。
   */
  async function prepareCandidateMask(
    chosen: { maskPngB64: string },
    parts: NonNullable<typeof partCandidates>,
  ): Promise<string | null> {
    try {
      if (parts.mode !== "target") return null;
      const decoded = decodeMaskPng(chosen.maskPngB64);
      if (
        !decoded ||
        decoded.width !== parts.serviceWidth ||
        decoded.height !== parts.serviceHeight
      )
        return null;
      const bitmap = await createImageBitmap(
        new Blob([decoded.bytes], { type: "image/png" }),
      );
      // 坐标契约浏览器侧：画布即文档尺寸（与 bounds/outline 同一次换算的
      // sampleSize），平滑插值重采样后按红通道阈值二值化（0/255 蒙版线性
      // 插值在 128 处边界稳定）。桥端会对文档尺寸再强校验，失配 400 退套索。
      const canvas = document.createElement("canvas");
      canvas.width = sampleSize[0];
      canvas.height = sampleSize[1];
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const selected = binarizeMaskPixels(pixels.data);
      if (selected === 0) return null; // 空蒙版：桥端探针也会拒，提前退回
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) return null;
      const response = await fetch(`${bridge}/v1/selection-mask`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: blob,
      });
      if (!response.ok) return null; // 含桥单请求门 429：下次确认重试即可
      const payload = await response.json();
      return typeof payload?.id === "string" ? payload.id : null;
    } catch {
      return null;
    }
  }

  async function choosePartCandidate(
    ordinal: number,
    auto: boolean,
    parts: typeof partCandidates,
  ) {
    if (!parts || candidateConfirmationPending.current) return;
    const chosen = parts.candidates[ordinal];
    if (!chosen) return;
    const revision = contextRevision.current;
    const source = activeSource.current ?? file;
    if (parts.mode === "target") candidateConfirmationPending.current = true;
    // M4 τ 校准回流：auto = τ_auto 自动选中；override = 自动选中后被手动换掉
    // （τ 定得过低的直接证据）。topScore 一起记录，便于按置信度分桶。
    trackPhotoCraftTelemetry("ring-outcome", {
      ring: "open-vocab",
      lane: nlLaneRef.current,
      mode: parts.mode,
      outcome: CANDIDATE_RING.ringOutcome(
        auto,
        parts.autoTop,
        parts.chosen,
        ordinal,
      ),
      ordinal,
      prevOrdinal: parts.chosen ?? -1,
      score: Number(chosen.score.toFixed(4)),
      topScore: Number((parts.candidates[0]?.score ?? 0).toFixed(4)),
      tauAuto: TAU_AUTO,
      auto,
    });
    const nextAutoTop = parts.autoTop || auto;
    if (parts.mode === "protect") {
      setPartCandidates({ ...parts, chosen: ordinal, autoTop: nextAutoTop });
      setProtectRect(chosen.bounds);
      setProtectGap(null);
      setTargetGap(null);
      setMessage(
        `保护框已按候选 ${ordinal + 1}（「${parts.phrase}」）设定；预览时该区域保持原样。点其它编号可更换。`,
      );
      return;
    }
    const landed = landRewrittenSelectionPlan(parts.phrase, () => {
      setPartCandidates({ ...parts, chosen: ordinal, autoTop: nextAutoTop });
      setTargetGap(null);
      setAwaitTargetBox(null);
      setOutline(chosen.outline);
      setSelectionMethod("manual");
      setSelectionMode("outline");
      setPoints([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
    });
    if (!landed) {
      candidateConfirmationPending.current = false;
      setPartCandidates({ ...parts, chosen: ordinal, autoTop: nextAutoTop });
      setMessage(
        `候选 ${ordinal + 1} 已圈出，但这条要求的操作仍解析不出来；请改成「把选区提亮一点」式的说法再解析。`,
      );
      return;
    }
    // D-5 整改：蒙版就位前不声称「已选中」——先中性提示圈选完成、蒙版准备中，
    // prepare 结束后由下方按真实结果（mask/套索）改写。
    setMessage(
      auto
        ? `「${parts.phrase}」候选①匹配分数 ${Math.round(chosen.score * 100)}% ≥ τ_auto，已自动选中并生成计划；正在准备像素蒙版选区…`
        : `目标「${parts.phrase}」已按候选 ${ordinal + 1} 圈选，正在准备像素蒙版选区…`,
    );
    // C 项：计划已落地（套索兜底就位）后异步备真实像素蒙版；成功切 mask
    // 选区法，失败保持 manual+outline 退回套索。candidateBusy 期间候选按钮
    // 禁用，防蒙版上传中双确认。
    setCandidateMaskId(null);
    setCandidateBusy(true);
    let maskReady = false;
    try {
      const maskId = await prepareCandidateMask(chosen, parts);
      if (
        revision !== contextRevision.current ||
        source !== (activeSource.current ?? file)
      )
        return;
      if (maskId) {
        setCandidateMaskId(maskId);
        setSelectionMethod("mask");
        maskReady = true;
      } else {
        setCandidateMaskId(null);
      }
    } finally {
      candidateConfirmationPending.current = false;
      setCandidateBusy(false);
    }
    setMessage(
      maskReady
        ? auto
          ? `「${parts.phrase}」候选①匹配分数 ${Math.round(chosen.score * 100)}% ≥ τ_auto，已自动选中（像素蒙版选区）并生成计划；点「预览编辑」查看效果（预览即提议，可撤销/微调）。`
          : `目标「${parts.phrase}」已按候选 ${ordinal + 1} 的像素蒙版选中；点「预览编辑」查看效果。候选可能漏选部件或带入邻近区域，请在原尺寸检查，必要时用 PhotoCraft 蒙版笔刷补回或剔除。`
        : `候选像素蒙版不可用，已退回轮廓套索选区；点「预览编辑」查看效果。`,
    );
  }

  async function executeInstructionStep(
    source: File,
    step: PhotoCraftInstructionPlan,
    index: number,
    selectionOverride?: "manual",
  ): Promise<EditResult> {
    const side = Math.min(sampleSize[0], sampleSize[1]);
    const squareRect: [number, number, number, number] = [
      Math.floor((sampleSize[0] - side) / 2),
      Math.floor((sampleSize[1] - side) / 2),
      side,
      side,
    ];
    const local =
      step.operation !== "crop" &&
      step.operation !== "text" &&
      step.operation !== "canvas-size" &&
      step.target !== "whole-image";
    // 计划可能携带中文（文案内容、保护名词）而 HTTP 头只收 latin1：
    // 非 ASCII 计划走 base64 头，bridge 端按 UTF-8 解回（同候选词约定）。
    const planJson = JSON.stringify(
      step.operation === "text-style" ||
        step.operation === "drop-shadow" ||
        step.operation === "layer-action"
        ? { ...step, expectedLayerId: sourceInfo?.activeLayer }
        : step,
    );
    const planHeaders: Record<string, string> = /^[\u0000-ÿ]*$/.test(planJson)
      ? { "x-acs-plan": planJson }
      : {
          "x-acs-plan-b64": btoa(
            String.fromCharCode(...new TextEncoder().encode(planJson)),
          ),
        };
    const method = selectionOverride ?? selectionMethod;
    const selectedMask = local && method === "mask" && candidateMaskId;
    const sendInstruction = async (method: string, maskId: string | null) => {
      const response = await fetch(`${bridge}/v1/instruction`, {
        method: "POST",
        headers: {
          "content-type": mime(source),
          ...planHeaders,
          "x-acs-points": JSON.stringify(
            local || step.operation === "text" ? points : [],
          ),
          "x-acs-rect": JSON.stringify(
            step.operation === "crop"
              ? step.square
                ? squareRect
                : scopeRect
              : local
                ? scopeRect
                : null,
          ),
          "x-acs-outline": JSON.stringify(local ? outline : []),
          "x-acs-patches": JSON.stringify(local ? patches : []),
          "x-acs-edge-shift": String(local ? edgeShift : 0),
          "x-acs-edge-feather": String(local ? edgeFeather : 0),
          "x-acs-protect-rect": JSON.stringify(
            step.protectLabel ? protectRect : null,
          ),
          // C 项：蒙版选区法仅在有已上传蒙版 id 时生效（id 由确认候选时
          // /v1/selection-mask 返回；base64 蒙版超头上限所以走 body 路由）。
          // id 缺失/失效时静默退回原方法（outline/rect 恒为兜底数据）。
          ...(maskId ? { "x-acs-selection-mask-id": maskId } : {}),
          "x-acs-selection-method": method,
          "x-acs-heal-size": String(healSize),
          "x-acs-provider-scope-feather": String(providerScopeFeather),
        },
        body: source,
      });
      return { response, data: await response.json() };
    };
    const first = await sendInstruction(
      selectedMask
        ? "mask"
        : local
          ? method === "mask"
            ? "manual"
            : method
          : "manual",
      selectedMask || null,
    );
    if (
      !first.response.ok &&
      selectedMask &&
      shouldRetryCandidateMaskAsOutline(first.data.error, outline.length)
    ) {
      const retry = await sendInstruction("manual", null);
      if (!retry.response.ok)
        throw new Error(
          `第 ${index + 1} 步候选蒙版不可用，套索重试也失败：${retry.data.error ?? "PhotoCraft 编辑失败"}；原项目未改变`,
        );
      return { ...(retry.data as EditResult), selectionFallback: "outline" };
    }
    if (!first.response.ok)
      throw new Error(
        `第 ${index + 1} 步失败：${first.data.error ?? "PhotoCraft 编辑失败"}；原项目未改变`,
      );
    return first.data as EditResult;
  }

  async function previewInstruction() {
    if (candidateConfirmationPending.current) {
      setMessage("候选蒙版仍在准备，请等待选区确认完成后再预览。");
      return;
    }
    const source = activeSource.current ?? file;
    if (!source) {
      setMessage("请先导入图片或打开项目");
      return;
    }
    if (explainConfirm) {
      setMessage("请先确认或纠正上方的解释，再预览编辑。");
      return;
    }
    if (canvasNeedsSync.current) {
      syncBeforePreview.current = true;
      setPending(null);
      setMaskHistory([]);
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setScopeRect(null);
      setProtectRect(null);
      requestCanvasSave(false);
      return;
    }
    const revision = contextRevision.current;
    try {
      if (!plan) throw new Error("请先解析编辑要求");
      // R1：应用前的确认检查不再只限多步——单步计划同样需要用户确认。
      if (!planConfirmed)
        throw new Error("请先检查并勾选确认当前编辑计划（步骤与保护范围）");
      if (plan.operation === "heal" && points.length !== 1)
        throw new Error("请先点击一处要修复的小污点");
      if (plan.operation === "text" && points.length !== 1)
        throw new Error("请先点击文字放置位置");
      if (plan.operation === "crop" && !plan.square && !scopeRect)
        throw new Error("请先画出裁切范围");
      if (
        (plan.operation === "text-style" ||
          plan.operation === "drop-shadow" ||
          plan.operation === "layer-action") &&
        sourceInfo?.selectedLayers.length !== 1
      )
        throw new Error("请先在 PhotoCraft 中只选中一个目标图层并保存画布");
      if (
        selectionMethod === "existing" &&
        plan.target !== "whole-image" &&
        plan.operation !== "crop" &&
        !sourceInfo?.hasSelection
      )
        throw new Error(
          "当前源文件没有持久化选区；请在工作台画框或导入含选区的原生 .pcraft",
        );
      if (
        plan.operation !== "crop" &&
        plan.operation !== "heal" &&
        plan.operation !== "text" &&
        plan.target !== "whole-image" &&
        plan.target !== "subject" &&
        plan.target !== "background" &&
        ((selectionMethod === "object" && !scopeRect) ||
          (selectionMethod === "provider" && !scopeRect && outline.length < 3))
      )
        throw new Error("请先画框或沿目标点击至少 3 个轮廓点");
      if (
        selectionMethod === "manual" &&
        plan.operation === "recolor" &&
        points.length < 2 &&
        outline.length < 3 &&
        !(plan.target === "selected-area" && scopeRect)
      )
        throw new Error("局部换色需要面料取样、选区画框或套索轮廓");
      if (
        selectionMethod === "manual" &&
        plan.operation === "adjust" &&
        plan.target !== "whole-image" &&
        !scopeRect &&
        outline.length < 3
      )
        throw new Error("局部调色需要先画作用范围或套索轮廓");
      if (
        selectionMethod === "manual" &&
        plan.target === "brim" &&
        outline.length < 3
      )
        throw new Error("只改帽沿请沿帽沿点击至少 3 个轮廓点");
      if (
        selectionMethod === "manual" &&
        plan.operation !== "crop" &&
        plan.operation !== "heal" &&
        plan.operation !== "text" &&
        plan.target === "selected-area" &&
        !scopeRect &&
        outline.length < 3
      )
        throw new Error("请先画出要编辑的区域");
      if (draftPatch.length > 0)
        throw new Error("请先完成或撤销当前补选/剔除轮廓");
      if (plan.protectLabel && !protectRect) {
        const protectPhrase = protectPhraseOf(plan);
        throw new Error(
          protectPhrase
            ? `请先圈定「${protectPhrase}」保护框（智能找保护框或手画）`
            : "请先画出标签保护框",
        );
      }
      setBusy(true);
      setMessage(describePhotoCraftPlan(plan));
      setPending(null);
      setCompletedSteps(0);
      setQualityChecks([false, false, false, false]);
      setMaskHistory([]);
      // 旧预览作业作废，挂着的滑杆会话一并关闭（桥端常驻会话不残留）。
      void closeLiveTuning(true);
      const first = await executeInstructionStep(source, plan, 0);
      if (revision !== contextRevision.current)
        throw new Error("画布或编辑要求已改变；旧预览已取消，请重新预览");
      if (first.selectionFallback === "outline") {
        setSelectionMethod("manual");
        setCandidateMaskId(null);
      }
      setPending(first);
      setCompletedSteps(1);
      setShowOriginal(false);
      if (plan.target === "subject" || plan.target === "background")
        void openTargetReview(first.id);
      setMessage(
        `${first.selectionFallback === "outline" ? "候选像素蒙版不可用，已用轮廓套索重新生成预览；" : ""}${
          steps.length > 1
            ? `第 1/${steps.length} 步已预览。先检查并用 PhotoCraft 蒙版修正局部边缘，确认后再执行余下步骤。`
            : "编辑预览已生成。请检查目标、边缘、标签和背景，确认后应用。"
        }`,
      );
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  /** M2 §5 滑杆交接：把已预览作业挂成常驻 live 会话，滑杆直改原生调整层。 */
  /** M4 §7 滑杆修改幅度：会话打开时的计划初值（每个参数的 delta 基线）。 */
  function sliderDeltas(session: LiveTuningSession): string {
    const baseline = liveBaselineRef.current ?? {};
    const deltas: Record<string, number> = {};
    for (const key of Object.keys(session.params))
      deltas[key] =
        Math.round(((session.params[key] ?? 0) - (baseline[key] ?? 0)) * 100) /
        100;
    return JSON.stringify(deltas);
  }

  async function openLiveTuning() {
    if (!pending) return;
    setLiveTuningBusy(true);
    try {
      if (liveTuning) await closeLiveTuning(true);
      const response = await fetch(`${bridge}/v1/live/open`, {
        method: "POST",
        headers: { "x-acs-source-job": pending.id },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "预览会话打开失败");
      const layers = (data.layers ?? []) as LiveLayerInfo[];
      // 指令管线新建的调整层就是激活层；否则退回文档里第一个调整层。
      const target =
        layers.find(
          (layer) => layer.id === data.activeLayer && layer.adjustment,
        ) ?? layers.find((layer) => layer.adjustment);
      if (!target?.adjustment)
        throw new Error("当前预览没有带数值参数的调整层");
      const kind = Object.keys(target.adjustment)[0] ?? "";
      if (!liveAdjustmentRanges[kind])
        throw new Error(`该调整层（${kind}）暂不支持滑杆连续调整`);
      liveBaselineRef.current = { ...target.adjustment[kind] };
      setLiveTuning({
        id: data.id,
        job: data.job,
        layer: target.id,
        layerName: target.name,
        kind,
        params: { ...target.adjustment[kind] },
        previewUrl: data.previewUrl,
      });
      setMessage(
        `滑杆已接管「${target.name}」（${liveAdjustmentLabels[kind] ?? kind}）：拖动实时更新预览。`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLiveTuningBusy(false);
    }
  }

  /**
   * 提交单个滑杆值：一次 layer.setAdjustment + 全尺寸预览重渲。上一笔仍在
   * 引擎里时跳过本次提交——滑杆松手后的下一笔会带上最新值，不排队。
   */
  async function adjustLiveParam(key: string, value: number) {
    if (!liveTuning || liveTuningBusy) return;
    setLiveTuningBusy(true);
    try {
      const response = await fetch(
        `${bridge}/v1/live/${liveTuning.id}/adjust`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            layer: liveTuning.layer,
            params: { [key]: value },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "滑杆调整失败");
      setPreviewVersion((version) => version + 1);
      const kind = Object.keys(data.adjustment ?? {})[0];
      if (kind)
        setLiveTuning((session) =>
          session
            ? {
                ...session,
                params: { ...session.params, ...data.adjustment[kind] },
              }
            : session,
        );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLiveTuningBusy(false);
    }
  }

  /** 关闭滑杆会话但不保存（丢弃微调）；silent 供内部清理路径复用。 */
  async function closeLiveTuning(silent = false) {
    const session = liveTuning;
    if (!session) return;
    setLiveTuning(null);
    trackPhotoCraftTelemetry("slider", {
      lane: nlLaneRef.current,
      outcome: "discard",
      kind: session.kind,
      deltas: sliderDeltas(session),
    });
    liveBaselineRef.current = null;
    try {
      const response = await fetch(`${bridge}/v1/live/${session.id}/close`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "预览会话关闭失败");
      }
    } catch (error) {
      if (!silent) setMessage(String(error));
    }
  }

  /** 滑杆微调定稿：save 原地写回可编辑源文件后关闭会话（预览即最终效果）。 */
  async function finishLiveTuning() {
    const session = liveTuning;
    if (!session) return;
    setLiveTuningBusy(true);
    try {
      const saved = await fetch(`${bridge}/v1/live/${session.id}/save`, {
        method: "POST",
      });
      const saveData = await saved.json();
      if (!saved.ok) throw new Error(saveData.error ?? "滑杆微调保存失败");
      await fetch(`${bridge}/v1/live/${session.id}/close`, {
        method: "POST",
      });
      trackPhotoCraftTelemetry("slider", {
        lane: nlLaneRef.current,
        outcome: "save",
        kind: session.kind,
        deltas: sliderDeltas(session),
      });
      liveBaselineRef.current = null;
      setLiveTuning(null);
      setPreviewVersion((version) => version + 1);
      setQualityChecks([false, false, false, false]);
      setMessage(
        "滑杆微调已写回可编辑源文件；当前预览即最终效果，请检查后应用。",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLiveTuningBusy(false);
    }
  }

  async function prepareForegroundPreview() {
    const revision = contextRevision.current;
    const source = activeSource.current ?? file;
    if (!source || !sourceInfo) {
      setMessage("请先导入图片并保存 PhotoCraft 画布");
      return;
    }
    if (canvasNeedsSync.current) {
      setMessage("PhotoCraft 画布有未同步操作，请先保存画布项目");
      return;
    }
    if (backgroundSelection === "existing" && !sourceInfo.hasSelection) {
      setMessage(
        "当前源文件没有持久化主体选区；请画框或导入含选区的原生 .pcraft",
      );
      return;
    }
    if (backgroundSelection === "object" && !scopeRect) {
      setMessage("请先在图片上拖框包住要保留的主体");
      return;
    }
    if (backgroundSelection === "outline" && outline.length < 3) {
      setMessage("请先沿主体边缘画出闭合轮廓");
      return;
    }
    setBusy(true);
    setPending(null);
    setMaskHistory([]);
    try {
      const normalizedResponse = await fetch(`${bridge}/v1/normalize`, {
        method: "POST",
        headers: { "content-type": mime(source) },
        body: source,
      });
      const normalized = await normalizedResponse.json();
      if (!normalizedResponse.ok)
        throw new Error(normalized.error ?? "无法准备 PhotoCraft 源文件");
      const response = await fetch(`${bridge}/v1/prepare-foreground`, {
        method: "POST",
        headers: {
          "x-acs-source-job": normalized.id,
          "x-acs-foreground-selection": backgroundSelection,
          "x-acs-foreground-outline": JSON.stringify(
            backgroundSelection === "outline" ? outline : [],
          ),
          "x-acs-foreground-rect": JSON.stringify(
            backgroundSelection === "object" ? scopeRect : null,
          ),
          "x-acs-foreground-patches": JSON.stringify(patches),
        },
      });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.error ?? "主体蒙版预览失败");
      if (revision !== contextRevision.current) return;
      setPending(prepared as EditResult);
      setForegroundStage(true);
      setGenerativePreview(false);
      setCompletedSteps(1);
      setShowOriginal(false);
      setMaskTool("off");
      setMessage(
        "主体蒙版已预览。先检查并用 PhotoCraft 蒙版笔刷修正漏选或多选；满意后再生成背景。",
      );
    } catch (error) {
      if (revision === contextRevision.current) {
        setForegroundStage(false);
        setMessage(String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function previewGeneratedEdit() {
    const revision = contextRevision.current;
    const source = activeSource.current ?? file;
    const preparedJob =
      generationMode === "background" && foregroundStage ? pending?.id : null;
    const useSavedSelection =
      generationUseSavedSelection && sourceInfo?.hasSelection === true;
    const generationRect =
      generationMode === "background" && sourceInfo
        ? ([0, 0, sourceInfo.width, sourceInfo.height] as [
            number,
            number,
            number,
            number,
          ])
        : useSavedSelection
          ? sourceInfo?.selectionBounds
          : scopeRect;
    if (!source || !samplePreview || !sourceInfo || !generationRect) {
      setMessage(
        "请先输入局部生成要求，并使用原生源文件中的选区或在图片上拖动画框",
      );
      return;
    }
    if (generationPrompt.trim().length < 3 || generationPrompt.length > 400) {
      setMessage("局部生成要求需为 3～400 字");
      return;
    }
    if (generationMode === "background" && !preparedJob) {
      setMessage("请先预览并修正主体蒙版，再生成背景");
      return;
    }
    if (canvasNeedsSync.current) {
      setMessage("PhotoCraft 画布有未同步操作，请先保存画布项目");
      return;
    }
    setBusy(true);
    if (generationMode !== "background") setPending(null);
    setQualityChecks([false, false, false, false]);
    try {
      const previewResponse = await fetch(samplePreview);
      if (!previewResponse.ok) throw new Error("无法读取当前图片预览");
      const bitmap = await createImageBitmap(await previewResponse.blob());
      if (
        bitmap.width !== sourceInfo.width ||
        bitmap.height !== sourceInfo.height
      )
        throw new Error("预览尺寸与 PhotoCraft 源文件不一致");
      const imageCanvas = document.createElement("canvas");
      imageCanvas.width = bitmap.width;
      imageCanvas.height = bitmap.height;
      imageCanvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = imageCanvas.width;
      maskCanvas.height = imageCanvas.height;
      const maskContext = maskCanvas.getContext("2d");
      if (!maskContext) throw new Error("无法创建局部蒙版");
      maskContext.fillStyle = "#ffffff";
      maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskContext.clearRect(...generationRect);
      const asPng = (canvas: HTMLCanvasElement) =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error("无法编码 PNG")),
            "image/png",
          ),
        );
      const form = new FormData();
      form.set("image", await asPng(imageCanvas), "source.png");
      form.set("mask", await asPng(maskCanvas), "mask.png");
      form.set("prompt", generationPrompt.trim());
      form.set("rect", JSON.stringify(generationRect));
      form.set("mode", generationMode);
      setMessage(
        generationMode === "background"
          ? "图片 Provider 正在生成空背景…"
          : "图片 Provider 正在生成局部内容…",
      );
      const generatedResponse = await fetch("/api/image-local-edit", {
        method: "POST",
        body: form,
      });
      if (!generatedResponse.ok) {
        const detail = await generatedResponse.json();
        throw new Error(detail.error ?? "局部生成失败");
      }
      const generated = await generatedResponse.blob();
      let nativeId = preparedJob;
      if (!nativeId) {
        const nativeResponse = await fetch(`${bridge}/v1/normalize`, {
          method: "POST",
          headers: { "content-type": mime(source) },
          body: source,
        });
        const native = await nativeResponse.json();
        if (!nativeResponse.ok)
          throw new Error(native.error ?? "无法准备 PhotoCraft 源文件");
        nativeId = native.id;
      }
      if (typeof nativeId !== "string")
        throw new Error("PhotoCraft 源引用无效");
      setMessage(
        generationMode === "background"
          ? "PhotoCraft 正在保留原图前景并建立独立背景图层…"
          : "PhotoCraft 正在导入生成结果并创建可编辑蒙版…",
      );
      const composeResponse = await fetch(
        `${bridge}/${generationMode === "background" ? "v1/compose-background" : "v1/compose-generated"}`,
        {
          method: "POST",
          headers: {
            "content-type": "image/png",
            "x-acs-source-job": nativeId,
            "x-acs-generation-rect": JSON.stringify(generationRect),
            "x-acs-generation-selection": useSavedSelection
              ? "existing"
              : generationUseOutline && outline.length >= 3
                ? "new"
                : "object",
            "x-acs-foreground-selection": preparedJob
              ? "prepared"
              : useSavedSelection
                ? "existing"
                : "provider",
            "x-acs-background-shadow":
              generationMode === "background" && generationShadow
                ? "on"
                : "off",
            "x-acs-generation-outline": JSON.stringify(
              !useSavedSelection && generationUseOutline && outline.length >= 3
                ? outline
                : [],
            ),
          },
          body: generated,
        },
      );
      const composed = await composeResponse.json();
      if (!composeResponse.ok)
        throw new Error(composed.error ?? "PhotoCraft 导入失败");
      if (revision !== contextRevision.current) return;
      setPlan(null);
      setSteps([]);
      setCompletedSteps(1);
      setGenerativePreview(true);
      setForegroundStage(false);
      setMaskHistory([]);
      setMaskTool("off");
      setPending(composed as EditResult);
      setShowOriginal(false);
      setMessage(
        generationMode === "background"
          ? "背景预览已建立。原图前景与背景可分别编辑；请检查主体边缘和投影，必要时用 PhotoCraft 蒙版笔刷精修。"
          : "局部生成预览已建立。生成模型可能重绘选区内的文字、形状和材质；请放大检查选区内部与边界，确认后应用。",
      );
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function continueInstructionSequence() {
    if (!pending || completedSteps < 1 || completedSteps >= steps.length)
      return;
    const revision = contextRevision.current;
    setBusy(true);
    setQualityChecks([false, false, false, false]);
    try {
      const currentSource = await fetch(`${bridge}${pending.sourceUrl}`);
      if (!currentSource.ok)
        throw new Error("无法读取已精修的 PhotoCraft 源文件");
      let current = new File(
        [await currentSource.arrayBuffer()],
        "refined-step.pcraft",
        {
          type: "application/x-photocraft",
        },
      );
      let last: EditResult | null = null;
      let outlineFallback = false;
      for (let index = completedSteps; index < steps.length; index++) {
        const step = steps[index];
        if (!step) throw new Error("编辑计划缺少步骤");
        setMessage(
          `PhotoCraft 正在执行第 ${index + 1}/${steps.length} 步：${describePhotoCraftPlan(step)}`,
        );
        last = await executeInstructionStep(
          current,
          step,
          index,
          outlineFallback ? "manual" : undefined,
        );
        if (last.selectionFallback === "outline") outlineFallback = true;
        if (index < steps.length - 1) {
          const nextSource = await fetch(`${bridge}${last.sourceUrl}`);
          if (!nextSource.ok)
            throw new Error(`第 ${index + 1} 步源文件读取失败；原项目未改变`);
          current = new File(
            [await nextSource.arrayBuffer()],
            `step-${index + 1}.pcraft`,
            {
              type: "application/x-photocraft",
            },
          );
        }
      }
      if (!last) throw new Error("PhotoCraft 未生成最终预览");
      if (revision !== contextRevision.current) return;
      if (outlineFallback) {
        setSelectionMethod("manual");
        setCandidateMaskId(null);
      }
      setPending(last);
      setCompletedSteps(steps.length);
      setMaskTool("off");
      setMaskHistory([]);
      setShowOriginal(false);
      const finalStep = steps[steps.length - 1];
      if (
        finalStep &&
        (finalStep.target === "subject" || finalStep.target === "background")
      )
        void openTargetReview(last.id);
      setMessage(
        `${outlineFallback ? "候选像素蒙版不可用，后续步骤已用轮廓套索完成；" : ""}全部 ${steps.length} 步已完成。请在原尺寸检查最终预览并完成质量确认。`,
      );
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function refinePreviewMask(points: Array<[number, number]>) {
    if (!pending || points.length === 0 || maskTool === "off") return;
    setBusy(true);
    try {
      const response = await fetch(
        `${bridge}/v1/jobs/${pending.id}/mask-stroke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            points,
            mode: maskTool,
            size: maskBrushSize,
            hardness: 0.6,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "蒙版精修失败");
      setMaskHistory((history) => [...history, pending]);
      setPending(data as EditResult);
      setQualityChecks([false, false, false, false]);
      setMessage("PhotoCraft 已更新蒙版预览；检查边缘后再应用保存。");
    } catch (error) {
      setMessage(String(error));
    } finally {
      strokePoints.current = [];
      setDraftStroke([]);
      setBusy(false);
    }
  }

  async function applyInstruction(
    grade: PhotoCraftQualityGrade = "ready",
    uploadCloud = false,
  ) {
    if (!pending) return;
    if (
      completedSteps !== (steps.length || 1) ||
      (grade === "ready" && !qualityChecks.every(Boolean)) ||
      showOriginal
    ) {
      setMessage("请完成全部步骤并逐项确认预览质量后再应用");
      return;
    }
    const note = qualityNote.trim();
    if (grade !== "ready" && !note) {
      setMessage("保存待精修草稿前，请写明瑕疵位置与需要人工处理的内容");
      return;
    }
    if (canvasNeedsSync.current) {
      setPending(null);
      setCompletedSteps(0);
      setQualityChecks([false, false, false, false]);
      setMaskHistory([]);
      setMessage("PhotoCraft 画布已有新操作；旧预览已取消。请保存并重新预览。");
      return;
    }
    const revision = contextRevision.current;
    const sourceBeforeApply = activeSource.current;
    setBusy(true);
    try {
      // 应用读取的是作业的可编辑源文件；先确保滑杆微调已落盘（live 会话的
      // save 原地写回同一 source），再关闭会话，避免读到微调前的版本。
      if (liveTuning) {
        const tuned = await fetch(`${bridge}/v1/live/${liveTuning.id}/save`, {
          method: "POST",
        });
        if (!tuned.ok) {
          const data = await tuned.json().catch(() => null);
          throw new Error(data?.error ?? "滑杆微调保存失败");
        }
        await fetch(`${bridge}/v1/live/${liveTuning.id}/close`, {
          method: "POST",
        });
        trackPhotoCraftTelemetry("slider", {
          lane: nlLaneRef.current,
          outcome: "save",
          kind: liveTuning.kind,
          deltas: sliderDeltas(liveTuning),
        });
        liveBaselineRef.current = null;
        setLiveTuning(null);
        setPreviewVersion((version) => version + 1);
      }
      const response = await fetch(`${bridge}${pending.sourceUrl}`);
      if (!response.ok) throw new Error("无法读取 PhotoCraft 可编辑源");
      const bytes = await response.arrayBuffer();
      if (
        revision !== contextRevision.current ||
        activeSource.current !== sourceBeforeApply ||
        canvasNeedsSync.current
      )
        throw new Error("画布或项目已变化；旧预览未应用，请重新预览");
      const saved = await savePhotoCraftProject(
        currentId.current,
        title.current,
        bytes.slice(0),
        original.current,
        {
          grade,
          note,
          checks: qualityChecks,
          criteria: previewQualityCriteria(
            plan,
            generativePreview,
            generationMode,
          ),
        },
      );
      currentId.current = saved.id;
      title.current = saved.title;
      trackPhotoCraftTelemetry("apply", {
        lane: nlLaneRef.current,
        grade,
        steps: steps.length || 1,
        uploadCloud,
      });
      activeSource.current = new File([bytes], `${saved.title}.pcraft`, {
        type: "application/x-photocraft",
      });
      openInCanvas(`${saved.title}.pcraft`, bytes);
      setResult(pending);
      setSavedReview(saved.qualityReview ?? null);
      setReviewHistory(saved.qualityHistory ?? []);
      setSavedGrade(grade);
      setSavedNote(note);
      setSavedChecks([...qualityChecks]);
      setCloudSourceReady(false);
      await showPreview(activeSource.current);
      setPending(null);
      setCompletedSteps(0);
      setQualityChecks([false, false, false, false]);
      setMaskHistory([]);
      setPoints([]);
      setOutline([]);
      setPatches([]);
      setDraftPatch([]);
      setScopeRect(null);
      setProtectRect(null);
      setRectCorner(null);
      setCandidateMaskId(null);
      setSelectionMode("scope");
      setSelectionMethod("object");
      setPlan(null);
      setSteps([]);
      setGenerativePreview(false);
      setPlanConfirmed(false);
      setQualityNote("");
      setMessage(
        grade === "ready"
          ? `已应用 ${steps.length || 1} 步编辑并保存第 ${saved.version} 版；质量等级：可直接使用。`
          : `已保存第 ${saved.version} 版可编辑草稿；质量等级：${qualityLabels[grade]}。请在 PhotoCraft 中继续精修，保存后重新验收。`,
      );
      await refresh();
      if (uploadCloud) await saveCloud();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function recordSavedQuality() {
    if (!currentId.current || !activeSource.current || busy) return;
    if (canvasNeedsSync.current) {
      setMessage("PhotoCraft 画布有未保存修改；请先保存并同步，再记录质量等级");
      return;
    }
    if (savedGrade === "ready" && !savedChecks.every(Boolean)) {
      setMessage("标记为可直接使用前，请完成全部原尺寸质量检查");
      return;
    }
    if (savedGrade !== "ready" && !savedNote.trim()) {
      setMessage("请写明瑕疵位置与需要人工处理的内容");
      return;
    }
    setBusy(true);
    try {
      const updated = await reviewPhotoCraftProject(currentId.current, {
        grade: savedGrade,
        note: savedNote.trim(),
        checks: savedChecks,
        criteria: savedReview?.criteria ?? qualityCriteria(null),
      });
      setSavedReview(updated.qualityReview ?? null);
      setReviewHistory(updated.qualityHistory ?? []);
      let cloudMessage = "";
      if (
        cloudSourceReady &&
        currentCloudVersion.current > 0 &&
        updated.qualityReview
      ) {
        const config = cloudConfig();
        const session = cloudSession();
        if (config && session) {
          try {
            const review = await appendPhotoCraftCloudQualityReview(
              config,
              session.accessToken,
              updated.id,
              currentCloudVersion.current,
              updated.qualityReview,
            );
            setCloudReview(review);
            cloudMessage = "；云端记录已同步";
          } catch (reviewError) {
            cloudMessage = `；云端同步失败：${String(reviewError)}`;
          }
        }
      }
      setMessage(
        `已记录第 ${updated.version} 版质量等级：${qualityLabels[savedGrade]}${cloudMessage}。`,
      );
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function retryCloudQualitySync() {
    const config = cloudConfig();
    const session = cloudSession();
    if (
      !config ||
      !session ||
      !currentId.current ||
      !cloudSourceReady ||
      !currentCloudVersion.current ||
      !savedReview ||
      busy
    )
      return;
    setBusy(true);
    try {
      const review = await appendPhotoCraftCloudQualityReview(
        config,
        session.accessToken,
        currentId.current,
        currentCloudVersion.current,
        savedReview,
      );
      setCloudReview(review);
      setMessage(`云端第 ${review.sourceVersion} 版质量记录已同步。`);
    } catch (error) {
      setMessage(`云端质量记录同步失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function edit() {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetch(`${bridge}/v1/edit`, {
        method: "POST",
        headers: { "content-type": mime(file), "x-acs-hue": String(hue) },
        body: file,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      const editResult = data as EditResult;
      const source = await fetch(`${bridge}${editResult.sourceUrl}`);
      if (!source.ok) throw new Error("无法读取 PhotoCraft 原生文件");
      const bytes = await source.arrayBuffer();
      const project = await savePhotoCraftProject(
        currentId.current,
        file.name.replace(/\.[^.]+$/, ""),
        bytes.slice(0),
        file.name.toLowerCase().endsWith(".pcraft") ? null : file,
      );
      currentId.current = project.id;
      original.current = file.name.toLowerCase().endsWith(".pcraft")
        ? null
        : file;
      activeSource.current = new File([bytes], `${project.title}.pcraft`, {
        type: "application/x-photocraft",
      });
      title.current = project.title;
      openInCanvas(`${project.title}.pcraft`, bytes);
      await showPreview(activeSource.current);
      setResult(editResult);
      setSavedReview(null);
      setReviewHistory(project.qualityHistory ?? []);
      setSavedGrade("manual");
      setSavedNote("");
      setSavedChecks([false, false, false, false]);
      setCloudSourceReady(false);
      setMessage(
        `PhotoCraft 已编辑并保存第 ${project.version} 版，正在画布中打开`,
      );
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "PhotoCraft 编辑失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function imagePoint(
    event: ReactPointerEvent<HTMLImageElement>,
  ): [number, number] {
    const image = event.currentTarget;
    const box = image.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          image.naturalWidth - 1,
          Math.round(
            ((event.clientX - box.left) / box.width) * image.naturalWidth,
          ),
        ),
      ),
      Math.max(
        0,
        Math.min(
          image.naturalHeight - 1,
          Math.round(
            ((event.clientY - box.top) / box.height) * image.naturalHeight,
          ),
        ),
      ),
    ];
  }

  return (
    <main className={`pc-spike${focusCanvas ? " pc-canvas-focused" : ""}`}>
      <header className="pc-spike-header">
        <Link href="/image-studio">← Image Studio 原型</Link>
        <strong>PhotoCraft 图片工作台</strong>
        <span>
          {available ? "本机 PhotoCraft CLI 已连接" : "本机 CLI 桥接服务未启动"}{" "}
          · {ready ? "画布已就绪" : "画布加载中"}
        </span>
      </header>
      <p className="pc-spike-note">
        PhotoCraft 0.6.0 官方画布负责专业编辑。左侧可导入或执行真实编辑； 在
        PhotoCraft 中使用「文件 → 保存」时，原生 .pcraft
        自动进入本浏览器项目库，
        刷新后可直接重开。登录后可将原生项目保存到现有工作区。局部指令先解析为受限计划，再画选区、预览和确认；效果仍需逐张检查。
      </p>
      <div className="pc-spike-layout">
        <section className="pc-spike-panel">
          <h2>项目与编辑</h2>
          <label htmlFor="pc-file">选择 PNG、JPEG、WebP 或 .pcraft</label>
          <input
            id="pc-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,.pcraft"
            disabled={busy}
            onChange={(event) => {
              sourceOpenRequest.current += 1;
              const selected = event.target.files?.[0] ?? null;
              resetEditContext();
              setFile(selected);
              title.current =
                selected?.name.replace(/\.[^.]+$/, "") ??
                "未命名 PhotoCraft 项目";
              activeSource.current = selected;
              original.current = selected?.name
                .toLowerCase()
                .endsWith(".pcraft")
                ? null
                : selected;
              currentId.current = null;
              currentCloudVersion.current = 0;
            }}
          />
          <button
            type="button"
            disabled={!ready || !file || busy}
            onClick={() => void openFile()}
          >
            在画布中打开
          </button>
          <label htmlFor="pc-hue">整体色相偏移：{hue}°</label>
          <input
            id="pc-hue"
            type="range"
            min="-180"
            max="180"
            value={hue}
            onChange={(event) => setHue(Number(event.target.value))}
          />
          <button
            type="button"
            disabled={!available || !ready || !file || busy}
            onClick={() => void edit()}
          >
            {busy ? "PhotoCraft 正在编辑…" : "执行 PhotoCraft 编辑并保存"}
          </button>
          <button type="button" disabled={!ready || busy} onClick={saveCanvas}>
            保存画布项目
          </button>
          <div
            className="pc-workbench-status"
            role="status"
            aria-label="编辑上下文状态"
          >
            <strong>
              {canvasOutOfSync
                ? "画布状态待同步"
                : sourceInfo
                  ? "画布与工作台已同步"
                  : "尚未打开图片"}
            </strong>
            <p>
              {canvasOutOfSync
                ? "画布选择或内容可能已变化；下方信息是上次保存的状态。请保存画布，再检查目标并重新预览。"
                : sourceInfo
                  ? `当前目标：${sourceInfo.layerDetails.find((layer) => layer.id === sourceInfo.activeLayer)?.name ?? "未选中图层"}；${sourceInfo.hasSelection ? "已保存选区" : "无已保存选区"}；${pending ? "编辑预览待确认" : plan ? "编辑计划待预览" : "等待编辑要求"}。`
                  : "请在 PhotoCraft 画布中打开图片。"}
            </p>
            {canvasOutOfSync && (
              <button
                type="button"
                disabled={!ready || busy}
                onClick={saveCanvas}
              >
                保存并同步画布
              </button>
            )}
          </div>
          {sourceInfo && (
            <>
              <p>
                当前图片：{sourceInfo.width} × {sourceInfo.height}，
                {sourceInfo.layers} 个图层，色彩配置：{sourceInfo.profile}
              </p>
              <p>
                PhotoCraft 当前图层：
                {sourceInfo.layerDetails.find(
                  (layer) => layer.id === sourceInfo.activeLayer,
                )?.name ?? "未选中"}
                {sourceInfo.selectedLayers.length > 1
                  ? `（共选中 ${sourceInfo.selectedLayers.length} 层）`
                  : ""}
                ；
                {sourceInfo.hasSelection
                  ? `当前选区 ${sourceInfo.selectionBounds?.join(" × ") ?? "已建立"}`
                  : "当前无选区"}
                。
              </p>
              {!sourceInfo.hasSelection && (
                <p>
                  PhotoCraft Web 当前以 PSD
                  保存；活动选区不会随此格式保留。局部编辑请在工作台画框或画轮廓；已有选区的原生
                  .pcraft 文件可直接复用其选区。
                </p>
              )}
            </>
          )}
          <h2>PhotoCraft 导出</h2>
          <label htmlFor="pc-export-format">格式</label>
          <select
            id="pc-export-format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="tif">TIFF</option>
            <option value="psd">PSD（保留可编辑图层）</option>
          </select>
          <label htmlFor="pc-export-profile">色彩配置</label>
          <select
            id="pc-export-profile"
            value={exportProfile}
            onChange={(event) => setExportProfile(event.target.value)}
          >
            <option value="preserve">保留原色彩配置</option>
            <option value="srgb">转换为 sRGB</option>
          </select>
          <button
            type="button"
            disabled={busy || !(activeSource.current ?? file)}
            onClick={() => void exportCurrentImage()}
          >
            导出当前图片
          </button>
          <h2>自然语言图片编辑</h2>
          <label htmlFor="pc-instruction">编辑要求</label>
          <input
            id="pc-instruction"
            type="text"
            maxLength={240}
            value={instruction}
            onChange={(event) => {
              const next = event.target.value;
              contextRevision.current += 1;
              setInstruction(next);
              setPlan(null);
              setSteps([]);
              setPlanConfirmed(false);
              setPending(null);
              setExplainConfirm(null);
              setPlanDefaults([]);
              // 「第X个」是对打开中提议环的口语确认，不当作新要求清场。
              if (ordinalIndex(next) === null) {
                setTargetReview(null);
                setMaskBounds(null);
                setTargetGap(null);
                setProtectGap(null);
                setPartCandidates(null);
                setAwaitExcludeClick(false);
                setExcludePoints([]);
              }
              void closeLiveTuning(true);
              setMessage("");
            }}
          />
          <button
            type="button"
            disabled={
              busy || canvasOutOfSync || !(activeSource.current ?? file)
            }
            onClick={() => void interpretInstruction()}
          >
            {busy ? "正在处理…" : "解析编辑要求"}
          </button>
          {explainConfirm && (
            <div className="pc-explain-confirm">
              <strong>我理解为：{explainConfirm.description}，对吗？</strong>
              {explainConfirm.issues.length > 0 && (
                <ul>
                  {explainConfirm.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              <div className="pc-explain-actions">
                <button type="button" onClick={confirmExplain}>
                  对，按此理解执行
                </button>
                <button type="button" onClick={correctExplain}>
                  不对，我重新描述
                </button>
              </div>
              <p>
                云端解析与你的原话未完全对上（round-trip
                蕴含核对未通过），因此不直接执行，先由你确认。
              </p>
            </div>
          )}
          {colorChoice && !busy && (
            <div className="pc-target-review">
              <strong>未说明目标颜色</strong>
              <p>
                「换个颜色」缺少想换成什么颜色——这是语义必需项，不再默认灰色
                预览。点选目标色后按原要求重解析：
              </p>
              <div className="pc-target-actions">
                {["红", "蓝", "绿", "黑", "灰"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => chooseRecolorColor(color)}
                  >
                    {color}色
                  </button>
                ))}
              </div>
            </div>
          )}
          {awaitTargetBox && !candidateBusy && (
            <div className="pc-target-review">
              <strong>请在图片上画框限定「{awaitTargetBox.phrase}」</strong>
              <p>
                按住鼠标从目标一角拖到对角，画一个覆盖「
                {awaitTargetBox.phrase}
                」的框（当前任何选区工具下都能画），松开后只按框内范围重新圈选候选。
                「左/右」这类方位词或同名多处目标，画框限定最稳。
              </p>
              <div className="pc-target-actions">
                <button type="button" onClick={() => setAwaitTargetBox(null)}>
                  取消画框限定
                </button>
              </div>
            </div>
          )}
          {targetGap && !candidateBusy && !partCandidates && (
            <div className="pc-target-review">
              <strong>目标「{targetGap.phrase}」需要指定范围</strong>
              <p>
                本机视觉模型（SAM 分割 + 中文 CLIP
                对齐，全部在本机运行）可以在图上圈出「{targetGap.phrase}
                」的候选区域，编号后由你确认。
              </p>
              <div className="pc-target-actions">
                <button
                  type="button"
                  disabled={busy || !(activeSource.current ?? file)}
                  onClick={() => void findPartCandidates("target")}
                >
                  智能找目标：{targetGap.phrase}
                </button>
                <button
                  type="button"
                  disabled={busy || !(activeSource.current ?? file)}
                  onClick={() => {
                    setAwaitTargetBox({ phrase: targetGap.phrase });
                    setMessage(
                      `请在图片上按住拖动画一个框住「${targetGap.phrase}」的框，松开后按框内范围智能圈选候选。`,
                    );
                  }}
                >
                  点击/画框限定后智能找
                </button>
                {sourceInfo?.hasSelection && (
                  <button type="button" onClick={useExistingSelectionForGap}>
                    用已保存的原生选区
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTargetGap(null);
                    setAwaitTargetBox(null);
                    setMessage(
                      "请直接在图片上画框或套索，再点「解析编辑要求」。",
                    );
                  }}
                >
                  改用手动画框
                </button>
              </div>
              {(() => {
                // M3 grounding 级 1（文档上下文）：PSD/.pcraft 命名图层命中提示。
                const named =
                  sourceInfo?.layerDetails?.find((layer) => {
                    const name = layer.name?.trim() ?? "";
                    return (
                      name.length > 0 &&
                      (name.includes(targetGap.phrase) ||
                        targetGap.phrase.includes(name))
                    );
                  })?.name ?? null;
                return named ? (
                  <p>
                    提示：这个文件里有名为「{named}
                    」的图层。引擎注册表没有图层范围查询命令，圈定范围仍需下面的候选/画框；若只要编辑该图层，可在
                    PhotoCraft 里把它单独选中后用「使用原生选区」。
                  </p>
                ) : null;
              })()}
            </div>
          )}
          {protectGap && !candidateBusy && !partCandidates && (
            <div className="pc-target-review">
              <strong>保护范围「{protectGap.phrase}」需要圈定</strong>
              <p>
                这条要求保护「{protectGap.phrase}
                」不被改动。可用同一视觉模型圈出候选保护框（编号确认），或用蒙版笔刷手画保护框。
              </p>
              <div className="pc-target-actions">
                <button
                  type="button"
                  disabled={busy || !(activeSource.current ?? file)}
                  onClick={() => void findPartCandidates("protect")}
                >
                  智能找保护框：{protectGap.phrase}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProtectGap(null);
                    setMessage(
                      "请用蒙版笔刷切到「画保护框」模式手画保护区域。",
                    );
                  }}
                >
                  改用手画保护框
                </button>
              </div>
            </div>
          )}
          {candidateBusy && (
            <div className="pc-target-review">
              <p>
                本机视觉模型正在圈选「
                {(targetGap ?? protectGap)?.phrase ?? ""}
                」候选区域…（
                {partCandidates?.promptBox
                  ? "按画框提示圈选，通常几十秒内完成"
                  : "SAM 网格分割约需一两分钟"}
                ）
              </p>
            </div>
          )}
          {partCandidates && (
            <div className="pc-target-review">
              <strong>
                {partCandidates.mode === "target" ? "目标" : "保护范围"}
                审核（提议
                {partCandidates.chosen === null ? "待确认" : "已确认"}）：「"
                {partCandidates.phrase}」
                {partCandidates.chosen !== null &&
                  `（候选 ${partCandidates.chosen + 1}）`}
                {partCandidates.promptBox && "（已按画框限定重圈）"}
              </strong>
              {partCandidates.chosen === null ? (
                <>
                  <p>
                    候选区域已编号叠在图片上，匹配分数由中文 CLIP
                    对齐打分（本批候选的相对排名，非正确率）。点编号框、下方按钮，或把要求改成「第几个」再解析即可确认。
                  </p>
                  <div className="pc-target-actions">
                    {partCandidates.candidates.map((item, position) => (
                      <button
                        key={item.index}
                        type="button"
                        disabled={candidateBusy}
                        onClick={() =>
                          choosePartCandidate(position, false, partCandidates)
                        }
                      >
                        候选{position + 1}（
                        {partCandidates.candidates.length === 1
                          ? "单候选"
                          : `${Math.round(item.score * 100)}%`}
                        ）
                      </button>
                    ))}
                    {partCandidates.mode === "target" && (
                      <button
                        type="button"
                        disabled={candidateBusy}
                        onClick={() => {
                          setAwaitTargetBox({ phrase: partCandidates.phrase });
                          setAwaitExcludeClick(false);
                          setMessage(
                            "请在图片上按住拖动画一个框住目标的框，松开后只按框内范围重新圈选候选。",
                          );
                        }}
                      >
                        点击/画框限定重新圈选
                      </button>
                    )}
                    {canOfferExcludeRefine({
                      mode: partCandidates.mode,
                      hasPromptBox: Boolean(partCandidates.promptBox),
                      chosen: partCandidates.chosen !== null,
                      candidateCount: partCandidates.candidates.length,
                    }) && (
                      <>
                        {!awaitExcludeClick && excludePoints.length === 0 && (
                          <button
                            type="button"
                            disabled={candidateBusy}
                            onClick={() => {
                              setAwaitExcludeClick(true);
                              setMessage(
                                "候选带进了不该选的区域（如花瓣环带进花蕊）？直接在图上点击误选位置（最多 4 处），点完用「按剔除点重圈」重新圈选；PhotoCraft 蒙版笔刷仍可逐像素精修。",
                              );
                            }}
                          >
                            点选剔除误选区域
                          </button>
                        )}
                        {excludePoints.length > 0 && (
                          <>
                            {!awaitExcludeClick && (
                              <button
                                type="button"
                                disabled={candidateBusy}
                                onClick={() => setAwaitExcludeClick(true)}
                              >
                                继续点选剔除
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={candidateBusy || awaitExcludeClick}
                              onClick={() => {
                                setAwaitExcludeClick(false);
                                void findPartCandidates(
                                  "target",
                                  partCandidates.promptBox,
                                  excludePoints,
                                );
                              }}
                            >
                              按剔除点重圈（{excludePoints.length} 点）
                            </button>
                            <button
                              type="button"
                              disabled={candidateBusy}
                              onClick={() => {
                                setExcludePoints([]);
                                setAwaitExcludeClick(false);
                                setMessage("已清除剔除点。");
                              }}
                            >
                              清除剔除点
                            </button>
                          </>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      disabled={candidateBusy}
                      onClick={() => {
                        setPartCandidates(null);
                        setAwaitTargetBox(null);
                        setAwaitExcludeClick(false);
                        setExcludePoints([]);
                        setMessage(
                          partCandidates.mode === "target"
                            ? "请直接在图片上画框或套索指定范围。"
                            : "请用蒙版笔刷切到「画保护框」模式手画保护区域。",
                        );
                      }}
                    >
                      都不对，手动画
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="pc-candidate-current">
                    已选候选 {partCandidates.chosen + 1}，
                    {partCandidates.mode === "target"
                      ? selectionMethod === "mask"
                        ? "其像素蒙版已作为精确选区生效（比套索更贴合边缘）；点其它编号可更换，或直接点「预览编辑」。"
                        : "其轮廓已作为套索选区生效；点其它编号可更换，或直接点「预览编辑」。"
                      : "已设为保护框；点其它编号可更换。"}
                  </p>
                  {partCandidates.mode === "target" && (
                    <div className="pc-target-actions">
                      <button
                        type="button"
                        disabled={candidateBusy}
                        onClick={() => {
                          // 确认后仍可反悔：恢复目标缺口态（选错候选的换圈
                          // 入口），画框限定后按框重圈。
                          setTargetGap({ phrase: partCandidates.phrase });
                          setAwaitTargetBox({ phrase: partCandidates.phrase });
                          setMessage(
                            "请在图片上按住拖动画一个框住目标的框，松开后只按框内范围重新圈选候选。",
                          );
                        }}
                      >
                        点击/画框限定重新圈选
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <h3>生成式局部编辑</h3>
          <label htmlFor="pc-generation-mode">生成任务</label>
          <select
            id="pc-generation-mode"
            value={generationMode}
            onChange={(event) => {
              setGenerationMode(event.target.value as "local" | "background");
              setPending(null);
              setForegroundStage(false);
              setCompletedSteps(0);
              setMaskHistory([]);
            }}
            disabled={busy}
          >
            <option value="local">局部生成编辑</option>
            <option value="background">替换整幅背景（保留原图主体）</option>
          </select>
          {generationMode === "background" && (
            <>
              <label htmlFor="pc-background-selection">
                保留主体的选取方式
              </label>
              <select
                id="pc-background-selection"
                value={backgroundSelection}
                disabled={busy}
                onChange={(event) => {
                  setBackgroundSelection(
                    event.target.value as typeof backgroundSelection,
                  );
                  setPending(null);
                  setForegroundStage(false);
                }}
              >
                <option value="provider">已有主体分割服务</option>
                <option value="existing" disabled={!sourceInfo?.hasSelection}>
                  原生源文件中的选区
                </option>
                <option value="object">PhotoCraft 框选物体</option>
                <option value="outline">手画主体轮廓</option>
              </select>
              {backgroundSelection === "object" && (
                <button
                  type="button"
                  disabled={busy || !samplePreview}
                  onClick={() => setSelectionMode("scope")}
                >
                  在图片上拖框选择主体
                </button>
              )}
              {backgroundSelection === "outline" && (
                <button
                  type="button"
                  disabled={busy || !samplePreview}
                  onClick={() => setSelectionMode("freehand")}
                >
                  沿主体边缘拖画轮廓
                </button>
              )}
            </>
          )}
          <label htmlFor="pc-generation-prompt">
            {generationMode === "background" ? "新背景要求" : "局部生成要求"}
          </label>
          <input
            id="pc-generation-prompt"
            type="text"
            maxLength={400}
            placeholder={
              generationMode === "background"
                ? "例如：暖米色无缝影棚背景，柔和左侧光"
                : "例如：移除画框中的路人，补全自然背景"
            }
            value={generationPrompt}
            onChange={(event) => setGenerationPrompt(event.target.value)}
          />
          {generationMode === "local" && (
            <button
              type="button"
              disabled={busy || !samplePreview}
              onClick={() => setSelectionMode("scope")}
            >
              在下方图片拖框选择生成范围
            </button>
          )}
          {generationMode === "local" && (
            <label>
              <input
                type="checkbox"
                checked={
                  generationUseSavedSelection && !!sourceInfo?.hasSelection
                }
                disabled={busy || !sourceInfo?.hasSelection}
                onChange={(event) =>
                  setGenerationUseSavedSelection(event.target.checked)
                }
              />
              使用原生源文件中的选区作生成蒙版
            </label>
          )}
          {generationMode === "local" && (
            <button
              type="button"
              disabled={busy || !samplePreview}
              onClick={() => setSelectionMode("freehand")}
            >
              沿目标边缘拖画 PhotoCraft 蒙版轮廓
            </button>
          )}
          {generationMode === "local" && (
            <label>
              <input
                type="checkbox"
                checked={generationUseOutline && outline.length >= 3}
                disabled={busy || outline.length < 3}
                onChange={(event) =>
                  setGenerationUseOutline(event.target.checked)
                }
              />
              生成结果使用已画轮廓作 PhotoCraft 蒙版
            </label>
          )}
          {generationMode === "local" && (
            <label htmlFor="pc-generation-edge-shift">
              PhotoCraft 生成蒙版扩展/收缩：{generationEdgeShift} 像素
              <input
                id="pc-generation-edge-shift"
                type="range"
                min={-32}
                max={32}
                step={1}
                value={generationEdgeShift}
                disabled={busy || cloudJobBusy}
                onChange={(event) =>
                  setGenerationEdgeShift(Number(event.target.value))
                }
              />
            </label>
          )}
          {generationMode === "background" && (
            <label>
              <input
                type="checkbox"
                checked={generationShadow}
                disabled={busy}
                onChange={(event) => setGenerationShadow(event.target.checked)}
              />
              为前景添加可编辑的 PhotoCraft 原生投影
            </label>
          )}
          <p>
            {generationMode === "background"
              ? "先预览主体蒙版，再决定是否生成背景。可用 PhotoCraft 选区、框选物体、手画轮廓或已有分割服务；补选/剔除区域交给 PhotoCraft 原生选区命令。"
              : "局部生成默认用 PhotoCraft 智能选物体与羽化蒙版。复杂轮廓可手画；沿用原生选区前请确认它不是简单矩形。"}
          </p>
          {generationMode === "background" && (
            <button
              type="button"
              disabled={busy || !samplePreview}
              onClick={() => void prepareForegroundPreview()}
            >
              预览主体蒙版（生成背景前）
            </button>
          )}
          <button
            type="button"
            disabled={
              busy ||
              !samplePreview ||
              (generationMode === "background"
                ? !foregroundStage || !pending
                : !(
                    scopeRect ||
                    (generationUseSavedSelection && sourceInfo?.selectionBounds)
                  ))
            }
            onClick={() => void previewGeneratedEdit()}
          >
            {generationMode === "background"
              ? "确认主体蒙版并生成背景（本机预览）"
              : "本机预览局部生成"}
          </button>
          {generationMode === "local" && cloudSourceReady && (
            <>
              <p>
                云端生成积分：{cloudCredits ?? "读取中"}。任务成功写入新版本后扣
                1 积分；失败退回。新图仍须人工检查。
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  cloudJobBusy ||
                  !!pending ||
                  canvasOutOfSync ||
                  cloudCredits === null ||
                  cloudCredits < 1 ||
                  generationPrompt.trim().length < 3 ||
                  !(
                    scopeRect ||
                    outline.length >= 3 ||
                    (generationUseSavedSelection && sourceInfo?.hasSelection)
                  )
                }
                onClick={() => void submitCloudGenerationJob()}
              >
                {cloudJobBusy ? "云端生成中…" : "提交云端局部生成（1 积分）"}
              </button>
            </>
          )}
          {plan &&
            (steps.length > 1 ? (
              <div className="pc-plan" aria-label="编辑步骤计划">
                <strong>编辑计划（按顺序执行）</strong>
                <ol>
                  {steps.map((step, index) => (
                    <li key={index}>{describePhotoCraftPlan(step)}</li>
                  ))}
                </ol>
                <label>
                  <input
                    type="checkbox"
                    checked={planConfirmed}
                    onChange={(event) =>
                      togglePlanConfirmed(event.target.checked)
                    }
                  />
                  我已检查全部步骤、标签保护和方图构图
                </label>
              </div>
            ) : (
              <div className="pc-plan">
                <p>计划：{describePhotoCraftPlan(plan)}</p>
                <label>
                  <input
                    type="checkbox"
                    checked={planConfirmed}
                    onChange={(event) =>
                      togglePlanConfirmed(event.target.checked)
                    }
                  />
                  我已检查该计划（操作、幅度与保护范围）——确认后才可应用或发起批量
                </label>
              </div>
            ))}
          {planDefaults.length > 0 && plan && (
            <p className="pc-plan-defaults">
              默认值已代填：
              {planDefaults
                .map((slot) => `${slot.slot}=${slot.value}（${slot.rule}）`)
                .join("；")}
              。预览后可直接微调——数字的职责交给滑杆。
            </p>
          )}
          <p>
            {plan?.operation === "crop"
              ? "裁切由 PhotoCraft 执行：在图片上拖动画框指定保留区域，预览后再应用。"
              : plan?.operation === "heal"
                ? "点击图片上的一个小污点，由 PhotoCraft 原生污点修复工具处理；原像素层保留。"
                : plan?.operation === "canvas-size"
                  ? "由 PhotoCraft 原生画布尺寸命令执行；预览新增边缘及主体位置后再应用。"
                  : plan?.operation === "orient"
                    ? "由 PhotoCraft 原生命令旋转或翻转整幅图片；预览文字方向和构图后再应用。"
                    : plan?.operation === "image-size"
                      ? "由 PhotoCraft 原生图片尺寸命令重采样；请在原尺寸检查清晰度和比例。"
                      : plan?.operation === "levels"
                        ? "由 PhotoCraft 原生可编辑色阶调整层执行；请检查暗部、高光与颜色。"
                        : plan?.operation === "text-style"
                          ? "修改当前选中的 PhotoCraft 文字图层；请检查字体样式和排版。"
                          : plan?.operation === "drop-shadow"
                            ? "为当前选中的独立图层添加 PhotoCraft 原生投影；整幅背景图层不能产生可见投影。"
                            : plan?.operation === "layer-action"
                              ? "操作 PhotoCraft 当前选中的图层；请先在画布中选择并保存，再检查预览。"
                              : plan?.operation === "text"
                                ? "点击图片上的文字放置位置；PhotoCraft 将创建可编辑文字图层。"
                                : plan?.target === "whole-image"
                                  ? "整图调整由 PhotoCraft 的可编辑调整层执行，无需画选区。"
                                  : plan?.target === "subject" ||
                                      plan?.target === "background"
                                    ? `已用 AI 主体蒙版自动选定${plan?.target === "subject" ? "主体" : "背景"}，无需画框，可直接预览。需要把效果限制在局部时，可另画框或轮廓；边缘不理想时用 PhotoCraft 蒙版画笔修整。`
                                    : `优先用 PhotoCraft 智能选物体：${plan?.target === "hat" ? "要改整顶帽子，请画框完整包住帽身和帽沿。" : plan?.target === "brim" ? "只改帽沿，请画框完整包住帽沿。" : "在目标周围画框。"}复杂边界可切换手动套索、补选和剔除。需要保留标签时，另画标签保护框。`}
          </p>
          {plan?.operation !== "heal" &&
            plan?.operation !== "text" &&
            plan?.operation !== "canvas-size" &&
            plan?.operation !== "orient" &&
            plan?.operation !== "layer-action" &&
            plan?.operation !== "image-size" &&
            plan?.operation !== "levels" &&
            plan?.operation !== "text-style" &&
            plan?.operation !== "drop-shadow" && (
              <>
                <label htmlFor="pc-selection-method">选区来源</label>
                <select
                  id="pc-selection-method"
                  value={selectionMethod}
                  disabled={candidateBusy}
                  onChange={(event) => {
                    const method = event.target.value as
                      | "manual"
                      | "object"
                      | "provider"
                      | "existing";
                    setSelectionMethod(method);
                    setSelectionMode(method === "manual" ? "sample" : "scope");
                    setEdgeFeather(method === "manual" ? 2 : 0);
                    setPending(null);
                  }}
                >
                  <option value="object">PhotoCraft 智能选物体</option>
                  <option value="existing" disabled={!sourceInfo?.hasSelection}>
                    使用原生源文件中的选区
                  </option>
                  <option value="manual">手动取样 / 套索</option>
                  <option value="provider">AI 边缘蒙版 → PhotoCraft</option>
                  {selectionMethod === "mask" && (
                    <option value="mask">已确认候选像素蒙版</option>
                  )}
                </select>
                {selectionMethod === "provider" &&
                  plan?.target !== "whole-image" &&
                  plan?.operation !== "crop" && (
                    <>
                      <p>
                        用本机分割 Provider 提供主体边缘，再由 PhotoCraft
                        创建可编辑蒙版。
                        {plan?.target === "subject" ||
                        plan?.target === "background"
                          ? "主体/背景目标无需画框即可直接预览；画框或轮廓只用来把效果进一步限制在局部。"
                          : "画框或点击轮廓点限定要完整换色的部位；轮廓更适合耳朵等不规则局部，请检查边缘和耳根连接。"}
                      </p>
                      <label htmlFor="pc-provider-scope-feather">
                        范围内侧过渡：{providerScopeFeather} 像素
                      </label>
                      <input
                        id="pc-provider-scope-feather"
                        type="range"
                        min="0"
                        max="120"
                        value={providerScopeFeather}
                        onChange={(event) => {
                          setProviderScopeFeather(Number(event.target.value));
                          setPending(null);
                        }}
                      />
                    </>
                  )}
              </>
            )}
          {plan?.operation !== "canvas-size" &&
            plan?.operation !== "orient" &&
            plan?.operation !== "layer-action" &&
            plan?.operation !== "image-size" &&
            plan?.operation !== "levels" &&
            plan?.operation !== "text-style" &&
            plan?.operation !== "drop-shadow" && (
              <>
                <label htmlFor="pc-selection-mode">图片上操作</label>
                <select
                  id="pc-selection-mode"
                  value={selectionMode}
                  onChange={(event) => {
                    setRectCorner(null);
                    setDraftPatch([]);
                    if (event.target.value === "freehand")
                      setSelectionMethod("manual");
                    setSelectionMode(
                      event.target.value as
                        | "sample"
                        | "heal-point"
                        | "text-point"
                        | "scope"
                        | "outline"
                        | "freehand"
                        | "protect"
                        | "patch-add"
                        | "patch-subtract",
                    );
                  }}
                >
                  {plan?.operation === "heal" ? (
                    <option value="heal-point">点击要修复的污点</option>
                  ) : plan?.operation === "text" ? (
                    <option value="text-point">点击文字放置位置</option>
                  ) : (
                    <>
                      <option value="sample">点击面料取样</option>
                      <option value="scope">拖动画作用范围</option>
                      <option value="outline">点击目标轮廓点</option>
                      <option value="freehand">按住拖动画精细轮廓</option>
                      <option value="patch-add">补选一块区域</option>
                      <option value="patch-subtract">剔除一块区域</option>
                      <option value="protect">拖动画保护范围</option>
                    </>
                  )}
                </select>
              </>
            )}
          {selectionMode === "freehand" && !pending && (
            <p>
              沿目标边界按住拖动一圈后松开；轨迹交给 PhotoCraft
              原生套索建立可编辑蒙版，最多 512 点。
            </p>
          )}
          {(selectionMode === "patch-add" ||
            selectionMode === "patch-subtract") &&
            draftPatch.length > 0 && (
              <div className="pc-selection-actions">
                <button
                  type="button"
                  disabled={draftPatch.length < 3 || patches.length >= 8}
                  onClick={() => {
                    setPatches([
                      ...patches,
                      {
                        mode:
                          selectionMode === "patch-add" ? "add" : "subtract",
                        points: draftPatch,
                      },
                    ]);
                    setDraftPatch([]);
                    setPending(null);
                  }}
                >
                  完成这块{selectionMode === "patch-add" ? "补选" : "剔除"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftPatch(draftPatch.slice(0, -1));
                    setPending(null);
                  }}
                >
                  撤销最后一点
                </button>
              </div>
            )}
          {patches.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPatches(patches.slice(0, -1));
                setPending(null);
              }}
            >
              撤销最后一块修正（已完成 {patches.length} 块）
            </button>
          )}
          {plan?.operation !== "heal" && plan?.operation !== "text" && (
            <>
              <label htmlFor="pc-edge-shift">
                选区边缘扩展/收缩：{edgeShift} 像素
              </label>
              <input
                id="pc-edge-shift"
                type="range"
                min="-20"
                max="20"
                value={edgeShift}
                onChange={(event) => {
                  setEdgeShift(Number(event.target.value));
                  setPending(null);
                }}
              />
              <label htmlFor="pc-edge-feather">
                选区羽化：{edgeFeather} 像素
              </label>
              <input
                id="pc-edge-feather"
                type="range"
                min="0"
                max="8"
                value={edgeFeather}
                onChange={(event) => {
                  setEdgeFeather(Number(event.target.value));
                  setPending(null);
                }}
              />
            </>
          )}
          {plan?.operation === "heal" && (
            <>
              <label htmlFor="pc-heal-size">
                污点修复直径：{healSize} 像素
              </label>
              <input
                id="pc-heal-size"
                type="range"
                min="4"
                max="160"
                value={healSize}
                onChange={(event) => {
                  setHealSize(Number(event.target.value));
                  setPending(null);
                }}
              />
            </>
          )}
          {samplePreview && (
            <>
              {pending && (
                <div className="pc-preview-status">
                  <strong>
                    {showOriginal ? "原图对比" : "编辑预览（未应用）"}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setShowOriginal(!showOriginal)}
                  >
                    {showOriginal ? "查看编辑结果" : "查看原图"}
                  </button>
                </div>
              )}
              {pending &&
                (steps.length <= 1 || completedSteps < steps.length) &&
                plan?.operation !== "crop" &&
                plan?.operation !== "heal" &&
                plan?.operation !== "text" && (
                  <div className="pc-mask-tools">
                    <label htmlFor="pc-mask-tool">PhotoCraft 蒙版笔刷</label>
                    <select
                      id="pc-mask-tool"
                      value={maskTool}
                      disabled={busy}
                      onChange={(event) => {
                        setMaskTool(
                          event.target.value as "off" | "add" | "erase",
                        );
                        setShowOriginal(false);
                      }}
                    >
                      <option value="off">关闭笔刷</option>
                      <option value="erase">黑色剔除溢色</option>
                      <option value="add">白色补回漏选</option>
                    </select>
                    {maskTool !== "off" && (
                      <>
                        <label htmlFor="pc-preview-zoom">预览放大</label>
                        <select
                          id="pc-preview-zoom"
                          value={previewZoom}
                          onChange={(event) =>
                            setPreviewZoom(Number(event.target.value))
                          }
                        >
                          <option value="1">1×</option>
                          <option value="2">2×</option>
                          <option value="4">4×</option>
                        </select>
                        <label htmlFor="pc-mask-size">
                          笔刷直径：{maskBrushSize} 像素
                        </label>
                        <input
                          id="pc-mask-size"
                          type="range"
                          min="2"
                          max="160"
                          value={maskBrushSize}
                          onChange={(event) =>
                            setMaskBrushSize(Number(event.target.value))
                          }
                        />
                        <p>
                          在下方编辑预览上拖动画笔；每笔均由 PhotoCraft
                          修改可编辑蒙版。
                        </p>
                      </>
                    )}
                    {maskHistory.length > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          trackPhotoCraftTelemetry("undo", {
                            lane: nlLaneRef.current,
                            kind: "mask-refine",
                          });
                          setPending(maskHistory.at(-1) ?? null);
                          setMaskHistory(maskHistory.slice(0, -1));
                          setMessage("已撤销上一笔蒙版精修。");
                        }}
                      >
                        撤销上一笔蒙版精修
                      </button>
                    )}
                  </div>
                )}
              <div className="pc-preview-scroll">
                <div
                  className={`pc-sample${pending ? " previewing" : ""}`}
                  style={{ width: pending ? `${previewZoom * 100}%` : "100%" }}
                >
                  <img
                    src={
                      pending && !showOriginal
                        ? `${bridge}${pending.previewUrl}?v=${previewVersion}`
                        : samplePreview
                    }
                    alt={
                      pending && !showOriginal
                        ? "待确认的图片编辑预览"
                        : "图片编辑取样预览"
                    }
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onLoad={(event) => {
                      setSampleSize([
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                      ]);
                    }}
                    onPointerDown={(event) => {
                      if (candidateBusy) return;
                      if (pending) {
                        if (
                          maskTool === "off" ||
                          plan?.operation === "crop" ||
                          plan?.operation === "text" ||
                          showOriginal ||
                          busy
                        )
                          return;
                        event.preventDefault();
                        const first = imagePoint(event);
                        strokePoints.current = [first];
                        setDraftStroke([first]);
                        event.currentTarget.setPointerCapture(event.pointerId);
                        return;
                      }
                      event.preventDefault();
                      pointerStart.current = imagePoint(event);
                      if (selectionMode === "freehand" && !awaitTargetBox) {
                        freehandPoints.current = [pointerStart.current];
                        setFreehandDraft(freehandPoints.current);
                      }
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (candidateBusy) return;
                      if (pending) {
                        if (strokePoints.current.length === 0) return;
                        const next = imagePoint(event);
                        const last = strokePoints.current.at(-1);
                        if (
                          last &&
                          Math.hypot(next[0] - last[0], next[1] - last[1]) >=
                            2 &&
                          strokePoints.current.length < 512
                        ) {
                          strokePoints.current = [
                            ...strokePoints.current,
                            next,
                          ];
                          setDraftStroke(strokePoints.current);
                        }
                        return;
                      }
                      const start = pointerStart.current;
                      if (
                        selectionMode === "freehand" &&
                        freehandPoints.current.length
                      ) {
                        const next = imagePoint(event);
                        const last = freehandPoints.current.at(-1);
                        if (
                          last &&
                          Math.hypot(next[0] - last[0], next[1] - last[1]) >=
                            2 &&
                          freehandPoints.current.length < 512
                        ) {
                          freehandPoints.current = [
                            ...freehandPoints.current,
                            next,
                          ];
                          setFreehandDraft(freehandPoints.current);
                        }
                        return;
                      }
                      if (
                        !start ||
                        (selectionMode !== "scope" &&
                          selectionMode !== "protect" &&
                          !awaitTargetBox)
                      )
                        return;
                      const end = imagePoint(event);
                      setDragRect([
                        Math.min(start[0], end[0]),
                        Math.min(start[1], end[1]),
                        Math.abs(end[0] - start[0]),
                        Math.abs(end[1] - start[1]),
                      ]);
                    }}
                    onPointerUp={(event) => {
                      if (candidateBusy) {
                        pointerStart.current = null;
                        freehandPoints.current = [];
                        setDragRect(null);
                        return;
                      }
                      if (pending) {
                        if (strokePoints.current.length > 0) {
                          const points = strokePoints.current;
                          strokePoints.current = [];
                          void refinePreviewMask(points);
                        }
                        return;
                      }
                      const start = pointerStart.current;
                      pointerStart.current = null;
                      setDragRect(null);
                      const end = imagePoint(event);
                      // D 项入口：等待用户画框限定目标。松手即归一化画框并按
                      // 框重请求候选（x-acs-prompt-box → SAM 框提示模式）；
                      // 框太小不猜不缩放，直接提示重画。
                      if (awaitTargetBox) {
                        if (!start) return;
                        const drawn: [number, number, number, number] = [
                          Math.min(start[0], end[0]),
                          Math.min(start[1], end[1]),
                          Math.abs(end[0] - start[0]),
                          Math.abs(end[1] - start[1]),
                        ];
                        if (drawn[2] < 4 || drawn[3] < 4) {
                          setMessage(
                            "请在目标处按住拖动画一个覆盖目标的框再松开（正在等待限定「" +
                              awaitTargetBox.phrase +
                              "」的位置）。",
                          );
                          return;
                        }
                        const box = normalizePromptBox(drawn, sampleSize);
                        if (!box) {
                          setMessage(
                            "画框太小（任一边不足画面的 2%）；请重新拖画一个能盖住目标的框。",
                          );
                          return;
                        }
                        setAwaitTargetBox(null);
                        // 画新框意味着上一轮剔除点失效（点位语义随旧框作废）。
                        setExcludePoints([]);
                        void findPartCandidates("target", box);
                        return;
                      }
                      // 剔除点采集（蒙版代数交互）：等待态下点击 = 记一个
                      // 归一化负点（不拖画），满 4 个自动停止采集。
                      if (awaitExcludeClick) {
                        const normalized = normalizeExcludePoint(
                          end,
                          sampleSize,
                        );
                        if (!normalized) return;
                        if (
                          excludePoints.some(
                            (point) =>
                              Math.abs(point[0] - normalized[0]) < 0.005 &&
                              Math.abs(point[1] - normalized[1]) < 0.005,
                          )
                        ) {
                          setMessage("这个位置已点过剔除；请点其它误选区域。");
                          return;
                        }
                        const nextPoints = [...excludePoints, normalized];
                        setExcludePoints(nextPoints);
                        if (nextPoints.length >= EXCLUDE_POINT_LIMIT)
                          setAwaitExcludeClick(false);
                        setMessage(
                          `已记 ${nextPoints.length}/${EXCLUDE_POINT_LIMIT} 个剔除点（候选误选的区域）。继续点击可加点；点下方「按剔除点重圈」生效，或「清除剔除点」重来。`,
                        );
                        return;
                      }
                      if (selectionMode === "freehand") {
                        const traced = [...freehandPoints.current, end];
                        freehandPoints.current = [];
                        setFreehandDraft([]);
                        if (traced.length >= 3) {
                          setOutline(traced.slice(0, 512));
                          setPending(null);
                        } else setMessage("请按住并沿目标边缘拖动画出完整轮廓");
                        return;
                      }
                      if (selectionMode === "sample") {
                        if (points.length < 6) setPoints([...points, end]);
                      } else if (
                        selectionMode === "heal-point" ||
                        selectionMode === "text-point"
                      ) {
                        setPoints([end]);
                      } else if (selectionMode === "outline") {
                        if (outline.length < 512) setOutline([...outline, end]);
                      } else if (
                        selectionMode === "patch-add" ||
                        selectionMode === "patch-subtract"
                      ) {
                        if (draftPatch.length < 24)
                          setDraftPatch([...draftPatch, end]);
                      } else if (start) {
                        const first =
                          Math.abs(end[0] - start[0]) >= 4 &&
                          Math.abs(end[1] - start[1]) >= 4
                            ? start
                            : rectCorner;
                        if (!first) {
                          setRectCorner(end);
                          return;
                        }
                        const next: [number, number, number, number] = [
                          Math.min(first[0], end[0]),
                          Math.min(first[1], end[1]),
                          Math.abs(end[0] - first[0]),
                          Math.abs(end[1] - first[1]),
                        ];
                        if (next[2] >= 4 && next[3] >= 4) {
                          if (selectionMode === "scope") {
                            const minimumRatio =
                              selectionMethod === "object" &&
                              plan?.target === "hat"
                                ? 0.05
                                : selectionMethod === "object" &&
                                    plan?.target === "brim"
                                  ? 0.01
                                  : 0;
                            if (
                              next[2] * next[3] <
                              sampleSize[0] * sampleSize[1] * minimumRatio
                            ) {
                              setScopeRect(null);
                              setMessage(
                                "画框太小了。请完整框住要改色的帽子或帽沿，并在四周留少许背景。",
                              );
                            } else setScopeRect(next);
                          } else setProtectRect(next);
                          setRectCorner(null);
                        }
                      }
                      setPending(null);
                    }}
                    onPointerCancel={() => {
                      pointerStart.current = null;
                      setDragRect(null);
                      strokePoints.current = [];
                      setDraftStroke([]);
                      freehandPoints.current = [];
                      setFreehandDraft([]);
                    }}
                  />
                  {pending && draftStroke.length > 0 && (
                    <svg
                      className="pc-mask-stroke"
                      viewBox={`0 0 ${sampleSize[0]} ${sampleSize[1]}`}
                      aria-hidden="true"
                    >
                      <polyline
                        points={draftStroke
                          .map(([x, y]) => `${x},${y}`)
                          .join(" ")}
                        fill="none"
                        stroke={maskTool === "add" ? "#ffffff" : "#111111"}
                        strokeWidth={maskBrushSize}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.7"
                      />
                    </svg>
                  )}
                  {points.map(([x, y], index) => (
                    <span
                      key={`${x}-${y}-${index}`}
                      style={{
                        left: `${(x / sampleSize[0]) * 100}%`,
                        top: `${(y / sampleSize[1]) * 100}%`,
                      }}
                    >
                      {index + 1}
                    </span>
                  ))}
                  {(outline.length > 0 ||
                    freehandDraft.length > 0 ||
                    patches.length > 0 ||
                    draftPatch.length > 0) && (
                    <svg
                      className="pc-outline"
                      viewBox={`0 0 ${sampleSize[0]} ${sampleSize[1]}`}
                      aria-label="目标轮廓"
                    >
                      {outline.length >= 3 && (
                        <polygon
                          points={outline
                            .map(([x, y]) => `${x},${y}`)
                            .join(" ")}
                        />
                      )}
                      <polyline
                        points={(freehandDraft.length ? freehandDraft : outline)
                          .map(([x, y]) => `${x},${y}`)
                          .join(" ")}
                      />
                      {outline.length <= 32 &&
                        outline.map(([x, y], index) => (
                          <circle
                            key={`${x}-${y}-${index}`}
                            cx={x}
                            cy={y}
                            r={Math.max(4, sampleSize[0] / 250)}
                          />
                        ))}
                      {patches.map((patch, index) => (
                        <polygon
                          key={`patch-${index}`}
                          className={patch.mode}
                          points={patch.points
                            .map(([x, y]) => `${x},${y}`)
                            .join(" ")}
                        />
                      ))}
                      {draftPatch.length > 0 && (
                        <polyline
                          className={
                            selectionMode === "patch-subtract"
                              ? "draft-subtract"
                              : "draft-add"
                          }
                          points={draftPatch
                            .map(([x, y]) => `${x},${y}`)
                            .join(" ")}
                        />
                      )}
                    </svg>
                  )}
                  {rectCorner && (
                    <span
                      className="pc-corner"
                      style={{
                        left: `${(rectCorner[0] / sampleSize[0]) * 100}%`,
                        top: `${(rectCorner[1] / sampleSize[1]) * 100}%`,
                      }}
                    >
                      起
                    </span>
                  )}
                  {scopeRect && (
                    <div
                      className="pc-sample-box scope"
                      style={{
                        left: `${(scopeRect[0] / sampleSize[0]) * 100}%`,
                        top: `${(scopeRect[1] / sampleSize[1]) * 100}%`,
                        width: `${(scopeRect[2] / sampleSize[0]) * 100}%`,
                        height: `${(scopeRect[3] / sampleSize[1]) * 100}%`,
                      }}
                    />
                  )}
                  {dragRect && dragRect[2] >= 4 && dragRect[3] >= 4 && (
                    <div
                      className="pc-sample-box draft"
                      style={{
                        left: `${(dragRect[0] / sampleSize[0]) * 100}%`,
                        top: `${(dragRect[1] / sampleSize[1]) * 100}%`,
                        width: `${(dragRect[2] / sampleSize[0]) * 100}%`,
                        height: `${(dragRect[3] / sampleSize[1]) * 100}%`,
                      }}
                    />
                  )}
                  {protectRect && (
                    <div
                      className="pc-sample-box protect"
                      style={{
                        left: `${(protectRect[0] / sampleSize[0]) * 100}%`,
                        top: `${(protectRect[1] / sampleSize[1]) * 100}%`,
                        width: `${(protectRect[2] / sampleSize[0]) * 100}%`,
                        height: `${(protectRect[3] / sampleSize[1]) * 100}%`,
                      }}
                    />
                  )}
                  {targetReview && maskBounds && pending && !showOriginal && (
                    <>
                      <div
                        className={`pc-sample-box candidate${plan?.target === "subject" ? " active" : ""}${maskTool === "off" ? " interactive" : ""}`}
                        style={{
                          left: `${(maskBounds.subject[0] / sampleSize[0]) * 100}%`,
                          top: `${(maskBounds.subject[1] / sampleSize[1]) * 100}%`,
                          width: `${(maskBounds.subject[2] / sampleSize[0]) * 100}%`,
                          height: `${(maskBounds.subject[3] / sampleSize[1]) * 100}%`,
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectTargetCandidate("subject");
                        }}
                      >
                        <span className="pc-candidate-badge">1 主体</span>
                      </div>
                      <div
                        className={`pc-sample-box candidate background${plan?.target === "background" ? " active" : ""}${maskTool === "off" ? " interactive" : ""}`}
                        style={{
                          left: `${(maskBounds.background[0] / sampleSize[0]) * 100}%`,
                          top: `${(maskBounds.background[1] / sampleSize[1]) * 100}%`,
                          width: `${(maskBounds.background[2] / sampleSize[0]) * 100}%`,
                          height: `${(maskBounds.background[3] / sampleSize[1]) * 100}%`,
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectTargetCandidate("background");
                        }}
                      >
                        <span className="pc-candidate-badge background">
                          2 背景
                        </span>
                      </div>
                    </>
                  )}
                  {partCandidates &&
                    !showOriginal &&
                    partCandidates.candidates.map((item, position) => (
                      <div
                        key={`part-${item.index}-${partCandidates.mode}`}
                        className={`pc-sample-box candidate${partCandidates.chosen === position ? " active" : ""}${maskTool === "off" && !candidateBusy && !awaitTargetBox && !awaitExcludeClick ? " interactive" : ""}`}
                        style={{
                          left: `${(item.bounds[0] / sampleSize[0]) * 100}%`,
                          top: `${(item.bounds[1] / sampleSize[1]) * 100}%`,
                          width: `${(item.bounds[2] / sampleSize[0]) * 100}%`,
                          height: `${(item.bounds[3] / sampleSize[1]) * 100}%`,
                          // 剔除点采集态：编号框不抢点击——误选区域往往就在
                          // 候选框正中间，点击必须穿透到图片层记为剔除点。
                          ...(awaitExcludeClick
                            ? { pointerEvents: "none" as const }
                            : {}),
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          // D-5 整改：蒙版准备中的点击不再静默吞掉。
                          if (candidateBusy) {
                            setMessage(
                              "正在准备候选像素蒙版选区，请稍候几秒再点编号。",
                            );
                            return;
                          }
                          if (awaitExcludeClick) return;
                          void choosePartCandidate(
                            position,
                            false,
                            partCandidates,
                          );
                        }}
                      >
                        <span className="pc-candidate-badge">
                          {position + 1}{" "}
                          {partCandidates.mode === "protect" ? "保护" : ""}
                          {partCandidates.phrase} {Math.round(item.score * 100)}
                          %
                        </span>
                      </div>
                    ))}
                  {partCandidates?.promptBox &&
                    excludePoints.map((point, position) => (
                      <div
                        key={`exclude-${point[0]}-${point[1]}`}
                        className="pc-exclude-mark"
                        style={{
                          left: `${point[0] * 100}%`,
                          top: `${point[1] * 100}%`,
                        }}
                        title={`剔除点 ${position + 1}（候选误选区域）`}
                      >
                        ×
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}
          {(points.length > 0 ||
            outline.length > 0 ||
            patches.length > 0 ||
            draftPatch.length > 0 ||
            scopeRect ||
            protectRect) && (
            <button
              type="button"
              disabled={candidateBusy}
              onClick={() => {
                setPoints([]);
                setOutline([]);
                setFreehandDraft([]);
                setPatches([]);
                setDraftPatch([]);
                setRectCorner(null);
                setScopeRect(null);
                setProtectRect(null);
                setCandidateMaskId(null);
                setPending(null);
                setForegroundStage(false);
                setCompletedSteps(0);
                setQualityChecks([false, false, false, false]);
              }}
            >
              清除取样与选区
            </button>
          )}
          <button
            type="button"
            disabled={
              !available ||
              !samplePreview ||
              !plan ||
              canvasOutOfSync ||
              candidateBusy ||
              busy ||
              (steps.length > 1 && !planConfirmed)
            }
            onClick={() => void previewInstruction()}
          >
            预览编辑
          </button>
          {pending &&
            !foregroundStage &&
            completedSteps === (steps.length || 1) &&
            (plan?.operation === "adjust" || plan?.operation === "levels") && (
              <div className="pc-live-tuning">
                {liveTuning ? (
                  <>
                    <strong>
                      滑杆微调：{liveTuning.layerName}（
                      {liveAdjustmentLabels[liveTuning.kind] ?? liveTuning.kind}
                      ）
                    </strong>
                    {Object.entries(
                      liveAdjustmentRanges[liveTuning.kind] ?? {},
                    ).map(([key, [min, max]]) => (
                      <label key={key} htmlFor={`pc-live-${key}`}>
                        {liveParamLabels[key] ?? key}：
                        {liveTuning.params[key] ?? 0}
                        <input
                          id={`pc-live-${key}`}
                          type="range"
                          min={min}
                          max={max}
                          step={max - min > 60 ? 1 : 0.01}
                          value={liveTuning.params[key] ?? 0}
                          disabled={liveTuningBusy}
                          onChange={(event) =>
                            setLiveTuning((session) =>
                              session
                                ? {
                                    ...session,
                                    params: {
                                      ...session.params,
                                      [key]: Number(event.target.value),
                                    },
                                  }
                                : session,
                            )
                          }
                          onPointerUp={(event) =>
                            void adjustLiveParam(
                              key,
                              Number(event.currentTarget.value),
                            )
                          }
                          onKeyUp={(event) =>
                            void adjustLiveParam(
                              key,
                              Number(event.currentTarget.value),
                            )
                          }
                        />
                      </label>
                    ))}
                    <div className="pc-live-actions">
                      <button
                        type="button"
                        disabled={liveTuningBusy}
                        onClick={() => void finishLiveTuning()}
                      >
                        保存微调并结束
                      </button>
                      <button
                        type="button"
                        disabled={liveTuningBusy}
                        onClick={() => void closeLiveTuning()}
                      >
                        放弃微调
                      </button>
                    </div>
                    <p>
                      每次拖动都直接修改 PhotoCraft
                      原生调整层并重渲全尺寸预览（预览即最终效果）；保存后写回可编辑源文件。
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={liveTuningBusy}
                      onClick={() => void openLiveTuning()}
                    >
                      {liveTuningBusy ? "正在打开…" : "滑杆微调此预览"}
                    </button>
                    <p>
                      预览由可编辑调整层生成；点这里改用滑杆直接调数值，无需重新解析。
                    </p>
                  </>
                )}
              </div>
            )}
          {targetReview &&
            pending &&
            (plan?.target === "subject" || plan?.target === "background") && (
              <div className="pc-target-review">
                <strong>
                  目标审核
                  {targetReview.confirmed ? "（已确认）" : "（提议待确认）"}
                </strong>
                <p>
                  候选区域已编号叠在预览上：① 主体 ②
                  背景。点编号框或下方按钮确认；
                  识别不准时可用蒙版画笔修边，或改用手动画框。
                </p>
                <div className="pc-target-actions">
                  <button
                    type="button"
                    disabled={busy}
                    className={
                      plan?.target === "subject" ? "pc-candidate-current" : ""
                    }
                    onClick={() => selectTargetCandidate("subject")}
                  >
                    ① 主体
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={
                      plan?.target === "background"
                        ? "pc-candidate-current"
                        : ""
                    }
                    onClick={() => selectTargetCandidate("background")}
                  >
                    ② 背景
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectTargetCandidate("manual")}
                  >
                    ③ 手动画框
                  </button>
                </div>
              </div>
            )}
          {pending && (
            <div className="pc-spike-result">
              {completedSteps < steps.length ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void continueInstructionSequence()}
                >
                  确认局部效果，执行后续 {steps.length - completedSteps} 步
                </button>
              ) : foregroundStage ? (
                <p>
                  这是主体蒙版检查预览。请修正边缘后点击上方“确认主体蒙版并生成背景”。
                </p>
              ) : (
                <fieldset>
                  <legend>应用前质量检查（请在原尺寸查看）</legend>
                  {previewQualityCriteria(
                    plan,
                    generativePreview,
                    generationMode,
                  ).map((label, index) => (
                    <label key={label} className="pc-quality-check">
                      <input
                        type="checkbox"
                        checked={qualityChecks[index] ?? false}
                        onChange={(event) =>
                          setQualityChecks((checks) =>
                            checks.map((value, i) =>
                              i === index ? event.target.checked : value,
                            ),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <p>
                    全部符合可作为可直接使用的版本保存；未达标时记录问题并保留可编辑草稿，交给
                    PhotoCraft 人工精修。
                  </p>
                </fieldset>
              )}
              {!foregroundStage && (
                <button
                  type="button"
                  disabled={
                    busy ||
                    canvasOutOfSync ||
                    showOriginal ||
                    completedSteps !== (steps.length || 1) ||
                    !qualityChecks.every(Boolean)
                  }
                  onClick={() => void applyInstruction()}
                >
                  应用并保存为可直接使用
                </button>
              )}
              {!foregroundStage &&
                generativePreview &&
                cloudSourceReady &&
                currentCloudVersion.current > 0 &&
                qualityChecks.every(Boolean) && (
                  <button
                    type="button"
                    disabled={busy || canvasOutOfSync || showOriginal}
                    onClick={() => void applyInstruction("ready", true)}
                  >
                    应用生成结果并保存到云端
                  </button>
                )}
              {!foregroundStage && (
                <fieldset className="pc-quality-review">
                  <legend>未达标结果与人工接力</legend>
                  <label htmlFor="pc-draft-grade">当前质量等级</label>
                  <select
                    id="pc-draft-grade"
                    value={qualityGrade}
                    onChange={(event) =>
                      setQualityGrade(
                        event.target.value as PhotoCraftQualityGrade,
                      )
                    }
                  >
                    <option value="minor">可使用但有轻微瑕疵</option>
                    <option value="manual">需人工精修</option>
                    <option value="unsuitable">不适合该用途</option>
                  </select>
                  <label htmlFor="pc-draft-note">瑕疵位置与人工处理要求</label>
                  <textarea
                    id="pc-draft-note"
                    value={qualityNote}
                    onChange={(event) => setQualityNote(event.target.value)}
                    placeholder="例如：瓶身右侧有深色残边；请用 PhotoCraft 蒙版笔刷修正并检查投影。"
                  />
                  <button
                    type="button"
                    disabled={
                      busy ||
                      canvasOutOfSync ||
                      showOriginal ||
                      completedSteps !== (steps.length || 1) ||
                      !qualityNote.trim()
                    }
                    onClick={() => void applyInstruction(qualityGrade)}
                  >
                    保存待精修可编辑草稿
                  </button>
                  {generativePreview &&
                    cloudSourceReady &&
                    currentCloudVersion.current > 0 && (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          canvasOutOfSync ||
                          showOriginal ||
                          completedSteps !== (steps.length || 1) ||
                          !qualityNote.trim()
                        }
                        onClick={() =>
                          void applyInstruction(qualityGrade, true)
                        }
                      >
                        保存待精修草稿到云端
                      </button>
                    )}
                  <p>
                    草稿保留原图与 PhotoCraft 图层、蒙版；不会标为合格成片。
                  </p>
                </fieldset>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setForegroundStage(false);
                  setCompletedSteps(0);
                  setQualityChecks([false, false, false, false]);
                  setMaskHistory([]);
                  setDraftStroke([]);
                }}
              >
                取消预览
              </button>
            </div>
          )}
          {message && <p role="status">{message}</p>}
          {result && (
            <div className="pc-spike-result">
              <p>
                {result.width} × {result.height}，{result.layers} 个图层
              </p>
              <img
                src={`${bridge}${result.previewUrl}`}
                alt="PhotoCraft 编辑后的预览"
              />
              <button type="button" onClick={() => setFocusCanvas(true)}>
                进入 PhotoCraft 继续精修
              </button>
            </div>
          )}
          {currentId.current && sourceInfo && !pending && (
            <fieldset className="pc-quality-review">
              <legend>当前可编辑版本的质量记录</legend>
              <p>
                {savedReview
                  ? `第 ${savedReview.sourceVersion} 版：${qualityLabels[savedReview.grade]}${savedReview.note ? `；${savedReview.note}` : ""}`
                  : "当前版本尚未评级；不能视为已通过成片质量检查。"}
              </p>
              {reviewHistory.length > 0 && (
                <details>
                  <summary>历史质量记录（{reviewHistory.length}）</summary>
                  <ul>
                    {reviewHistory
                      .slice(-5)
                      .reverse()
                      .map((item) => (
                        <li key={item.sourceVersion}>
                          第 {item.sourceVersion} 版：
                          {qualityLabels[item.grade]}
                          {item.note ? `；${item.note}` : ""}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setFocusCanvas(true)}
              >
                在 PhotoCraft 中精修
              </button>
              <p>
                精修后在 PhotoCraft
                保存画布，回到此处按原尺寸重新检查并记录等级。
              </p>
              {(savedReview?.criteria ?? qualityCriteria(null)).map(
                (label, index) => (
                  <label key={label} className="pc-quality-check">
                    <input
                      type="checkbox"
                      checked={savedChecks[index] ?? false}
                      onChange={(event) =>
                        setSavedChecks((checks) =>
                          checks.map((value, i) =>
                            i === index ? event.target.checked : value,
                          ),
                        )
                      }
                    />
                    {label}
                  </label>
                ),
              )}
              <label htmlFor="pc-saved-grade">重新评级</label>
              <select
                id="pc-saved-grade"
                value={savedGrade}
                onChange={(event) =>
                  setSavedGrade(event.target.value as PhotoCraftQualityGrade)
                }
              >
                {Object.entries(qualityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label htmlFor="pc-saved-note">剩余问题或验收备注</label>
              <textarea
                id="pc-saved-note"
                value={savedNote}
                onChange={(event) => setSavedNote(event.target.value)}
              />
              <button
                type="button"
                disabled={
                  busy ||
                  canvasOutOfSync ||
                  (savedGrade === "ready"
                    ? !savedChecks.every(Boolean)
                    : !savedNote.trim())
                }
                onClick={() => void recordSavedQuality()}
              >
                记录当前版本质量等级
              </button>
              <p>
                质量记录保存在本浏览器项目中；云端版本同步后，当前评级也写入云端审核历史。
              </p>
              {cloudSourceReady && savedReview && !cloudReview && (
                <button
                  type="button"
                  disabled={busy || canvasOutOfSync}
                  onClick={() => void retryCloudQualitySync()}
                >
                  重试同步当前质量记录到云端
                </button>
              )}
            </fieldset>
          )}
          <h2>本浏览器项目</h2>
          {projects.length === 0 && (
            <p>暂无项目。执行编辑或在画布中保存后会显示在这里。</p>
          )}
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              disabled={!ready || busy}
              onClick={() => void openProject(project.id)}
            >
              {project.title} · 第 {project.version} 版
              {project.id === currentId.current &&
              cloudSourceReady &&
              cloudReview
                ? ` · ${qualityLabels[cloudReview.grade]}`
                : project.qualityReview?.sourceVersion === project.version
                  ? ` · ${qualityLabels[project.qualityReview.grade]}`
                  : " · 未评级"}
            </button>
          ))}
          <h2>云端项目</h2>
          {cloudReady ? (
            <>
              {cloudConflict && (
                <div className="pc-quality-review" role="status">
                  <strong>本地草稿与云端版本不同</strong>
                  <p>
                    「{cloudConflict.project.title}」本浏览器第{" "}
                    {cloudConflict.localVersion} 版尚未上传；云端当前为第{" "}
                    {cloudConflict.project.version}{" "}
                    版。打开云端版前会复制一份独立的本地草稿，图层和质量记录一并保留。
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void openCloudProject(cloudConflict.project, true)
                    }
                  >
                    保留本地草稿并打开云端版
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openProject(cloudConflict.project.id)}
                  >
                    继续编辑本地草稿
                  </button>
                </div>
              )}
              {cloudSourceReady && currentCloudVersion.current > 0 && (
                <p>
                  云端第 {currentCloudVersion.current} 版质量：
                  {cloudReview
                    ? `${qualityLabels[cloudReview.grade]}${cloudReview.note ? `；${cloudReview.note}` : ""}`
                    : "尚未评级"}
                </p>
              )}
              <button
                type="button"
                onClick={() => void saveCloud()}
                disabled={!currentId.current || busy || canvasOutOfSync}
              >
                保存当前项目到云端
              </button>
              {(plan?.operation === "orient" ||
                plan?.operation === "layer-action" ||
                plan?.operation === "levels" ||
                plan?.operation === "adjust") && (
                <div className="pc-quality-review">
                  <strong>云端 PhotoCraft 编辑任务</strong>
                  <p>
                    使用云端已保存的第 {currentCloudVersion.current} 版执行：
                    {describePhotoCraftPlan(plan)}{" "}
                    完成后生成新的可编辑版本，质量等级需重新检查。
                  </p>
                  <button
                    type="button"
                    disabled={
                      !cloudSourceReady ||
                      !currentId.current ||
                      !currentCloudVersion.current ||
                      busy ||
                      cloudJobBusy ||
                      !!pending ||
                      canvasOutOfSync ||
                      steps.length > 1
                    }
                    onClick={() => void submitCloudEditJob()}
                  >
                    {cloudJobBusy ? "云端任务执行中…" : "提交云端编辑任务"}
                  </button>
                  {!cloudSourceReady && (
                    <p>请先打开云端项目或将当前项目保存到云端，再提交任务。</p>
                  )}
                  {cloudJob && (
                    <p role="status">
                      任务 {cloudJob.id}：{cloudJob.status}；尝试{" "}
                      {cloudJob.attempts} 次
                    </p>
                  )}
                </div>
              )}
              <div className="pc-batch-recipe">
                <h3>批量配方（确认一次，套全目录）</h3>
                {!cloudSourceReady || !currentCloudVersion.current ? (
                  <p>
                    先打开已保存到云端的单图项目并确认编辑计划，再从这里把同一配方套到整个目录。
                  </p>
                ) : !planConfirmed ? (
                  <p>请先在单图上勾选确认当前编辑计划，再发起批量套用。</p>
                ) : !batchRecipeDraft.steps ? (
                  <p>{batchRecipeDraft.error}</p>
                ) : !batchConfirmation ? (
                  <p>
                    正在服务端登记配方确认记录；若长时间停留在此，请取消并重新勾选确认计划。
                  </p>
                ) : batchConfirmation.source.version !==
                  currentCloudVersion.current ? (
                  <p>
                    配方确认记录已过期（源项目产生了新版本），请重新勾选确认计划。
                  </p>
                ) : (
                  <>
                    <p>
                      配方来源：项目「{title.current}」云端第{" "}
                      {batchConfirmation.source.version} 版，服务端已登记确认（
                      {new Date(batchConfirmation.confirmedAt).toLocaleString()}
                      ）；来源版本变化会整批拒绝并要求重新确认。同一确认与目标
                      清单的重试/刷新恢复复用同一请求键，不会重复扣费。
                    </p>
                    <ol>
                      {batchRecipeDraft.steps.map((step, index) => (
                        <li key={index}>{describePhotoCraftBatchStep(step)}</li>
                      ))}
                    </ol>
                    <div className="pc-batch-targets">
                      <button
                        type="button"
                        disabled={batchBusy || cloudProjects.length === 0}
                        onClick={() =>
                          setBatchTargets(cloudProjects.map((item) => item.id))
                        }
                      >
                        全选目录
                      </button>
                      <button
                        type="button"
                        disabled={batchBusy || batchTargets.length === 0}
                        onClick={() => setBatchTargets([])}
                      >
                        清空
                      </button>
                      <span>
                        已选 {batchTargets.length}/{cloudProjects.length}{" "}
                        张（单批上限 {PHOTO_CRAFT_BATCH_PROJECT_LIMIT}）
                      </span>
                    </div>
                    <ul className="pc-batch-project-list">
                      {cloudProjects.map((project) => (
                        <li key={project.id}>
                          <label>
                            <input
                              type="checkbox"
                              disabled={batchBusy}
                              checked={batchTargets.includes(project.id)}
                              onChange={(event) =>
                                setBatchTargets((current) =>
                                  event.target.checked
                                    ? [...current, project.id]
                                    : current.filter((id) => id !== project.id),
                                )
                              }
                            />
                            {project.title} · 云端第 {project.version} 版
                            {project.id === currentId.current
                              ? "（配方来源：勾选会在源图上再执行一次）"
                              : ""}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p>
                      按张计费：本次预计消耗 {batchTargets.length}{" "}
                      积分；当前可用 {cloudCredits ?? "—"}
                      {cloudCredits !== null &&
                      cloudCredits < batchTargets.length
                        ? "（不足：整批不会入队，不产生扣费）"
                        : ""}
                      。不可用的项目会被跳过并列出，跳过项不扣费。
                    </p>
                    <label className="pc-quality-check">
                      <input
                        type="checkbox"
                        disabled={batchBusy || batchTargets.length === 0}
                        checked={batchAck}
                        onChange={(event) => setBatchAck(event.target.checked)}
                      />
                      我已核对以上配方与目标清单，确认提交批量任务。
                    </label>
                    <button
                      type="button"
                      disabled={
                        !batchAck ||
                        batchBusy ||
                        cloudJobBusy ||
                        batchTargets.length === 0 ||
                        batchTargets.length > PHOTO_CRAFT_BATCH_PROJECT_LIMIT ||
                        (cloudCredits !== null &&
                          cloudCredits < batchTargets.length)
                      }
                      onClick={() => void submitBatchRecipe()}
                    >
                      {batchBusy ? "批量任务执行中…" : "确认并提交批量任务"}
                    </button>
                    {batchStatus && !batchBusy && (
                      <button
                        type="button"
                        onClick={() => {
                          // R3：明确发起一次新批次才换请求键（attempt+1）；
                          // 重跑前清空上轮结果并撤销确认勾选。
                          setBatchAttempt((value) => value + 1);
                          setBatchStatus(null);
                          setBatchSkipped(null);
                          setBatchAck(false);
                        }}
                      >
                        对同一配方与目标再跑一批（新批次、按张计费）
                      </button>
                    )}
                    {batchSkipped && batchSkipped.length > 0 && (
                      <div role="status">
                        <strong>
                          跳过 {batchSkipped.length} 项（项目不可用，未扣费）
                        </strong>
                        <ul>
                          {batchSkipped.map((item) => (
                            <li key={item.projectId}>
                              {cloudProjects.find(
                                (project) => project.id === item.projectId,
                              )?.title ?? item.projectId}
                              ：{item.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {batchStatus && (
                      <div role="status">
                        <strong>批次进度（{batchStatus.requestKey}）</strong>
                        <p>
                          共 {batchStatus.total} 张：排队{" "}
                          {batchStatus.statuses.queued ?? 0} · 执行中{" "}
                          {batchStatus.statuses.running ?? 0} · 成功{" "}
                          {batchStatus.statuses.succeeded ?? 0} · 失败{" "}
                          {batchStatus.statuses.failed ?? 0}
                        </p>
                        <p>
                          质量门抽样复检 {batchStatus.sampledJobIds.length}{" "}
                          张（确定性抽样，与执行侧同一函数）
                          {batchStatus.source
                            ? `；来源：项目 ${
                                cloudProjects.find(
                                  (project) =>
                                    project.id ===
                                    batchStatus.source!.projectId,
                                )?.title ?? batchStatus.source.projectId
                              } 第 ${batchStatus.source.version} 版，确认于 ${new Date(
                                batchStatus.source.confirmedAt,
                              ).toLocaleString()}（配方摘要 ${
                                batchStatus.source.stepsDigest?.slice(0, 8) ??
                                "—"
                              }）`
                            : "；本批次为 0015 之前的历史批次，无来源记录"}
                        </p>
                        {batchStatus.jobs.some(
                          (job) => job.status === "failed",
                        ) && (
                          <ul>
                            {batchStatus.jobs
                              .filter((job) => job.status === "failed")
                              .map((job) => (
                                <li key={job.id}>
                                  {cloudProjects.find(
                                    (project) => project.id === job.projectId,
                                  )?.title ?? job.projectId}
                                  （{job.errorCode ?? "UNKNOWN"}
                                  ，原版本未被替换，积分退回）
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {cloudProjects.length === 0 && (
                <p>当前工作区暂无 PhotoCraft 项目。</p>
              )}
              {cloudProjects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  disabled={!ready || busy}
                  onClick={() => void openCloudProject(project)}
                >
                  {project.title} · 云端第 {project.version} 版
                </button>
              ))}
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                const config = cloudConfig();
                if (config)
                  void beginCloudLogin(
                    config,
                    false,
                    "/image-studio/photocraft",
                  );
                else setMessage("云端登录尚未配置");
              }}
            >
              登录云端工作区
            </button>
          )}
        </section>
        <section className="pc-spike-editor">
          <div className="pc-editor-toolbar">
            <h2>PhotoCraft Web 画布</h2>
            {focusCanvas ? (
              <>
                <span>
                  点击调整层右侧的黑白蒙版缩略图；标题出现 Layer Mask/8
                  后，用黑色画笔剔除溢色、白色补回。
                  请先检查画笔不透明度，完成后保存。
                </span>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={saveCanvas}
                >
                  保存原生项目并更新预览
                </button>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={saveCanvasAndReturn}
                >
                  保存并返回工作台
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!ready}
                onClick={() => setFocusCanvas(true)}
              >
                放大画布精修蒙版
              </button>
            )}
          </div>
          <iframe
            ref={frame}
            src="/vendor/photocraft/index.html"
            title="PhotoCraft Web 编辑器"
            style={{ pointerEvents: busy || pending ? "none" : undefined }}
            tabIndex={pending ? -1 : 0}
            allow="fullscreen; clipboard-read; clipboard-write"
            allowFullScreen
          />
        </section>
      </div>
    </main>
  );
}
