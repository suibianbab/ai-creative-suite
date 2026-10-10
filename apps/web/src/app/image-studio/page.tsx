"use client";

import {
  applyImageOperation,
  type ContactShadow,
  type CropRect,
  commitImageOperation,
  commitImageOperations,
  createImageDocument,
  createImageHistory,
  DEFAULT_CONTACT_SHADOW,
  DEFAULT_IMAGE_ADJUSTMENTS,
  type ImageAdjustments,
  type ImageDocument,
  type ImageDocumentLayer,
  type ImageInstructionPlan,
  type ImageLayer,
  type ImageOperation,
  type MaskStroke,
  planBackgroundPlate,
  planImageInstruction,
  planModelImageInstruction,
  redoImageOperation,
  undoImageOperation,
} from "@acs/image-document";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AiBackgroundPlateProvider,
  loadSampleBackgroundPlate,
} from "./background-provider";
import { removeBackground } from "./capabilities";
import {
  beginCloudLogin,
  cloudConfig,
  cloudLogout,
  cloudSession,
  finishCloudLogin,
} from "./cloud-auth";
import {
  type CloudProjectSummary,
  importCloudProject,
  listCloudProjects,
  loadCloudProject,
  saveCloudProject,
  uploadCloudOriginal,
} from "./cloud-projects";
import {
  type LocalProjectSummary,
  listLocalProjects,
  loadLocalProject,
  saveLocalProject,
} from "./local-projects";
import { frameFromMask } from "./mask-framing";
import { MaskReview } from "./mask-review";
import {
  drawImageDocument,
  hitTestLayer,
  type ImageAssetMap,
  visibleProductBase,
} from "./render";
import {
  inspectSceneLighting,
  type SceneLightingReport,
} from "./scene-lighting";
import "./studio.css";

const presets = [
  { label: "方图 1:1", width: 1080, height: 1080 },
  { label: "竖图 4:5", width: 1080, height: 1350 },
  { label: "横图 16:9", width: 1920, height: 1080 },
] as const;

type DragState = {
  layerId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

type PendingInstruction = ImageInstructionPlan & {
  base: ImageDocument;
  preview: ImageDocument;
  origin?: "lighting";
};

type PendingBackground = {
  base: ImageDocument;
  preview: ImageDocument;
  operations: ImageOperation[];
  assetId: string;
  file: File;
  bitmap: ImageBitmap;
};

export default function ImageStudioPage() {
  const [history, setHistory] = useState(() =>
    createImageHistory(createImageDocument(crypto.randomUUID())),
  );
  const historyRef = useRef(history);
  const [assets, setAssets] = useState<ImageAssetMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [surfaceYDraft, setSurfaceYDraft] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [message, setMessage] = useState("导入一张商品图，开始制作广告画面。");
  const [projects, setProjects] = useState<LocalProjectSummary[]>([]);
  const [projectToOpen, setProjectToOpen] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [forceCloudLogin, setForceCloudLogin] = useState(false);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [cloudToOpen, setCloudToOpen] = useState("");
  const [cloudCurrent, setCloudCurrent] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const cloudKnownAssetIds = useRef(new Set<string>());
  const [maskBusy, setMaskBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef("");
  const [instructionBusy, setInstructionBusy] = useState(false);
  const [instructionError, setInstructionError] = useState("");
  const [pendingInstruction, setPendingInstruction] =
    useState<PendingInstruction | null>(null);
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [lightingReport, setLightingReport] = useState<{
    base: ImageDocument;
    productId: string;
    result: SceneLightingReport;
  } | null>(null);
  const [pendingBackground, setPendingBackground] =
    useState<PendingBackground | null>(null);
  const pendingBackgroundRef = useRef<PendingBackground | null>(null);
  const [maskEditorLayerId, setMaskEditorLayerId] = useState<string | null>(
    null,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalFiles = useRef(new Map<string, File>());
  const savedSnapshot = useRef<string | null>(null);
  const document = history.present;
  const selected = document.layers.find((layer) => layer.id === selectedId);
  const selectedBase =
    selected?.kind === "image" ? visibleProductBase(selected, assets) : null;
  useEffect(() => {
    setSurfaceYDraft(null);
  }, [selectedId]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    setPendingInstruction(null);
  }, [selectedId]);
  const cancelBackgroundPreview = useCallback(() => {
    pendingBackgroundRef.current?.bitmap.close();
    pendingBackgroundRef.current = null;
    setPendingBackground(null);
  }, []);
  useEffect(() => {
    if (
      pendingBackgroundRef.current &&
      pendingBackgroundRef.current.base !== history.present
    )
      cancelBackgroundPreview();
  }, [history, cancelBackgroundPreview]);
  const maskEditorLayer = document.layers.find(
    (layer) => layer.id === maskEditorLayerId && layer.kind === "image",
  );

  useEffect(() => {
    if (selected?.kind === "image") {
      setCropDraft(
        selected.crop ?? {
          x: 0,
          y: 0,
          width: selected.sourceWidth,
          height: selected.sourceHeight,
        },
      );
    } else {
      setCropDraft(null);
    }
  }, [selected]);

  useEffect(() => {
    void listLocalProjects()
      .then(setProjects)
      .catch(() => setMessage("浏览器本地存储不可用，当前仍可编辑和导出。"));
  }, []);

  useEffect(() => {
    const config = cloudConfig();
    if (!config) return;
    void finishCloudLogin(config)
      .then(async () => {
        const session = cloudSession();
        if (!session) return;
        const projects = await listCloudProjects(config, session.accessToken);
        setCloudProjects(projects);
        setCloudConnected(true);
        setForceCloudLogin(false);
      })
      .catch((error) => {
        if (
          error instanceof Error &&
          error.message === "当前账户没有此工作区的访问权限"
        )
          setForceCloudLogin(true);
        setMessage(error instanceof Error ? error.message : "云端登录失败");
      });
  }, []);

  async function refreshCloudProjects() {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) throw new Error("请先登录云端工作区");
    setCloudProjects(await listCloudProjects(config, session.accessToken));
    setCloudConnected(true);
    setForceCloudLogin(false);
  }

  function clearCurrentCanvas() {
    const next = createImageHistory(createImageDocument(crypto.randomUUID()));
    historyRef.current = next;
    setHistory(next);
    originalFiles.current = new Map();
    cloudKnownAssetIds.current = new Set();
    setAssets({});
    setSelectedId(null);
    setCropDraft(null);
    setDrag(null);
    setInstruction("");
    setPendingInstruction(null);
    setMaskEditorLayerId(null);
    setCloudCurrent(null);
    setCloudToOpen("");
    savedSnapshot.current = null;
  }

  async function openCloud() {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !cloudToOpen) return;
    if (!session) {
      setCloudConnected(false);
      setMessage("登录已过期，请重新登录");
      return;
    }
    if (
      historyRef.current.present.layers.length > 0 &&
      JSON.stringify(historyRef.current.present) !== savedSnapshot.current &&
      !window.confirm("当前项目有未保存的修改。仍要打开云端项目吗？")
    )
      return;
    setProjectBusy(true);
    try {
      const loaded = await loadCloudProject(
        config,
        session.accessToken,
        cloudToOpen,
      );
      const bitmaps: ImageAssetMap = {};
      for (const [assetId, file] of loaded.originals)
        bitmaps[assetId] = await createImageBitmap(file);
      originalFiles.current = loaded.originals;
      cloudKnownAssetIds.current = new Set(loaded.originals.keys());
      setAssets(bitmaps);
      const next = createImageHistory(loaded.project.document);
      historyRef.current = next;
      setHistory(next);
      setCloudCurrent({
        id: loaded.project.id,
        version: loaded.project.version,
      });
      savedSnapshot.current = JSON.stringify(loaded.project.document);
      setSelectedId(null);
      setPendingInstruction(null);
      setMaskEditorLayerId(null);
      setMessage(`云端项目已恢复（版本 ${loaded.project.version}）。`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "登录已过期，请重新登录"
      ) {
        cloudLogout();
        setCloudConnected(false);
      }
      if (
        error instanceof Error &&
        error.message === "当前账户没有此工作区的访问权限"
      ) {
        setCloudConnected(false);
        setForceCloudLogin(true);
      }
      setMessage(error instanceof Error ? error.message : "云端项目打开失败");
    } finally {
      setProjectBusy(false);
    }
  }

  async function saveCloud() {
    const config = cloudConfig();
    const session = cloudSession();
    if (!config || !session) {
      setCloudConnected(false);
      setMessage(config ? "登录已过期，请重新登录" : "请先登录云端工作区");
      return;
    }
    setProjectBusy(true);
    try {
      const current = historyRef.current.present;
      if (cloudCurrent?.id === current.id) {
        const ids = current.layers.flatMap((layer) =>
          layer.kind === "image"
            ? [layer.assetId, ...(layer.mask ? [layer.mask.assetId] : [])]
            : [],
        );
        const newIds = [
          ...new Set(ids.filter((id) => !cloudKnownAssetIds.current.has(id))),
        ];
        const map = new Map<string, string>();
        if (newIds.length)
          await saveLocalProject(current, originalFiles.current);
        for (const localId of newIds) {
          const file = originalFiles.current.get(localId);
          if (!file) throw new Error(`原图或蒙版缺失：${localId}`);
          map.set(
            localId,
            await uploadCloudOriginal(
              config,
              session.accessToken,
              current.id,
              localId,
              file,
            ),
          );
        }
        const rewritten: ImageDocument = map.size
          ? {
              ...current,
              layers: current.layers.map((layer) =>
                layer.kind === "image"
                  ? {
                      ...layer,
                      assetId: map.get(layer.assetId) ?? layer.assetId,
                      mask: layer.mask
                        ? {
                            ...layer.mask,
                            assetId:
                              map.get(layer.mask.assetId) ?? layer.mask.assetId,
                          }
                        : undefined,
                    }
                  : layer,
              ),
            }
          : current;
        const saved = await saveCloudProject(
          config,
          session.accessToken,
          rewritten,
          cloudCurrent.version,
        );
        const editedDuringSave = historyRef.current.present !== current;
        if (editedDuringSave && map.size) {
          await refreshCloudProjects();
          throw new Error(
            "云端已保存发起时的快照；编辑期间项目又变化，请重新打开云端项目核对",
          );
        }
        if (map.size) {
          const nextFiles = new Map(originalFiles.current);
          const nextAssets = { ...assets };
          for (const [localId, serverId] of map) {
            const file = nextFiles.get(localId);
            if (file) nextFiles.set(serverId, file);
            nextFiles.delete(localId);
            const bitmap =
              nextAssets[localId] ??
              (file ? await createImageBitmap(file) : undefined);
            if (bitmap) nextAssets[serverId] = bitmap;
            delete nextAssets[localId];
          }
          originalFiles.current = nextFiles;
          cloudKnownAssetIds.current = new Set(nextFiles.keys());
          setAssets(nextAssets);
          const next = createImageHistory(saved.document);
          historyRef.current = next;
          setHistory(next);
          setSelectedId(null);
        }
        setCloudCurrent({ id: saved.id, version: saved.version });
        savedSnapshot.current = JSON.stringify(saved.document);
        setMessage(
          !editedDuringSave
            ? `已保存到云端，版本 ${saved.version}。`
            : `云端已保存版本 ${saved.version}；编辑期间还有新改动，请再次保存。`,
        );
      } else {
        await saveLocalProject(current, originalFiles.current);
        const result = await importCloudProject(
          config,
          session.accessToken,
          current,
          originalFiles.current,
        );
        if (historyRef.current.present !== current) {
          await refreshCloudProjects();
          throw new Error(
            "云端已导入发起时的快照；编辑期间项目又变化，请从云端项目列表重新打开核对",
          );
        }
        const remappedFiles = new Map<string, File>();
        const remappedAssets: ImageAssetMap = {};
        for (const [localId, serverId] of Object.entries(result.assetIdMap)) {
          const file = originalFiles.current.get(localId);
          if (file) remappedFiles.set(serverId, file);
          const bitmap =
            assets[localId] ??
            (file ? await createImageBitmap(file) : undefined);
          if (bitmap) remappedAssets[serverId] = bitmap;
        }
        originalFiles.current = remappedFiles;
        cloudKnownAssetIds.current = new Set(remappedFiles.keys());
        setAssets(remappedAssets);
        const next = createImageHistory(result.project.document);
        historyRef.current = next;
        setHistory(next);
        setCloudCurrent({
          id: result.project.id,
          version: result.project.version,
        });
        savedSnapshot.current = JSON.stringify(result.project.document);
        setSelectedId(null);
        setCloudToOpen(result.project.id);
        setMessage("本地项目已导入云端；编辑历史已在新项目中重新开始。");
      }
      await refreshCloudProjects();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "登录已过期，请重新登录"
      ) {
        cloudLogout();
        setCloudConnected(false);
      }
      if (
        error instanceof Error &&
        error.message === "当前账户没有此工作区的访问权限"
      ) {
        setCloudConnected(false);
        setForceCloudLogin(true);
      }
      setMessage(error instanceof Error ? error.message : "云端保存失败");
    } finally {
      setProjectBusy(false);
    }
  }

  async function saveProject() {
    setProjectBusy(true);
    try {
      const current = historyRef.current.present;
      await saveLocalProject(current, originalFiles.current);
      savedSnapshot.current = JSON.stringify(current);
      const next = await listLocalProjects();
      setProjects(next);
      setProjectToOpen(current.id);
      setMessage("项目和原图已保存到此浏览器，可在刷新后重新打开。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "项目保存失败");
    } finally {
      setProjectBusy(false);
    }
  }

  async function openProject() {
    if (!projectToOpen) return;
    if (
      historyRef.current.present.layers.length > 0 &&
      JSON.stringify(historyRef.current.present) !== savedSnapshot.current &&
      !window.confirm("当前项目有未保存的修改。仍要打开其他项目吗？")
    ) {
      return;
    }
    setProjectBusy(true);
    try {
      const loaded = await loadLocalProject(projectToOpen);
      const bitmaps: ImageAssetMap = {};
      for (const [assetId, file] of loaded.originals) {
        bitmaps[assetId] = await createImageBitmap(file);
      }
      originalFiles.current = loaded.originals;
      setCloudCurrent(null);
      cloudKnownAssetIds.current = new Set();
      setAssets(bitmaps);
      const next = createImageHistory(loaded.document);
      historyRef.current = next;
      setHistory(next);
      savedSnapshot.current = JSON.stringify(loaded.document);
      setSelectedId(null);
      setPendingInstruction(null);
      setMaskEditorLayerId(null);
      setMessage("本地项目和原图已恢复。此前会话的撤销记录不会保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "项目打开失败");
    } finally {
      setProjectBusy(false);
    }
  }

  const commit = useCallback(
    (operation: ImageOperation) => {
      try {
        cancelBackgroundPreview();
        setPendingInstruction(null);
        const next = commitImageOperation(historyRef.current, operation);
        historyRef.current = next;
        setHistory(next);
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "操作失败");
      }
    },
    [cancelBackgroundPreview],
  );

  function changeHistory(direction: "undo" | "redo") {
    cancelBackgroundPreview();
    setPendingInstruction(null);
    const next =
      direction === "undo"
        ? undoImageOperation(historyRef.current)
        : redoImageOperation(historyRef.current);
    historyRef.current = next;
    setHistory(next);
    setMessage(
      direction === "undo" ? "已撤销上一步编辑。" : "已重做上一步编辑。",
    );
  }

  const visibleBackground =
    pendingBackground?.base === document ? pendingBackground : null;
  let preview =
    visibleBackground?.preview ?? pendingInstruction?.preview ?? document;
  const previewAssets = visibleBackground
    ? { ...assets, [visibleBackground.assetId]: visibleBackground.bitmap }
    : assets;
  if (drag && !pendingInstruction && !pendingBackground) {
    const layer = document.layers.find((item) => item.id === drag.layerId);
    if (layer) {
      preview = applyImageOperation(document, {
        type: "transform",
        layerId: layer.id,
        patch: {
          x: layer.x + drag.x - drag.startX,
          y: layer.y + drag.y - drag.startY,
        },
      });
    }
  }

  async function prepareInstruction() {
    if (instructionBusy) return;
    cancelBackgroundPreview();
    const base = historyRef.current.present;
    const targetId = selectedId;
    const input = instruction;
    setInstructionBusy(true);
    setInstructionError("");
    setPendingInstruction(null);
    try {
      let plan: ImageInstructionPlan;
      let source = "AI";
      try {
        const response = await fetch("/api/image-instruction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction: input }),
        });
        if (!response.ok) throw new Error("AI service unavailable");
        plan = planModelImageInstruction(
          base,
          targetId,
          await response.json(),
          () => crypto.randomUUID(),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message !== "AI service unavailable" &&
          !(error instanceof TypeError)
        )
          throw error;
        plan = planImageInstruction(base, targetId, input, () =>
          crypto.randomUUID(),
        );
        source = "本地规则";
      }
      if (
        historyRef.current.present !== base ||
        instructionRef.current !== input ||
        selectedIdRef.current !== targetId
      )
        throw new Error("项目或指令已变化，请重新预览。");
      const next = plan.operations.reduce(applyImageOperation, base);
      setDrag(null);
      setPendingInstruction({ ...plan, base, preview: next });
      setMessage(`${source} 已生成预览；检查画布和操作列表后再应用。`);
    } catch (error) {
      setPendingInstruction(null);
      const detail =
        error instanceof Error ? error.message : "无法理解编辑要求。";
      setInstructionError(detail);
      setMessage(detail);
    } finally {
      setInstructionBusy(false);
    }
  }

  function applyInstruction() {
    const plan = pendingInstruction;
    if (!plan) return;
    if (historyRef.current.present !== plan.base) {
      setPendingInstruction(null);
      setMessage("项目已变化，请重新预览这条编辑要求。");
      return;
    }
    try {
      const next = commitImageOperations(historyRef.current, plan.operations);
      historyRef.current = next;
      setHistory(next);
      const addedTitle = [...plan.operations]
        .reverse()
        .find((operation) => operation.type === "addText");
      if (addedTitle?.type === "addText") setSelectedId(addedTitle.layer.id);
      setPendingInstruction(null);
      setMessage(`已应用：${plan.summary.join("；")}。可用撤销一步恢复。`);
    } catch (error) {
      setPendingInstruction(null);
      setMessage(error instanceof Error ? error.message : "编辑要求应用失败。");
    }
  }

  async function prepareBackground(source: "sample" | "ai") {
    if (backgroundBusy) return;
    const product = selected;
    if (product?.kind !== "image" || !product.mask) {
      setMessage("请先选中已抠图的商品图片图层。");
      return;
    }
    if (source === "ai" && !backgroundPrompt.trim()) {
      setMessage("请先描述想要的背景场景。");
      return;
    }
    const base = historyRef.current.present;
    const targetId = product.id;
    setBackgroundBusy(true);
    setMessage(
      source === "sample" ? "正在加载背景样片…" : "正在生成背景，请稍候…",
    );
    cancelBackgroundPreview();
    setPendingInstruction(null);
    try {
      const file =
        source === "sample"
          ? await loadSampleBackgroundPlate()
          : await new AiBackgroundPlateProvider().generate(
              backgroundPrompt.trim(),
              base.canvas,
            );
      const bitmap = await createImageBitmap(file);
      if (
        historyRef.current.present !== base ||
        selectedIdRef.current !== targetId
      ) {
        bitmap.close();
        throw new Error("项目或所选商品已变化，请重新预览背景。");
      }
      try {
        const assetId = crypto.randomUUID();
        const operations = planBackgroundPlate(
          base,
          targetId,
          assetId,
          bitmap.width,
          bitmap.height,
          () => crypto.randomUUID(),
        );
        const pending: PendingBackground = {
          base,
          preview: operations.reduce(applyImageOperation, base),
          operations,
          assetId,
          file,
          bitmap,
        };
        pendingBackgroundRef.current = pending;
        setPendingBackground(pending);
        setDrag(null);
        setMessage("背景已预览。请检查商品边缘、透光和接触阴影后再应用。");
      } catch (error) {
        bitmap.close();
        throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "背景预览失败。");
    } finally {
      setBackgroundBusy(false);
    }
  }

  function applyBackground() {
    const pending = pendingBackgroundRef.current;
    if (!pending) return;
    if (historyRef.current.present !== pending.base) {
      cancelBackgroundPreview();
      setMessage("项目已变化，请重新预览背景。");
      return;
    }
    try {
      const next = commitImageOperations(
        historyRef.current,
        pending.operations,
      );
      originalFiles.current.set(pending.assetId, pending.file);
      setAssets((current) => ({
        ...current,
        [pending.assetId]: pending.bitmap,
      }));
      pendingBackgroundRef.current = null;
      setPendingBackground(null);
      historyRef.current = next;
      setHistory(next);
      setMessage("背景已应用为独立图层；商品原图未改写，可一步撤销。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "背景应用失败。");
    }
  }

  function checkSceneLighting() {
    if (selected?.kind !== "image" || !selected.mask) return;
    const plate = document.layers.find(
      (layer): layer is ImageLayer =>
        layer.kind === "image" && layer.name === "AI 背景",
    );
    if (!plate) {
      setMessage("请先应用一张场景背景。");
      return;
    }
    try {
      const result = inspectSceneLighting(document, selected, plate, assets);
      setLightingReport({ base: document, productId: selected.id, result });
      setMessage("场景光照检查完成，请结合商品材质人工判断。");
    } catch (error) {
      setLightingReport(null);
      setMessage(error instanceof Error ? error.message : "场景光照检查失败。");
    }
  }

  function previewLightExposure(delta: number) {
    if (selected?.kind !== "image" || !selected.mask) return;
    try {
      cancelBackgroundPreview();
      const requirement =
        delta > 0 ? `曝光提高 ${delta}` : `曝光降低 ${Math.abs(delta)}`;
      const plan = planImageInstruction(
        document,
        selected.id,
        requirement,
        () => crypto.randomUUID(),
      );
      setPendingInstruction({
        ...plan,
        base: document,
        preview: plan.operations.reduce(applyImageOperation, document),
        origin: "lighting",
      });
      setMessage("正在预览商品曝光试调；确认前项目不会改变。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "曝光试调失败。");
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = preview.canvas.width;
    canvas.height = preview.canvas.height;
    drawImageDocument(context, preview, previewAssets, selectedId ?? undefined);
  }, [preview, previewAssets, selectedId]);

  async function importImage(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("请使用 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setMessage("当前原型支持不超过 25 MB 的图片。");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 25_000_000) {
        bitmap.close();
        setMessage("当前原型支持不超过 2500 万像素的图片。");
        return;
      }
      const assetId = crypto.randomUUID();
      const layerId = crypto.randomUUID();
      const scale = Math.min(
        (document.canvas.width * 0.72) / bitmap.width,
        (document.canvas.height * 0.72) / bitmap.height,
      );
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      originalFiles.current.set(assetId, file);
      setAssets((current) => ({ ...current, [assetId]: bitmap }));
      commit({
        type: "addImage",
        layer: {
          id: layerId,
          kind: "image",
          name: file.name,
          assetId,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          x: Math.round((document.canvas.width - width) / 2),
          y: Math.round((document.canvas.height - height) / 2),
          width,
          height,
          rotation: 0,
          opacity: 1,
        },
      });
      setSelectedId(layerId);
      setMessage("已导入原图。当前编辑只改变图层构图，不改写原图像素。");
    } catch {
      setMessage("图片解码失败，请换一张图片重试。");
    }
  }

  async function attachMask(file: File, layer: ImageLayer) {
    if (file.type !== "image/png" || file.size > 25 * 1024 * 1024) {
      setMessage("请导入不超过 25 MB 的 PNG 灰度或透明蒙版。");
      return false;
    }
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 25_000_000) {
        bitmap.close();
        setMessage("当前原型支持不超过 2500 万像素的蒙版。");
        return false;
      }
      if (
        bitmap.width !== layer.sourceWidth ||
        bitmap.height !== layer.sourceHeight
      ) {
        bitmap.close();
        setMessage("蒙版像素尺寸必须与原图完全一致。");
        return false;
      }
      if (
        !historyRef.current.present.layers.some((item) => item.id === layer.id)
      ) {
        bitmap.close();
        setMessage("目标图片图层已移除，蒙版未附加。");
        return false;
      }
      const assetId = crypto.randomUUID();
      const frame = frameFromMask(bitmap, historyRef.current.present.canvas);
      originalFiles.current.set(assetId, file);
      setAssets((current) => ({ ...current, [assetId]: bitmap }));
      commit({
        type: "setMask",
        layerId: layer.id,
        assetId,
        frame: frame ?? undefined,
      });
      setMaskEditorLayerId(layer.id);
      setMessage(
        frame
          ? "蒙版已附加，并按主体自动取景；原图仍单独保存。"
          : "蒙版已附加；未识别到主体，请检查蒙版。原图仍单独保存。",
      );
      return true;
    } catch {
      setMessage("蒙版解码失败，请导入 PNG 文件。");
      return false;
    }
  }

  async function importMask(file?: File) {
    if (!file || selected?.kind !== "image") return;
    await attachMask(file, selected);
  }

  function frameSelectedMask() {
    if (selected?.kind !== "image" || !selected.mask) return;
    const bitmap = assets[selected.mask.assetId];
    if (!bitmap) {
      setMessage("蒙版素材缺失，无法按主体取景。");
      return;
    }
    const frame = frameFromMask(bitmap, document.canvas);
    if (!frame) {
      setMessage("蒙版中未识别到主体，无法自动取景。");
      return;
    }
    commit({ type: "frameImage", layerId: selected.id, frame });
    setMessage("已按蒙版主体取景。可撤销，或继续手动调整裁切和位置。");
  }

  async function generateMask() {
    if (selected?.kind !== "image" || maskBusy) return;
    const original = originalFiles.current.get(selected.assetId);
    if (!original) {
      setMessage("原图素材缺失，无法自动抠图。");
      return;
    }
    setMaskBusy(true);
    setMessage("正在本机生成蒙版，请稍候…");
    try {
      const mask = await removeBackground(original);
      if (await attachMask(mask, selected)) {
        setMessage(
          "本机蒙版已生成。请检查镂空、反光和透明材质，再决定是否导出。",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动抠图失败");
    } finally {
      setMaskBusy(false);
    }
  }

  function addText() {
    const layerId = crypto.randomUUID();
    const fontSize = Math.round(
      Math.min(document.canvas.width * 0.055, document.canvas.height * 0.07),
    );
    commit({
      type: "addText",
      layer: {
        id: layerId,
        kind: "text",
        name: "标题文字",
        text: "让产品成为焦点",
        fontSize,
        color: "#173f3b",
        fontFamily: "Arial, sans-serif",
        x: Math.round(document.canvas.width * 0.06),
        y: Math.round(document.canvas.height * 0.03),
        width: Math.round(document.canvas.width * 0.88),
        height: Math.round(fontSize * 1.5),
        rotation: 0,
        opacity: 1,
      },
    });
    setSelectedId(layerId);
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * document.canvas.width,
      y:
        ((event.clientY - bounds.top) / bounds.height) * document.canvas.height,
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pendingInstruction || pendingBackground) return;
    const point = canvasPoint(event);
    const hit = [...document.layers]
      .reverse()
      .find((layer) => hitTestLayer(layer, point.x, point.y));
    setSelectedId(hit?.id ?? null);
    if (hit) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        layerId: hit.id,
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      });
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const point = canvasPoint(event);
    setDrag({ ...drag, x: point.x, y: point.y });
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const point = canvasPoint(event);
    const layer = document.layers.find((item) => item.id === drag.layerId);
    if (layer) {
      const dx = Math.round(point.x - drag.startX);
      const dy = Math.round(point.y - drag.startY);
      if (dx !== 0 || dy !== 0)
        commit({
          type: "transform",
          layerId: layer.id,
          patch: { x: layer.x + dx, y: layer.y + dy },
        });
    }
    setDrag(null);
  }

  function setLayerNumber(
    key: "x" | "y" | "width" | "height" | "rotation" | "opacity",
    value: number,
  ) {
    if (!selected || !Number.isFinite(value)) return;
    commit({
      type: "transform",
      layerId: selected.id,
      patch: { [key]: value },
    });
  }

  function setAdjustment(key: keyof ImageAdjustments, value: number) {
    if (selected?.kind !== "image" || !Number.isFinite(value)) return;
    commit({
      type: "setAdjustments",
      layerId: selected.id,
      patch: { [key]: value },
    });
  }

  function setContactShadow(shadow: ContactShadow | null) {
    if (selected?.kind !== "image" || !selected.mask) return;
    commit({ type: "setContactShadow", layerId: selected.id, shadow });
  }

  function alignProductToSurface() {
    if (selected?.kind !== "image" || !selected.mask || !selectedBase) return;
    const targetY = surfaceYDraft ?? Math.round(selectedBase.y);
    if (
      !Number.isFinite(targetY) ||
      targetY < 0 ||
      targetY > document.canvas.height
    )
      return setMessage("台面高度必须在画布范围内。");
    try {
      cancelBackgroundPreview();
      setPendingInstruction(null);
      const operations: ImageOperation[] = [
        {
          type: "transform",
          layerId: selected.id,
          patch: { y: selected.y + targetY - selectedBase.y },
        },
      ];
      if (!selected.contactShadow)
        operations.push({
          type: "setContactShadow",
          layerId: selected.id,
          shadow: { ...DEFAULT_CONTACT_SHADOW },
        });
      const next = commitImageOperations(historyRef.current, operations);
      historyRef.current = next;
      setHistory(next);
      setSurfaceYDraft(targetY);
      setMessage("已按蒙版可见底边对齐台面并添加接触阴影，可一步撤销。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "台面对齐失败。");
    }
  }

  function cropToAspect(ratio: number) {
    if (selected?.kind !== "image") return;
    let width = selected.sourceWidth;
    let height = selected.sourceHeight;
    if (width / height > ratio) width = Math.max(1, Math.round(height * ratio));
    else height = Math.max(1, Math.round(width / ratio));
    commit({
      type: "setCrop",
      layerId: selected.id,
      crop: {
        x: Math.floor((selected.sourceWidth - width) / 2),
        y: Math.floor((selected.sourceHeight - height) / 2),
        width,
        height,
      },
    });
  }

  async function exportPng(transparentBackground = false) {
    const missing = document.layers.find(
      (layer) =>
        layer.kind === "image" &&
        (!assets[layer.assetId] || (layer.mask && !assets[layer.mask.assetId])),
    );
    if (missing) {
      setMessage(`图片原图或蒙版缺失，无法导出：${missing.name}`);
      return;
    }
    const canvas = window.document.createElement("canvas");
    canvas.width = document.canvas.width;
    canvas.height = document.canvas.height;
    const context = canvas.getContext("2d");
    if (!context) {
      setMessage("当前浏览器无法导出画布。");
      return;
    }
    try {
      drawImageDocument(
        context,
        document,
        assets,
        undefined,
        transparentBackground,
      );
    } catch {
      setMessage("画布渲染失败，请检查图片图层后重试。");
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob || blob.size === 0) {
      setMessage("PNG 导出失败。");
      return;
    }
    try {
      const bitmap = await createImageBitmap(blob);
      const valid =
        bitmap.width === document.canvas.width &&
        bitmap.height === document.canvas.height;
      bitmap.close();
      if (!valid) throw new Error("PNG 尺寸与画布不一致");
    } catch {
      setMessage("PNG 导出校验失败，请重试。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `creative-image-${document.canvas.width}x${document.canvas.height}${transparentBackground ? "-transparent" : ""}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMessage(
      `已导出 ${document.canvas.width} × ${document.canvas.height}${transparentBackground ? " 透明" : ""} PNG。`,
    );
  }

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <Link href="/" className="studio-brand">
          ✦ AI Creative Suite
        </Link>
        <span className="studio-divider" />
        <span className="studio-title">Image Studio</span>
        <span className="studio-badge">本地编辑原型</span>
        <select
          className="project-picker"
          aria-label="已保存的本地项目"
          value={projectToOpen}
          onChange={(event) => setProjectToOpen(event.target.value)}
          disabled={projectBusy}
        >
          <option value="">选择本地项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title} · {new Date(project.updatedAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="project-action"
          onClick={() => void openProject()}
          disabled={!projectToOpen || projectBusy}
        >
          打开
        </button>
        <button
          type="button"
          className="project-action"
          onClick={() => void saveProject()}
          disabled={projectBusy || !!pendingInstruction || !!pendingBackground}
        >
          保存项目
        </button>
        <button
          type="button"
          className="project-action"
          onClick={() => void exportPng(true)}
          disabled={!!pendingInstruction || !!pendingBackground}
        >
          导出透明 PNG
        </button>
        <button
          type="button"
          className="export-button"
          onClick={() => void exportPng()}
          disabled={!!pendingInstruction || !!pendingBackground}
        >
          导出 PNG
        </button>
      </header>

      <div className="cloud-toolbar">
        <span>云端项目（开发环境）</span>
        {!cloudConnected ? (
          <button
            type="button"
            className="project-action"
            disabled={!cloudConfig() || projectBusy}
            onClick={() => {
              const config = cloudConfig();
              if (config) void beginCloudLogin(config, forceCloudLogin);
            }}
          >
            {forceCloudLogin ? "切换账号登录" : "登录工作区"}
          </button>
        ) : (
          <>
            <select
              className="project-picker"
              aria-label="云端项目"
              value={cloudToOpen}
              onChange={(event) => setCloudToOpen(event.target.value)}
              disabled={projectBusy}
            >
              <option value="">选择云端项目</option>
              {cloudProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title} · v{project.version}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="project-action"
              onClick={() => void openCloud()}
              disabled={!cloudToOpen || projectBusy}
            >
              打开云端
            </button>
            <button
              type="button"
              className="project-action"
              onClick={() => void saveCloud()}
              disabled={
                projectBusy || !!pendingInstruction || !!pendingBackground
              }
            >
              保存到云端
            </button>
            <button
              type="button"
              className="project-action"
              disabled={projectBusy || maskBusy}
              onClick={() => {
                if (
                  historyRef.current.present.layers.length > 0 &&
                  JSON.stringify(historyRef.current.present) !==
                    savedSnapshot.current &&
                  !window.confirm(
                    "清除会话将关闭当前画布，未保存的修改会丢失。继续吗？",
                  )
                )
                  return;
                cloudLogout();
                setCloudConnected(false);
                setCloudProjects([]);
                clearCurrentCanvas();
                setMessage(
                  "本页访问令牌与画布已清除；身份服务会话可能仍有效。本地项目仍保存在此浏览器。",
                );
              }}
            >
              清除本页会话
            </button>
          </>
        )}
      </div>

      <div className="studio-workspace">
        <aside className="studio-panel studio-left">
          <div className="panel-heading">
            <span>素材与图层</span>
            <span>{document.layers.length}</span>
          </div>
          <label className="upload-button">
            ＋ 导入图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void importImage(event.target.files?.[0])}
            />
          </label>
          <button type="button" className="panel-button" onClick={addText}>
            ＋ 添加文字
          </button>
          <p className="panel-caption">
            本地项目和原图保存在此浏览器资料中，切换云端账号后仍可打开。共享设备请使用独立的浏览器资料。
          </p>
          <div className="layer-list">
            {[...document.layers].reverse().map((layer) => (
              <button
                type="button"
                key={layer.id}
                className={`layer-row ${selectedId === layer.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(layer.id)}
              >
                <span className="layer-icon">
                  {layer.kind === "image" ? "▧" : "T"}
                </span>
                <span className="layer-name">{layer.name}</span>
                <span className="layer-kind">
                  {layer.kind === "image" ? "图片" : "文字"}
                </span>
              </button>
            ))}
          </div>
          <div className="identity-note">
            <strong>产品外观保护</strong>
            <span>开启 · 本原型不生成或重绘商品细节</span>
          </div>
        </aside>

        <section className="studio-center" aria-label="图片画布">
          <div className="canvas-toolbar">
            <div className="preset-group">
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  className={
                    document.canvas.width === preset.width &&
                    document.canvas.height === preset.height
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    commit({
                      type: "resizeCanvas",
                      width: preset.width,
                      height: preset.height,
                    })
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="history-group">
              <button
                type="button"
                disabled={history.past.length === 0}
                onClick={() => changeHistory("undo")}
              >
                ↶ 撤销
              </button>
              <button
                type="button"
                disabled={history.future.length === 0}
                onClick={() => changeHistory("redo")}
              >
                ↷ 重做
              </button>
            </div>
          </div>
          <div className="canvas-stage">
            <canvas
              ref={canvasRef}
              className="studio-canvas"
              style={{
                aspectRatio: `${preview.canvas.width} / ${preview.canvas.height}`,
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => setDrag(null)}
              aria-label="可拖动图层的编辑画布"
            />
          </div>
          <div className="studio-status">
            <span>
              {preview.canvas.width} × {preview.canvas.height} px
              {pendingInstruction || pendingBackground ? " · 预览" : ""}
            </span>
            <span>{message}</span>
          </div>
        </section>

        <aside className="studio-panel studio-right">
          <section className="instruction-panel" aria-label="文字编辑要求">
            <h2>用文字编辑画面</h2>
            <p>
              本机 AI
              理解编辑要求，先预览再应用。支持画布、背景、商品位置、基础调色、整块商品换色和标题；换色前请先抠图，生成或重绘暂不支持。
            </p>
            <textarea
              aria-label="编辑要求"
              value={instruction}
              onChange={(event) => {
                instructionRef.current = event.target.value;
                setInstruction(event.target.value);
                setInstructionError("");
                setPendingInstruction(null);
              }}
              placeholder="例如：把商品亮度调到 20；曝光提高 0.5；添加标题：秋日新品"
              maxLength={240}
            />
            <button
              type="button"
              onClick={prepareInstruction}
              disabled={!instruction.trim() || instructionBusy}
            >
              {instructionBusy ? "AI 正在理解…" : "预览编辑"}
            </button>
            {instructionError && (
              <p className="instruction-error" role="alert">
                {instructionError}
              </p>
            )}
            {pendingInstruction && pendingInstruction.origin !== "lighting" && (
              <div className="instruction-preview">
                <strong>待应用的操作</strong>
                <ol>
                  {pendingInstruction.summary.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ol>
                <div className="instruction-actions">
                  <button type="button" onClick={applyInstruction}>
                    应用编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingInstruction(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </section>
          <section
            className="instruction-panel background-panel"
            aria-label="场景背景"
          >
            <h2>场景背景</h2>
            <p>
              先选中已抠图商品。背景单独生成并放在商品图层下方；原图和蒙版保持不变。
            </p>
            <textarea
              aria-label="背景场景描述"
              value={backgroundPrompt}
              onChange={(event) => setBackgroundPrompt(event.target.value)}
              placeholder="例如：暖色摄影棚，浅色石材展台，左侧柔光"
              maxLength={400}
            />
            <div className="instruction-actions">
              <button
                type="button"
                onClick={() => void prepareBackground("ai")}
                disabled={
                  backgroundBusy ||
                  !backgroundPrompt.trim() ||
                  selected?.kind !== "image" ||
                  !selected.mask
                }
              >
                {backgroundBusy ? "正在准备背景…" : "AI 生成背景"}
              </button>
              <button
                type="button"
                onClick={() => void prepareBackground("sample")}
                disabled={
                  backgroundBusy || selected?.kind !== "image" || !selected.mask
                }
              >
                试用背景样片
              </button>
              <button
                type="button"
                onClick={checkSceneLighting}
                disabled={
                  selected?.kind !== "image" ||
                  !selected.mask ||
                  !!pendingInstruction ||
                  !!pendingBackground ||
                  !document.layers.some(
                    (layer) =>
                      layer.kind === "image" && layer.name === "AI 背景",
                  )
                }
              >
                检查场景光照
              </button>
            </div>
            {lightingReport?.base === document &&
              !pendingBackground &&
              lightingReport.productId === selectedId && (
                <div className="instruction-preview">
                  <strong>
                    {lightingReport.result.status === "review"
                      ? "需要人工复核光照"
                      : lightingReport.result.status === "insufficient"
                        ? "像素不足，无法判断"
                        : "未发现明显左右光向冲突"}
                  </strong>
                  <ul>
                    {lightingReport.result.observations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <p>
                    商品左右亮度差：
                    {lightingReport.result.productDelta.toFixed(1)}；背景：
                    {lightingReport.result.backgroundDelta.toFixed(1)}。
                    该检查不判断材质、真实色温或广告是否达标。
                  </p>
                  {pendingInstruction?.origin === "lighting" && (
                    <p>上述指标来自应用前画面；应用试调后请重新检查。</p>
                  )}
                  {lightingReport.result.status !== "insufficient" && (
                    <div className="instruction-actions">
                      <button
                        type="button"
                        onClick={() => previewLightExposure(0.2)}
                        disabled={
                          (selected?.kind === "image"
                            ? (selected.adjustments?.exposure ?? 0)
                            : 0) > 1.8
                        }
                      >
                        预览提亮 0.2 档
                      </button>
                      <button
                        type="button"
                        onClick={() => previewLightExposure(-0.2)}
                        disabled={
                          (selected?.kind === "image"
                            ? (selected.adjustments?.exposure ?? 0)
                            : 0) < -1.8
                        }
                      >
                        预览压暗 0.2 档
                      </button>
                    </div>
                  )}
                  {pendingInstruction?.origin === "lighting" &&
                    pendingInstruction.base === document && (
                      <div className="instruction-preview">
                        <strong>{pendingInstruction.summary.join("；")}</strong>
                        <div className="instruction-actions">
                          <button type="button" onClick={applyInstruction}>
                            应用试调
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingInstruction(null);
                              setMessage("已取消曝光试调，项目未改变。");
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}
            {pendingBackground && (
              <div className="instruction-preview">
                <strong>待应用：独立背景图层</strong>
                <p>检查主体边缘和接触阴影；确认后可一步撤销。</p>
                <div className="instruction-actions">
                  <button type="button" onClick={applyBackground}>
                    应用背景
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cancelBackgroundPreview();
                      setMessage("已取消背景预览，项目未改变。");
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </section>
          <div className="panel-heading">
            <span>属性</span>
            <span>{selected ? "图层" : "画布"}</span>
          </div>
          {selected ? (
            <>
              <h2 className="inspector-title">{selected.name}</h2>
              <div className="inspector-grid">
                {(
                  ["x", "y", "width", "height", "rotation", "opacity"] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      {
                        x: "X",
                        y: "Y",
                        width: "宽度",
                        height: "高度",
                        rotation: "旋转°",
                        opacity: "透明度",
                      }[key]
                    }
                    <input
                      type="number"
                      step={key === "opacity" ? "0.1" : "1"}
                      min={key === "opacity" ? "0" : undefined}
                      max={key === "opacity" ? "1" : undefined}
                      value={Math.round(selected[key] * 100) / 100}
                      onChange={(event) =>
                        setLayerNumber(key, Number(event.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
              {selected.kind === "image" && (
                <div className="crop-inspector">
                  <h3>基础调色</h3>
                  <p>仅调整当前图片图层的显示和导出；保存的原图保持不变。</p>
                  <div className="inspector-grid">
                    {(
                      [
                        ["brightness", "亮度", -100, 100, 1],
                        ["contrast", "对比度", -100, 100, 1],
                        ["saturation", "饱和度", -100, 100, 1],
                        ["exposure", "曝光（档）", -2, 2, 0.1],
                      ] as const
                    ).map(([key, label, min, max, step]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={step}
                          value={
                            selected.adjustments?.[key] ??
                            DEFAULT_IMAGE_ADJUSTMENTS[key]
                          }
                          onChange={(event) =>
                            setAdjustment(key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="crop-presets">
                    <button
                      type="button"
                      onClick={() =>
                        commit({
                          type: "setAdjustments",
                          layerId: selected.id,
                          patch: { ...DEFAULT_IMAGE_ADJUSTMENTS },
                        })
                      }
                    >
                      重置调色
                    </button>
                  </div>
                </div>
              )}
              {selected.kind === "image" && selected.mask && (
                <div className="crop-inspector">
                  <h3>台面对齐与接触阴影</h3>
                  <p>
                    根据蒙版可见底边定位商品。输入背景中台面的画布 Y
                    坐标，阴影作为可撤销的合成效果保存。当前适合直立的不透明商品，旋转或透光主体需人工复核。
                  </p>
                  <div className="inspector-grid">
                    <label>
                      台面 Y
                      <input
                        type="number"
                        min={0}
                        max={document.canvas.height}
                        step={1}
                        value={
                          surfaceYDraft ??
                          Math.round(
                            selectedBase?.y ?? selected.y + selected.height,
                          )
                        }
                        onChange={(event) =>
                          setSurfaceYDraft(Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      当前商品底边 Y
                      <input
                        type="number"
                        value={Math.round(
                          selectedBase?.y ?? selected.y + selected.height,
                        )}
                        readOnly
                      />
                    </label>
                  </div>
                  <div className="crop-presets">
                    <button type="button" onClick={alignProductToSurface}>
                      对齐台面并开启阴影
                    </button>
                    {selected.contactShadow && (
                      <button
                        type="button"
                        onClick={() => setContactShadow(null)}
                      >
                        移除阴影
                      </button>
                    )}
                  </div>
                  {selected.contactShadow && (
                    <div className="inspector-grid">
                      {(
                        [
                          ["opacity", "浓度", 0, 0.8, 0.05],
                          ["widthScale", "宽度倍率", 0.2, 2, 0.05],
                          ["depth", "柔和范围", 2, 200, 1],
                          ["offsetX", "水平偏移", -500, 500, 1],
                          ["offsetY", "垂直偏移", -200, 200, 1],
                        ] as const
                      ).map(([key, label, min, max, step]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            value={selected.contactShadow?.[key] ?? 0}
                            onChange={(event) =>
                              setContactShadow({
                                ...selected.contactShadow!,
                                [key]: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        阴影颜色
                        <input
                          type="color"
                          value={selected.contactShadow.color}
                          onChange={(event) =>
                            setContactShadow({
                              ...selected.contactShadow!,
                              color: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
              {selected.kind === "image" && cropDraft && (
                <div className="crop-inspector">
                  <h3>非破坏裁切</h3>
                  <p>取景区域按原图像素记录，原图不会改写。</p>
                  <div className="crop-presets">
                    <button type="button" onClick={() => cropToAspect(1)}>
                      1:1
                    </button>
                    <button type="button" onClick={() => cropToAspect(4 / 5)}>
                      4:5
                    </button>
                    <button type="button" onClick={() => cropToAspect(16 / 9)}>
                      16:9
                    </button>
                  </div>
                  <div className="inspector-grid">
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key}>
                        {{ x: "左", y: "上", width: "宽", height: "高" }[key]}
                        <input
                          type="number"
                          step="1"
                          min={key === "width" || key === "height" ? 1 : 0}
                          value={cropDraft[key]}
                          onChange={(event) =>
                            setCropDraft({
                              ...cropDraft,
                              [key]: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="crop-presets">
                    <button
                      type="button"
                      onClick={() =>
                        commit({
                          type: "setCrop",
                          layerId: selected.id,
                          crop: cropDraft,
                        })
                      }
                    >
                      应用裁切
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commit({
                          type: "setCrop",
                          layerId: selected.id,
                          crop: null,
                        })
                      }
                    >
                      恢复原图
                    </button>
                  </div>
                </div>
              )}
              {selected.kind === "image" && (
                <div className="crop-inspector">
                  <h3>抠图蒙版</h3>
                  <p>
                    本机自动生成或导入同尺寸 PNG
                    蒙版。白色保留，黑色透明；请人工检查并修正复杂边缘。
                  </p>
                  <button
                    type="button"
                    className="panel-button"
                    onClick={() => void generateMask()}
                    disabled={maskBusy}
                  >
                    {maskBusy ? "正在生成蒙版…" : "自动抠图（本机）"}
                  </button>
                  <label className="upload-button">
                    {selected.mask ? "更换蒙版" : "导入蒙版"}
                    <input
                      type="file"
                      accept="image/png"
                      onChange={(event) => {
                        void importMask(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {selected.mask && (
                    <div className="crop-presets">
                      <button type="button" onClick={frameSelectedMask}>
                        按主体取景
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaskEditorLayerId(selected.id)}
                      >
                        笔刷修正 · {selected.mask.strokes.length} 笔
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          commit({
                            type: "setMask",
                            layerId: selected.id,
                            assetId: null,
                          })
                        }
                      >
                        移除蒙版
                      </button>
                    </div>
                  )}
                </div>
              )}
              {selected.kind === "text" && (
                <div className="text-inspector">
                  <label>
                    文字内容
                    <textarea
                      value={selected.text}
                      onChange={(event) =>
                        commit({
                          type: "editText",
                          layerId: selected.id,
                          text: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    文字颜色
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(event) =>
                        commit({
                          type: "editText",
                          layerId: selected.id,
                          text: selected.text,
                          color: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    字号
                    <input
                      type="number"
                      min="1"
                      value={selected.fontSize}
                      onChange={(event) =>
                        commit({
                          type: "editText",
                          layerId: selected.id,
                          text: selected.text,
                          fontSize: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <div className="layer-actions">
                <button
                  type="button"
                  onClick={() =>
                    commit({
                      type: "moveLayer",
                      layerId: selected.id,
                      direction: "up",
                    })
                  }
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commit({
                      type: "moveLayer",
                      layerId: selected.id,
                      direction: "down",
                    })
                  }
                >
                  下移
                </button>
                <button
                  type="button"
                  onClick={() => {
                    commit({ type: "removeLayer", layerId: selected.id });
                    setSelectedId(null);
                  }}
                >
                  删除
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="inspector-title">画布设置</h2>
              <label className="background-control">
                背景颜色
                <input
                  type="color"
                  value={document.canvas.background}
                  onChange={(event) =>
                    commit({
                      type: "setCanvas",
                      patch: { background: event.target.value },
                    })
                  }
                />
              </label>
              <div className="inspector-empty">
                选中画布中的图片或文字，可调整位置、尺寸、角度与透明度。
              </div>
            </>
          )}
        </aside>
      </div>
      {maskEditorLayer?.kind === "image" && maskEditorLayer.mask && (
        <MaskReview
          layer={maskEditorLayer}
          assets={assets}
          onStroke={(stroke: MaskStroke) =>
            commit({
              type: "paintMask",
              layerId: maskEditorLayer.id,
              stroke,
            })
          }
          onUndo={() => changeHistory("undo")}
          onRedo={() => changeHistory("redo")}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onClose={() => setMaskEditorLayerId(null)}
        />
      )}
    </main>
  );
}
