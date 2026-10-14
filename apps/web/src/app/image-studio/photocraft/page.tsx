"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
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
  appendPhotoCraftCloudQualityReview,
  getPhotoCraftCloudCredits,
  getPhotoCraftCloudEditJob,
  listPhotoCraftCloudProjects,
  listPhotoCraftCloudQualityReviews,
  loadPhotoCraftCloudSource,
  type PhotoCraftCloudEditJob,
  type PhotoCraftCloudProject,
  type PhotoCraftCloudQualityReview,
  savePhotoCraftCloudProject,
  submitPhotoCraftCloudEditJob,
} from "./cloud-projects";
import {
  describePhotoCraftPlan,
  type PhotoCraftInstructionPlan,
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
} from "./instruction";
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
    "manual" | "object" | "provider" | "existing"
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

  async function interpretInstruction() {
    if (canvasNeedsSync.current) {
      setMessage("画布有未同步的操作。请先保存画布，再解析编辑要求。");
      return;
    }
    if (!activeSource.current && !file) {
      setMessage("请先导入图片或打开项目");
      return;
    }
    const revision = contextRevision.current;
    try {
      setBusy(true);
      setPending(null);
      setMaskHistory([]);
      const directSequence = planPhotoCraftSequence(instruction);
      const direct =
        directSequence?.[0] ?? planPhotoCraftInstruction(instruction);
      let nextSteps = directSequence ?? (direct ? [direct] : []);
      if (!nextSteps.length) {
        const response = await fetch("/api/photocraft-instruction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "无法理解编辑要求");
        nextSteps = Array.isArray(data.steps)
          ? data.steps.map((step: unknown) =>
              parsePhotoCraftModelPlan({
                ...(step as object),
                unsupported: "",
              }),
            )
          : [parsePhotoCraftModelPlan({ ...data.plan, unsupported: "" })];
      }
      const nextPlan = nextSteps[0];
      if (revision !== contextRevision.current) return;
      if (!nextPlan) throw new Error("编辑计划为空");
      setSteps(nextSteps);
      setPlanConfirmed(nextSteps.length === 1);
      setPlan(nextPlan);
      if (
        sourceInfo?.hasSelection &&
        nextPlan.target === "selected-area" &&
        (nextPlan.operation === "recolor" || nextPlan.operation === "adjust")
      )
        setSelectionMethod("existing");
      if (
        nextPlan.operation === "recolor" &&
        nextPlan.target === "selected-area" &&
        /(?:耳朵|猫耳|左耳|右耳)/.test(instruction)
      ) {
        setSelectionMethod("provider");
        setSelectionMode("outline");
        setProviderScopeFeather(60);
      }
      if (nextPlan.target === "whole-image") {
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
      setMessage(describePhotoCraftPlan(nextPlan));
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

  async function executeInstructionStep(
    source: File,
    step: PhotoCraftInstructionPlan,
    index: number,
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
    const response = await fetch(`${bridge}/v1/instruction`, {
      method: "POST",
      headers: {
        "content-type": mime(source),
        "x-acs-plan": JSON.stringify(
          step.operation === "text-style" ||
            step.operation === "drop-shadow" ||
            step.operation === "layer-action"
            ? { ...step, expectedLayerId: sourceInfo?.activeLayer }
            : step,
        ),
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
        "x-acs-selection-method": local ? selectionMethod : "manual",
        "x-acs-heal-size": String(healSize),
        "x-acs-provider-scope-feather": String(providerScopeFeather),
      },
      body: source,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        `第 ${index + 1} 步失败：${data.error ?? "PhotoCraft 编辑失败"}；原项目未改变`,
      );
    return data as EditResult;
  }

  async function previewInstruction() {
    const source = activeSource.current ?? file;
    if (!source) {
      setMessage("请先导入图片或打开项目");
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
      if (steps.length > 1 && !planConfirmed)
        throw new Error("请先检查并确认全部编辑步骤");
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
      if (plan.protectLabel && !protectRect)
        throw new Error("请先画出标签保护框");
      setBusy(true);
      setMessage(describePhotoCraftPlan(plan));
      setPending(null);
      setCompletedSteps(0);
      setQualityChecks([false, false, false, false]);
      setMaskHistory([]);
      const first = await executeInstructionStep(source, plan, 0);
      if (revision !== contextRevision.current)
        throw new Error("画布或编辑要求已改变；旧预览已取消，请重新预览");
      setPending(first);
      setCompletedSteps(1);
      setShowOriginal(false);
      setMessage(
        steps.length > 1
          ? `第 1/${steps.length} 步已预览。先检查并用 PhotoCraft 蒙版修正局部边缘，确认后再执行余下步骤。`
          : "编辑预览已生成。请检查目标、边缘、标签和背景，确认后应用。",
      );
    } catch (error) {
      if (revision === contextRevision.current) setMessage(String(error));
    } finally {
      setBusy(false);
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
      for (let index = completedSteps; index < steps.length; index++) {
        const step = steps[index];
        if (!step) throw new Error("编辑计划缺少步骤");
        setMessage(
          `PhotoCraft 正在执行第 ${index + 1}/${steps.length} 步：${describePhotoCraftPlan(step)}`,
        );
        last = await executeInstructionStep(current, step, index);
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
      setPending(last);
      setCompletedSteps(steps.length);
      setMaskTool("off");
      setMaskHistory([]);
      setShowOriginal(false);
      setMessage(
        `全部 ${steps.length} 步已完成。请在原尺寸检查最终预览并完成质量确认。`,
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
              contextRevision.current += 1;
              setInstruction(event.target.value);
              setPlan(null);
              setSteps([]);
              setPlanConfirmed(false);
              setPending(null);
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
                    onChange={(event) => setPlanConfirmed(event.target.checked)}
                  />
                  我已检查全部步骤、标签保护和方图构图
                </label>
              </div>
            ) : (
              <p className="pc-plan">计划：{describePhotoCraftPlan(plan)}</p>
            ))}
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
                </select>
                {selectionMethod === "provider" &&
                  plan?.target !== "whole-image" &&
                  plan?.operation !== "crop" && (
                    <>
                      <p>
                        用本机分割 Provider 提供主体边缘，再由 PhotoCraft
                        创建可编辑蒙版。画框或点击轮廓点限定要完整换色的部位；轮廓更适合耳朵等不规则局部，请检查边缘和耳根连接。
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
                        ? `${bridge}${pending.previewUrl}`
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
                      if (selectionMode === "freehand") {
                        freehandPoints.current = [pointerStart.current];
                        setFreehandDraft(freehandPoints.current);
                      }
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
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
                          selectionMode !== "protect")
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
              onClick={() => {
                setPoints([]);
                setOutline([]);
                setFreehandDraft([]);
                setPatches([]);
                setDraftPatch([]);
                setRectCorner(null);
                setScopeRect(null);
                setProtectRect(null);
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
              busy ||
              (steps.length > 1 && !planConfirmed)
            }
            onClick={() => void previewInstruction()}
          >
            预览编辑
          </button>
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
