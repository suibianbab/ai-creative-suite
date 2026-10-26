"use client";

import {
  addCandidateVersion,
  applyStyleBible,
  type MediaAsset,
  type QuantizedTimeline,
  quantizeTimeline,
  reviseWorkingVersion,
  ShotLockedError,
  setLocked,
  type VideoProject,
  validateStyleBible,
  validateVideoProject,
} from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyPlan,
  applyStoryboard,
  describeStoryboardAppend,
  storyboardConfirmLines,
} from "./apply-plan";
import { approvalStatus } from "./frame-approval";
import { FrameApprovalPanel } from "./frame-approval-panel";
import { buildInteractiveHtml, interactiveOptions } from "./interactive-export";
import {
  importPortableVideoProject,
  importVideoProject,
  importVideoProjectChain,
  listVideoProjects,
  openStyleBible,
  openVideoProject,
  saveStyleBible,
  saveVideoProject,
  type VideoProjectSummary,
} from "./local-video-projects";
import { appendMediaAsset } from "./media-assets";
import { MediaPanel } from "./media-panel";
import {
  isStoryboardSentence,
  type PlanResult,
  planFromSentence,
  planStoryboard,
  type StoryboardResult,
  specSummary,
} from "./planner";
import { exportFileName, parseProjectJson } from "./project-io";
import { RecipeCatalog } from "./recipe-catalog";
import {
  createGallerySample,
  GALLERY_SAMPLES,
  type GallerySampleId,
} from "./sample-gallery";
import {
  ScenePreview,
  TimelinePreview,
  type TimelinePreviewItem,
} from "./scene-preview";
import { ShotEditorCard } from "./shot-editor-card";
import { applyShotRecipe } from "./shot-recipes";
import { shotWorkingMediaClip, shotWorkingSpec } from "./shot-specs";
import { importStockForShot } from "./stock-apply";
import { StyleBiblePanel } from "./style-bible-panel";
import { threeSceneFromVersion } from "./three-templates";
// T2 借帧窗口摘要复用预览/出片同一帧数学（不写第二套）。
import {
  previewTransitionWindows,
  type TransitionDraftRow,
  transitionsAfterEdit,
  transitionsDraftFromProject,
} from "./transitions-draft";
import { selectWorkingVersion } from "./version-selection";
import "./video-studio.css";

// 新项目从空镜头开始（validateVideoProject 允许 shots 为空数组）；
// 第一个镜头只能由规划器的确认环写入，这里不造占位 spec。
function createEmptyVideoProject(): VideoProject {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "未命名视频项目",
    brief: { sentence: "", aspectTargets: ["landscape", "portrait"] },
    shots: [],
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
  };
}

type EditorState = {
  document: VideoProject;
  message: string | null;
  busy: boolean;
  sentence: string;
  plan: PlanResult | null;
  storyboard: StoryboardResult | null;
};

// 语义分镜（2026-10-26）：AI 生成入口的瞬态状态。独立于 EditorState——
// 生成中/失败是请求生命周期，不属于文档编辑器；失败绝不静默回退旧占位分镜。
type SemanticPlanState = {
  busy: boolean;
  error: string | null;
  // 确认应用时落进 ContentVersion.provenance（模型/提示词/编译器版本）。
  provenance: {
    provider: string;
    model: string;
    promptVersion: string;
    compilerVersion: string;
  } | null;
  // 路由透明标注：重试后 Σ时长仍偏离句中目标（确认卡如实告知，用户决定）。
  durationDeviation: { targetMs: number; actualMs: number } | null;
  // P1（Codex 二轮复核）：句要求真实素材被 needs-assets 拦下时，界面提供
  // 「改用图解生成」明示授权入口——静默替换不被允许，降级必须用户点头。
  needsAssetsChoice: boolean;
};

export default function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState<GallerySampleId | null>(null);
  const [interactiveShotIndex, setInteractiveShotIndex] = useState<number>(-1);
  const [renderDownloads, setRenderDownloads] = useState<{
    projectId: string;
    signature: string;
    narrated: boolean;
    files: Array<{
      aspect: "landscape" | "portrait";
      url: string;
      digest: string;
    }>;
  } | null>(null);
  // 分镜编辑器：单镜头重做的失败文案按 shotId 存（锁定/句式不合等），
  // 修订/回滚/锁定的结果走 editor.message。
  const [redoErrors, setRedoErrors] = useState<Record<string, string | null>>(
    {},
  );
  // P1 转场（Feature ④ spec R4）：草稿行 = 逐边界 无/淡入淡出 + 时长。变更即时
  // 经 buildTransitionsPatch 校验，合法才落 editor.document（transitions 是可变
  // 编排元数据，保存即持久化；全无 → 删键，A1 字节不变口径）。镜头数或
  // transitions 引用变化（应用分镜/导入/保存回包）时重建草稿（越界项丢弃）。
  const [transitionRows, setTransitionRows] = useState<TransitionDraftRow[]>(
    [],
  );
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [semanticPlan, setSemanticPlan] = useState<SemanticPlanState>({
    busy: false,
    error: null,
    provenance: null,
    durationDeviation: null,
    needsAssetsChoice: false,
  });
  // AI 请求归属守卫（I-1/I-2，2026-10-26 评审）：请求发起时的文档 id +
  // 单调序号。响应返回时若用户已切换项目（返回列表/打开/新建）或已发起
  // 更新的 AI 请求，整个响应连同 semanticPlan 状态一并丢弃——过期闭包
  // 不得覆写当前编辑器（可丢未保存编辑），飞行中状态不得泄漏到无关项目。
  const semanticRequestRef = useRef(0);
  const editorDocumentIdRef = useRef<string | null>(null);
  editorDocumentIdRef.current = editor?.document.id ?? null;
  useEffect(() => {
    setTransitionRows(
      transitionsDraftFromProject(
        editor?.document.shots.length ?? 0,
        editor?.document.transitions,
      ),
    );
    setTransitionError(null);
  }, [editor?.document.shots.length, editor?.document.transitions]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const portableImportInputRef = useRef<HTMLInputElement>(null);
  const styleImportInputRef = useRef<HTMLInputElement>(null);
  // P2.6-T7 U5：最新文档 ref——下载期间允许继续编辑其他镜头，导入完成时
  // 必须以 ref 当前值（而非发起下载时的快照）为基线。
  const documentRef = useRef<VideoProject | null>(null);
  const recipeApplyPendingRef = useRef(false);
  useEffect(() => {
    documentRef.current = editor?.document ?? null;
  }, [editor?.document]);
  useEffect(() => setInteractiveShotIndex(-1), [editor?.document.id]);

  const useGallerySample = async (id: GallerySampleId) => {
    if (galleryBusy) return;
    setGalleryBusy(id);
    setListMessage(null);
    try {
      let productAsset: MediaAsset | undefined;
      if (id === "product") {
        const clip = await fetch("/samples/p4-hat-product.mp4");
        if (!clip.ok) throw new Error("内置商品视频不可用，请刷新页面后重试");
        const form = new FormData();
        form.append(
          "file",
          new File([await clip.blob()], "p4-hat-product.mp4", {
            type: "video/mp4",
          }),
        );
        const response = await fetch("/api/media/ingest", {
          method: "POST",
          body: form,
        });
        const payload = (await response.json()) as {
          asset?: MediaAsset;
          error?: string;
        };
        if (!response.ok || !payload.asset)
          throw new Error(payload.error ?? "商品样片素材导入失败");
        productAsset = payload.asset;
      }
      const { project, bible } = await createGallerySample(id, productAsset);
      if (bible) await saveStyleBible(bible);
      const saved = await saveVideoProject(project);
      await refreshProjects();
      setEditor({
        document: saved,
        message:
          "已从样片库创建独立项目。修改镜头后点「保存」，可直接预览或导出双画幅。",
        busy: false,
        sentence: saved.brief.sentence,
        plan: null,
        storyboard: null,
      });
      setRenderDownloads(null);
    } catch (error) {
      setListMessage(error instanceof Error ? error.message : "创建样片失败");
    } finally {
      setGalleryBusy(null);
    }
  };

  const renderSignature = (project: VideoProject): string =>
    [
      project.styleBibleRef?.digest ?? "none",
      ...project.shots.map((shot) => shot.workingVersionId),
    ].join(":");

  const renderFromWorkbench = async (state: EditorState, narrated = false) => {
    const project = state.document;
    // W2 导出闸门：已启用代表帧确认的项目，任何确认失效即阻断导出，
    // 并给出失效原因；未启用（无确认记录）的项目不受影响。
    const approval = await approvalStatus(project);
    if (!approval.valid) {
      setEditor({
        ...state,
        busy: false,
        message: `代表帧确认已失效，未导出：${approval.reasons.join("；")}`,
      });
      return;
    }
    setEditor({
      ...state,
      busy: true,
      message: narrated
        ? "正在合成旁白、字幕和横竖版 MP4…"
        : "正在生成横竖版 MP4…",
    });
    let saved: VideoProject | null = null;
    try {
      saved = await saveVideoProject(project);
      let styleBible = null;
      if (saved.styleBibleRef) {
        const record = await openStyleBible(saved.styleBibleRef.bibleId);
        if (!record)
          throw new Error("风格规范缺失，请先导入对应的 Style Bible JSON");
        styleBible = record.document;
      }
      const response = await fetch("/api/video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: saved, styleBible, narrated }),
      });
      const payload = (await response.json()) as {
        project?: VideoProject;
        alignedProject?: VideoProject;
        downloads?: Array<{
          aspect: "landscape" | "portrait";
          url: string;
          digest: string;
        }>;
        error?: string;
      };
      if (!response.ok || !payload.project || payload.downloads?.length !== 2)
        throw new Error(payload.error ?? "双画幅出片失败");
      const returned = validateVideoProject(payload.project);
      const imported = await importVideoProjectChain(
        payload.alignedProject
          ? [validateVideoProject(payload.alignedProject), returned]
          : [returned],
      );
      setRenderDownloads({
        projectId: imported.id,
        signature: renderSignature(imported),
        narrated,
        files: payload.downloads,
      });
      setEditor((current) =>
        current?.document.id === project.id
          ? {
              ...current,
              document: imported,
              busy: false,
              message: `${narrated ? "有声" : "无声"}横竖版视频已生成，点击下方链接下载；渲染记录已保存到项目。`,
            }
          : current,
      );
    } catch (error) {
      setEditor((current) =>
        current?.document.id === project.id
          ? {
              ...current,
              document: saved ?? project,
              busy: false,
              message:
                error instanceof Error ? error.message : "双画幅出片失败",
            }
          : current,
      );
    }
  };

  // P1-1：工作台交互页导出——取用户指定镜头的当前工作版本，
  // 客户端组装自包含 HTML（静态预编译运行时 + spec 参数），SHA-256 入账
  // 追加 DeliveryRecord 后保存项目。
  const exportInteractivePage = async (
    state: EditorState,
    shotIndex: number,
  ) => {
    const current = state.document;
    const threeShot = current.shots[shotIndex];
    if (!threeShot) {
      setEditor({ ...state, message: "请先选择要导出的 3D 镜头" });
      return;
    }
    const working = threeShot.contentVersions.find(
      (v) => v.versionId === threeShot.workingVersionId,
    );
    if (working?.sceneSource.type !== "three") {
      setEditor({ ...state, message: "所选镜头不再是 3D 镜头，请重新选择" });
      return;
    }
    const spec = working.sceneSource.spec;
    setEditor({ ...state, busy: true, message: "正在生成交互页…" });
    try {
      const options = interactiveOptions(spec);
      const bundleResponse = await fetch(
        "/samples/interactive-runtime.bundle.js",
      );
      if (!bundleResponse.ok)
        throw new Error("交互运行时不可用（请联系管理员）");
      const bundle = await bundleResponse.text();
      const html = buildInteractiveHtml(bundle, current.title, options);
      if (new TextEncoder().encode(html).byteLength > 8 * 1024 * 1024)
        throw new Error("交互页超过 8 MiB 上限，未导出或入账");
      const blob = new Blob([html], { type: "text/html" });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await blob.arrayBuffer(),
      );
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${current.id}-interactive.html`;
      anchor.click();
      URL.revokeObjectURL(url);
      // DeliveryRecord 追加 + 保存（P1-1 核心）。
      const deliveryRecord = {
        deliveryId: crypto.randomUUID(),
        at: new Date().toISOString(),
        versionIds: [threeShot.workingVersionId],
        renderIds: [],
        frameMap: [],
        kind: "interactive-html" as const,
        outputRef: anchor.download,
        digest: sha256,
      };
      const delivered = {
        ...current,
        deliveries: [...current.deliveries, deliveryRecord],
      };
      const saved = await saveVideoProject(delivered);
      setEditor({
        ...state,
        document: saved,
        busy: false,
        message: `镜头 ${shotIndex + 1} 已导出交互页 ${anchor.download}（SHA-256 ${sha256.slice(0, 12)}…），交付记录已入账`,
      });
      void refreshProjects().catch(() => {});
    } catch (error) {
      setEditor({
        ...state,
        busy: false,
        message: error instanceof Error ? error.message : "交互页导出失败",
      });
    }
  };

  const exportPortableProject = async (state: EditorState) => {
    const current = state.document;
    setEditor({ ...state, busy: true, message: "正在校验并打包项目与素材…" });
    let saved: VideoProject | null = null;
    try {
      saved = await saveVideoProject(current);
      const styleBible = saved.styleBibleRef
        ? (await openStyleBible(saved.styleBibleRef.bibleId))?.document
        : undefined;
      if (saved.styleBibleRef && !styleBible)
        throw new Error("风格规范缺失，请先导入对应的 Style Bible JSON");
      const response = await fetch("/api/video/portable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", project: saved, styleBible }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "项目包导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${saved.id}.acs-video-package.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setEditor((previous) =>
        previous?.document.id === current.id
          ? {
              ...previous,
              document: saved!,
              busy: false,
              message: `已导出 ${anchor.download}（含项目、媒体原件和引用的风格规范）。历史 MP4、旁白音频与代理不在包内。`,
            }
          : previous,
      );
      void refreshProjects().catch((error: unknown) =>
        console.error("项目包已下载，但本地项目列表刷新失败", error),
      );
    } catch (error) {
      setEditor((previous) =>
        previous?.document.id === current.id
          ? {
              ...previous,
              document: saved ?? current,
              busy: false,
              message:
                error instanceof Error ? error.message : "项目包导出失败",
            }
          : previous,
      );
    }
  };

  const applyLinkedStyle = async (
    project: VideoProject,
  ): Promise<VideoProject> => {
    const ref = project.styleBibleRef;
    if (!ref) return project;
    const record = await openStyleBible(ref.bibleId);
    if (!record)
      throw new Error("风格规范本地记录缺失，请先导入 Style Bible JSON");
    return applyStyleBible(project, record.document, ref.versionId);
  };

  // U5 下载并应用：先 POST 取资产并解析 {asset}/{error}，再读最新文档 ref，
  // 最后经 stock-apply 在「账本 + 镜头修订」上一次保存。失败函数式复位 busy
  // 并 rethrow，由面板行内展示。
  const handleStockImport = async (
    shotId: string,
    pageTitle: string,
    derivativeUrl: string,
  ): Promise<string> => {
    setEditor((previous) =>
      previous ? { ...previous, busy: true, message: null } : previous,
    );
    try {
      let response: Response;
      try {
        response = await fetch("/api/media/stock/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pageTitle, derivativeUrl }),
        });
      } catch {
        // 断网/连接失败：浏览器原文是英文（TypeError: Failed to fetch），
        // 按 spec §3 全中文口径转成与检索同款可重试文案。
        throw new Error("下载失败：网络中断（可重试或改用本地上传）");
      }
      const parsed = (await response.json().catch(() => null)) as {
        asset?: MediaAsset;
        error?: string;
      } | null;
      const asset = parsed?.asset;
      if (!response.ok || !asset) {
        // 路由的 {error} 是逐字中文，优先原样透出；响应体不可解析或成功却
        // 缺 asset 时退回中文兜底，绝不把英文异常带到卡内。
        throw new Error(
          parsed?.error ??
            (response.ok
              ? "下载失败：响应无法解析（可重试或改用本地上传）"
              : `下载失败（HTTP ${response.status}）：响应无法解析（可重试或改用本地上传）`),
        );
      }
      // 网络等待之后再取最新文档：覆盖下载期间对其他镜头的编辑。
      const latest = documentRef.current;
      if (!latest) {
        throw new Error("素材已入库；项目已关闭，请重新打开后在素材面板中选择");
      }
      const { document: saved, message } = await importStockForShot(
        latest,
        shotId,
        pageTitle,
        derivativeUrl,
        {
          requestImport: async () => asset,
          save: saveVideoProject,
          newVersionId: () => crypto.randomUUID(),
        },
      );
      setEditor((previous) =>
        previous
          ? { ...previous, document: saved, message, busy: false }
          : previous,
      );
      return message;
    } catch (error) {
      setEditor((previous) =>
        previous ? { ...previous, busy: false } : previous,
      );
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  const refreshProjects = useCallback(async () => {
    setProjects(await listVideoProjects());
  }, []);

  useEffect(() => {
    refreshProjects().catch((error: unknown) =>
      console.error("视频项目列表读取失败", error),
    );
  }, [refreshProjects]);

  // 客户端就绪标记：useEffect 只在水合完成后执行。SSR 的 HTML 里按钮已经
  // 可见 ≠ React 已接管点击（外部复核实测：domcontentloaded 后立即点击会被
  // 丢）。e2e 等 html[data-studio-ready] 出现再交互，取代对网络时序的猜测。
  useEffect(() => {
    document.documentElement.dataset.studioReady = "1";
    return () => {
      delete document.documentElement.dataset.studioReady;
    };
  }, []);

  if (editor) {
    const { document, message, busy, sentence, plan, storyboard } = editor;

    // 语义分镜请求（AI 按钮 / needs-assets 授权按钮共用）。allowSubstitute：
    // 用户明示接受「图解替代真实素材」后才为 true（P1，Codex 二轮复核）。
    // 守卫口径见 semanticRequestRef/editorDocumentIdRef 声明处注释。
    const runSemanticPlan = async (allowSubstitute: boolean) => {
      const trimmed = sentence.trim();
      const requestId = ++semanticRequestRef.current;
      const documentId = document.id;
      setSemanticPlan({
        busy: true,
        error: null,
        provenance: null,
        durationDeviation: null,
        needsAssetsChoice: false,
      });
      // P1-1（Codex 复核 2026-10-26）：新请求开始即撤销旧候选——请求期间/
      // 失败后旧确认卡不可再应用，杜绝「旧 AI 结果按 planner-rules 记账」。
      setEditor((current) =>
        !current || current.document.id !== documentId
          ? current
          : { ...current, storyboard: null, plan: null, message: null },
      );
      const stale = () =>
        semanticRequestRef.current !== requestId ||
        editorDocumentIdRef.current !== documentId;
      const finish = (state: SemanticPlanState) => {
        if (stale()) return;
        setSemanticPlan(state);
      };
      try {
        const response = await fetch("/api/video/semantic-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sentence: trimmed,
            ...(allowSubstitute
              ? { allowDiagramSubstitute: true }
              : {}),
          }),
        });
        const data = (await response.json()) as {
          storyboard?: StoryboardResult;
          provenance?: SemanticPlanState["provenance"];
          error?: string;
          errors?: string[];
          kind?: string;
          durationDeviation?: { targetMs: number; actualMs: number };
        };
        const storyboardResult = data.storyboard;
        if (!response.ok || !storyboardResult?.ok) {
          finish({
            busy: false,
            // 逐镜校验/编译失败带明细（I-4）；needs-assets 提供授权入口。
            error: [
              data.error ??
                "AI 分镜生成失败，请稍后重试或改用固定句式",
              ...(data.errors ?? []),
            ].join("；"),
            provenance: null,
            durationDeviation: null,
            needsAssetsChoice: data.kind === "needs-assets",
          });
          return;
        }
        if (stale()) return;
        setSemanticPlan({
          busy: false,
          error: null,
          provenance: data.provenance ?? null,
          durationDeviation: data.durationDeviation ?? null,
          needsAssetsChoice: false,
        });
        setEditor((current) =>
          !current || current.document.id !== documentId
            ? current
            : {
                ...current,
                storyboard: storyboardResult,
                plan: null,
                message: null,
              },
        );
      } catch {
        finish({
          busy: false,
          error: "AI 分镜请求失败（网络或服务错误），未修改项目",
          provenance: null,
          durationDeviation: null,
          needsAssetsChoice: false,
        });
      }
    };
    const interactiveShotChoices = document.shots.flatMap((shot, index) => {
      const working = shot.contentVersions.find(
        (version) => version.versionId === shot.workingVersionId,
      );
      return working?.sceneSource.type === "three"
        ? [{ index, label: `镜头 ${index + 1}：${shot.shotId.slice(0, 8)}` }]
        : [];
    });
    const chosenInteractiveShot =
      interactiveShotChoices.length === 1
        ? interactiveShotChoices[0]!.index
        : interactiveShotChoices.some(
              (choice) => choice.index === interactiveShotIndex,
            )
          ? interactiveShotIndex
          : -1;
    // 镜头时间线（量化帧图 @24fps）：镜头卡 + 时间条 + 整片预览共用。
    // spec 解析走 shotWorkingSpec：unknown → validateSceneSpec，非法（导入件来自
    // 更新版本/手改）降级 null 走「不可预览」提示，不在渲染期抛错炸整页。
    const shotSpecs = document.shots.map((shot) => shotWorkingSpec(shot));
    // P2.5-T3 P1：装配从工作版本出发——spec → spec 项；media-clip 且资产在
    // 账本 → media 项；media-clip 但资产不在账本 → missing 占位（不炸页）。
    const shotMediaClips = document.shots.map((shot) =>
      shotWorkingMediaClip(shot),
    );
    // P3-B（Ruling 11/2）：3D 工作版本解析，与 shotSpecs/shotMediaClips 并列；
    // 3D 镜头在预览里取同一烘焙 harness 的代表帧。
    const shotThree = document.shots.map((shot) =>
      threeSceneFromVersion(
        shot.contentVersions.find(
          (version) => version.versionId === shot.workingVersionId,
        ),
      ),
    );
    const mediaAssets = document.mediaAssets ?? [];
    const assetsById = new Map(
      mediaAssets.map((asset) => [asset.assetId, asset]),
    );
    const workingMeta = document.shots.map((shot) => {
      const working = shot.contentVersions.find(
        (version) => version.versionId === shot.workingVersionId,
      );
      return working
        ? {
            durationMs: working.durationMs,
            narrationText: working.narrationText,
          }
        : { durationMs: 0, narrationText: undefined };
    });
    const durations = workingMeta.map((meta) => meta.durationMs);
    let pieceTimeline: QuantizedTimeline | null = null;
    let pieceItems: TimelinePreviewItem[] | null = null;
    const perShot: (TimelinePreviewItem | null)[] = document.shots.map(
      (shot, index) => {
        const spec = shotSpecs[index] as SceneSpec | null;
        const meta = workingMeta[index]!;
        const media = shotMediaClips[index];
        const three = shotThree[index];
        if (spec) {
          return {
            spec,
            startFrame: 0,
            frames: 0,
            narrationText: meta.narrationText,
          };
        }
        if (media) {
          return assetsById.has(media.mediaAssetId)
            ? {
                kind: "media",
                assetId: media.mediaAssetId,
                inMs: media.inMs,
                outMs: media.outMs,
                fit: media.fit,
                focalX: media.focalX,
                startFrame: 0,
                frames: 0,
                narrationText: meta.narrationText,
              }
            : {
                kind: "missing",
                reason: `素材缺失：${media.mediaAssetId.slice(0, 8)} 不在账本`,
                startFrame: 0,
                frames: 0,
              };
        }
        if (three) {
          return {
            kind: "three",
            spec: three,
            startFrame: 0,
            frames: 0,
          };
        }
        return null; // editor-binding 等未来成员：整片仍降级（X2）
      },
    );
    if (
      document.shots.length > 0 &&
      durations.every((duration) => duration > 0) &&
      perShot.every((item) => item !== null)
    ) {
      // 存量文档若已含零帧镜头（修复前的产物、外部导入数据），
      // quantizeTimeline 会抛 ZeroFrameShotError；渲染期不能炸掉整页
      // （会白屏并丢失未保存草稿），整片降级为不可预览：pieceTimeline /
      // pieceItems 保持 null，走既有「不可预览」路径，不新增 UI。
      try {
        pieceTimeline = quantizeTimeline(durations, 24);
        pieceItems = perShot.map((item, index) => ({
          ...item!,
          startFrame: pieceTimeline!.shots[index]!.startFrame,
          frames: pieceTimeline!.shots[index]!.frames,
        }));
      } catch {
        pieceTimeline = null;
        pieceItems = null;
      }
    }
    // 转场草稿落文档：transitionsAfterEdit 决定字段值——非法编辑返回 previous
    // 同引用（文档保持上一合法态，草稿重建 effect 不触发，行内提示指路）；
    // 合法 patch 落键；全无 → 删 transitions 键（老项目字节不变口径）。
    const applyTransitionRows = (rows: TransitionDraftRow[]) => {
      setTransitionRows(rows);
      const { transitions, error } = transitionsAfterEdit(
        rows,
        document.transitions,
      );
      setTransitionError(error);
      const next = { ...document };
      if (transitions) next.transitions = transitions;
      else delete next.transitions;
      setEditor({ ...editor, document: next });
    };
    // P2.5-T3 U4：上传素材 → POST /api/media/ingest → 账本追加 + 保存
    //（乐观并发沿既有保存路径）。失败（含 503 生产门/415/413/422）行内中文
    // 错误 + 文档零改动；两段失败都向面板抛原始错误供行内展示。
    const uploadMedia = async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      setEditor({ ...editor, busy: true, message: null });
      let asset: MediaAsset | undefined;
      try {
        const response = await fetch("/api/media/ingest", {
          method: "POST",
          body: form,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          asset?: MediaAsset;
          error?: string;
        };
        if (!response.ok || !payload.asset) {
          throw new Error(
            payload.error ?? `上传失败（HTTP ${response.status}）`,
          );
        }
        asset = payload.asset;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setEditor({ ...editor, busy: false, message: `上传失败：${reason}` });
        throw error instanceof Error ? error : new Error(reason);
      }
      try {
        const saved = await saveVideoProject({
          ...document,
          mediaAssets: appendMediaAsset(document.mediaAssets, asset),
        });
        setEditor({
          ...editor,
          document: saved,
          message: "素材已上传并保存",
          busy: false,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "保存失败";
        setEditor({ ...editor, busy: false, message: reason });
        throw error instanceof Error ? error : new Error(reason);
      }
    };
    return (
      <main className="studio-shell">
        <header className="studio-topbar">
          <Link className="studio-brand" href="/">
            AI Creative Suite
          </Link>
          <span className="studio-divider" />
          <span className="studio-title">Video Studio</span>
          <button
            type="button"
            className="project-action"
            disabled={busy}
            onClick={() => {
              setEditor(null);
              // AI 状态随编辑器生命周期清理（I-2）：错误/provenance/飞行中
              // busy 不得带到列表或其他项目。
              semanticRequestRef.current += 1;
              setSemanticPlan({
                busy: false,
                error: null,
                provenance: null,
                durationDeviation: null,
                    needsAssetsChoice: false,
              });
              refreshProjects().catch(() => {});
            }}
          >
            返回列表
          </button>
        </header>
        <fieldset
          className="editor-pane"
          aria-busy={busy}
          inert={busy}
          disabled={busy}
        >
          <label className="editor-field">
            项目标题
            <input
              className="editor-input"
              value={document.title}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  document: { ...document, title: event.target.value },
                  message: null,
                })
              }
            />
          </label>

          <StyleBiblePanel
            project={document}
            onApply={(next, note) =>
              setEditor({ ...editor, document: next, message: note })
            }
          />

          {/* W2 风格代表帧确认：链接风格的项目导出前先确认双画幅代表帧，
              内容或风格变化后确认失效并阻断导出（见 renderFromWorkbench）。 */}
          {document.styleBibleRef ? (
            <FrameApprovalPanel
              project={document}
              onApply={(next, note) =>
                setEditor({ ...editor, document: next, message: note })
              }
            />
          ) : null}

          {/* P2.5-T3 U4/X1：素材面板——上传入账本 + 逐条列出（含同内容提示）。
              挂在标题下方、规划器上方：先有素材，才有媒体镜头可编辑。 */}
          <MediaPanel assets={mediaAssets} busy={busy} onUpload={uploadMedia} />

          {/* W1 镜头配方目录：与规划器并列的第二条加镜路径——按用途选卡、
              换字/换素材后追加为普通内容版本（内存追加，点「保存」落库）。 */}
          <RecipeCatalog
            busy={busy}
            mediaAssets={mediaAssets}
            onApply={(recipeId, inputs) => {
              if (recipeApplyPendingRef.current)
                return "请等待当前配方完成风格处理";
              const current =
                documentRef.current?.id === document.id
                  ? documentRef.current
                  : document;
              const result = applyShotRecipe(
                current,
                recipeId,
                inputs,
                mediaAssets,
              );
              if ("error" in result) return result.error;
              if (!current.styleBibleRef) {
                // 同一事件循环内连续点配方时，下一次从最新内存文档追加。
                documentRef.current = result.document;
                setEditor((previous) =>
                  previous?.document.id === current.id
                    ? {
                        ...previous,
                        document: result.document,
                        message: result.notice,
                      }
                    : previous,
                );
                return null;
              }
              // 链接 Style Bible 的项目必须先完成风格处理；失败时保留原文档，
              // 不能以“已应用”提示发布未通过风格校验的镜头。
              recipeApplyPendingRef.current = true;
              setEditor((previous) =>
                previous?.document.id === current.id
                  ? {
                      ...previous,
                      busy: true,
                      message: "正在应用配方与风格规范…",
                    }
                  : previous,
              );
              void applyLinkedStyle(result.document)
                .then((styled) => {
                  documentRef.current = styled;
                  setEditor((previous) =>
                    previous?.document.id === current.id
                      ? {
                          ...previous,
                          document: styled,
                          busy: false,
                          message: result.notice,
                        }
                      : previous,
                  );
                })
                .catch((error: unknown) =>
                  setEditor((previous) =>
                    previous?.document.id === current.id
                      ? {
                          ...previous,
                          busy: false,
                          message: `配方未应用：${error instanceof Error ? error.message : "风格处理失败"}`,
                        }
                      : previous,
                  ),
                )
                .finally(() => {
                  recipeApplyPendingRef.current = false;
                });
              return null;
            }}
          />

          <div className="planner-field">
            <label className="planner-label" htmlFor="planner-sentence">
              一句话需求
            </label>
            <div className="planner-row">
              <input
                id="planner-sentence"
                className="planner-input"
                value={sentence}
                placeholder="做一个12秒的文字动画，标题是云制作，或：做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头"
                onChange={(event) =>
                  setEditor({ ...editor, sentence: event.target.value })
                }
              />
              <button
                type="button"
                className="planner-run"
                // AI 生成期间禁用旧规划（两条路径并发会互相覆盖），同时旧规划
                // 点击即重置 semanticPlan——规则产物不得残留 AI 徽章/provenance
                // （I-2，2026-10-26 评审：错标会永久写进内容版本账本）。
                disabled={
                  semanticPlan.busy || busy || sentence.trim().length === 0
                }
                onClick={() => {
                  const trimmed = sentence.trim();
                  setSemanticPlan({
                    busy: false,
                    error: null,
                    provenance: null,
                    durationDeviation: null,
                    needsAssetsChoice: false,
                  });
                  // 分镜句式 → 多镜头规划器；其余 → P0 单镜头规划器
                  if (isStoryboardSentence(trimmed)) {
                    setEditor({
                      ...editor,
                      storyboard: planStoryboard(trimmed),
                      plan: null,
                      message: null,
                    });
                  } else {
                    setEditor({
                      ...editor,
                      plan: planFromSentence(trimmed),
                      storyboard: null,
                      message: null,
                    });
                  }
                }}
              >
                规划
              </button>
              <button
                type="button"
                className="planner-run planner-ai"
                // AI 分镜与固定句式规划是两条独立入口：AI 失败只报错，
                // 不静默回退旧占位分镜（交接单 2026-10-26 明确纪律）。
                disabled={
                  semanticPlan.busy ||
                  busy ||
                  sentence.trim().length === 0
                }
                onClick={() => runSemanticPlan(false)}
              >
                {semanticPlan.busy ? "正在生成分镜…" : "AI 生成分镜"}
              </button>
            </div>
            {semanticPlan.error ? (
              <div className="planner-feedback">
                <p className="planner-reason">{semanticPlan.error}</p>
                {semanticPlan.needsAssetsChoice ? (
                  <button
                    type="button"
                    className="planner-run planner-ai"
                    // needs-assets 的明示授权入口：用户点头后才以图解替代
                    // 真实素材需求（P1，Codex 二轮复核——静默替换不被允许）。
                    disabled={semanticPlan.busy}
                    onClick={() => runSemanticPlan(true)}
                  >
                    改用图解生成
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {plan && !plan.ok ? (
            <div className="planner-feedback">
              <p className="planner-reason">{plan.reason}</p>
              <p className="planner-guidance">{plan.guidance}</p>
            </div>
          ) : null}

          {storyboard && !storyboard.ok ? (
            <div className="planner-feedback">
              <p className="planner-reason">{storyboard.reason}</p>
              <p className="planner-guidance">{storyboard.guidance}</p>
            </div>
          ) : null}

          {storyboard && storyboard.ok ? (
            <div className="plan-card storyboard-card">
              <p className="plan-summary">
                分镜预告：{storyboard.title} · {storyboard.shots.length} 个镜头
                · {storyboard.totalMs / 1000}s
              </p>
              {semanticPlan.provenance ? (
                <p className="plan-summary">
                  AI 分镜：{semanticPlan.provenance.model} · 提示词 v
                  {semanticPlan.provenance.promptVersion} · 编译器 v
                  {semanticPlan.provenance.compilerVersion}
                </p>
              ) : null}
              {semanticPlan.durationDeviation ? (
                <p className="planner-reason">
                  注意：总时长 {semanticPlan.durationDeviation.actualMs / 1000}s
                  偏离了要求的约 {semanticPlan.durationDeviation.targetMs / 1000}s
                  （重试后仍未对齐）。可放弃后换个说法重新生成。
                </p>
              ) : null}
              <ol className="plan-shot-list">
                {storyboardConfirmLines(storyboard).map((line) => (
                  <li key={line.index} className="plan-shot-item">
                    <span className="plan-shot-label">
                      {line.index}. {line.label} · {line.durationSeconds}s
                    </span>
                    <span className="plan-shot-hint">{line.renderHint}</span>
                    <span className="plan-shot-narration">
                      旁白：{line.narrationText}
                    </span>
                  </li>
                ))}
              </ol>
              {/* 追加语义（2026-10-18 复核整改）：应用前把算术说清——
                  已有镜头的项目会变长，不许让需求句暗示「整片就是这个时长」 */}
              <p className="plan-append-summary">
                {describeStoryboardAppend(document, storyboard)}
              </p>
              <div className="plan-actions">
                <button
                  type="button"
                  className="plan-apply"
                  onClick={async () => {
                    // P1：分镜应用 = 在当前项目上只追加 N 个镜头；
                    // 语义分镜把模型/提示词/编译器版本落进 provenance。
                    try {
                      const applied = applyStoryboard(
                        document,
                        storyboard,
                        {
                          shot: () => crypto.randomUUID(),
                          version: () => crypto.randomUUID(),
                        },
                        semanticPlan.provenance
                          ? {
                              engineId: "planner-semantic",
                              engineVersion: `${semanticPlan.provenance.model}/prompt${semanticPlan.provenance.promptVersion}/compiler${semanticPlan.provenance.compilerVersion}`,
                            }
                          : undefined,
                      );
                      const styled = await applyLinkedStyle(applied.document);
                      setEditor({
                        document: styled,
                        message: applied.notice,
                        busy: false,
                        sentence,
                        plan: null,
                        storyboard: null,
                      });
                      setSemanticPlan({
                        busy: false,
                        error: null,
                        provenance: null,
                        durationDeviation: null,
                    needsAssetsChoice: false,
                      });
                    } catch (error) {
                      setEditor({
                        ...editor,
                        message:
                          error instanceof Error
                            ? error.message
                            : "分镜应用失败",
                      });
                    }
                  }}
                >
                  确认应用（追加 {storyboard.shots.length} 个镜头）
                </button>
                <button
                  type="button"
                  className="plan-discard"
                  onClick={() => {
                    setEditor({ ...editor, storyboard: null, message: null });
                    setSemanticPlan({
                      busy: false,
                      error: null,
                      provenance: null,
                      durationDeviation: null,
                    needsAssetsChoice: false,
                    });
                  }}
                >
                  放弃
                </button>
              </div>
            </div>
          ) : null}

          {plan && plan.ok ? (
            <div className="plan-card">
              <p className="plan-summary">{specSummary(plan.spec)}</p>
              <p className="plan-render-hint">{plan.renderHint}</p>
              <ScenePreview spec={plan.spec} />
              <div className="plan-actions">
                <button
                  type="button"
                  className="plan-apply"
                  onClick={async () => {
                    // P2-B：空项目 = 首次规划落当前文档；已有镜头 = 明示另存为新项目
                    try {
                      const applied = applyPlan(
                        document,
                        sentence.trim(),
                        plan,
                        {
                          project: crypto.randomUUID(),
                          shot: crypto.randomUUID(),
                          version: crypto.randomUUID(),
                        },
                      );
                      const styled = await applyLinkedStyle(applied.document);
                      setEditor({
                        document: styled,
                        message: applied.notice,
                        busy: false,
                        sentence,
                        plan: null,
                        storyboard: null,
                      });
                    } catch (error) {
                      setEditor({
                        ...editor,
                        message:
                          error instanceof Error
                            ? error.message
                            : "镜头应用失败",
                      });
                    }
                  }}
                >
                  {document.shots.length > 0
                    ? "确认应用（另存为新项目）"
                    : "确认应用"}
                </button>
                <button
                  type="button"
                  className="plan-discard"
                  onClick={() => setEditor({ ...editor, plan: null })}
                >
                  放弃
                </button>
              </div>
            </div>
          ) : null}

          <p className="editor-hint">
            规划器只认固定句式（单镜头 / STEM
            分镜），解析失败会把语法原样告诉你；分镜应用会在当前项目上追加镜头。
          </p>

          {document.shots.length > 0 ? (
            <section className="editor-shots">
              {pieceTimeline ? (
                <>
                  <h3>
                    镜头时间线（{document.shots.length} 镜头 ·{" "}
                    {pieceTimeline.totalFrames} 帧 @24fps ≈{" "}
                    {(pieceTimeline.totalFrames / 24).toFixed(1)}s）
                  </h3>
                  <div className="timeline-bar">
                    {pieceTimeline.shots.map((span) => (
                      <span
                        key={span.shotIndex}
                        className="timeline-span"
                        style={{
                          width: `${(span.frames / pieceTimeline!.totalFrames) * 100}%`,
                        }}
                      >
                        {span.shotIndex + 1}号 {span.frames}帧
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="editor-hint">
                  整片时间线暂不可预览（镜头时长无法成片，或存在不可预览的场景源）；
                  仍可在下方逐个镜头查看，可编辑的镜头保留修订入口。
                </p>
              )}
              <ol className="shot-list">
                {document.shots.map((shot, index) => (
                  <ShotEditorCard
                    key={shot.shotId}
                    shot={shot}
                    index={index}
                    frames={pieceTimeline?.shots[index]?.frames ?? null}
                    project={document}
                    editable={
                      shotSpecs[index] !== null ||
                      shotMediaClips[index] !== null ||
                      shotThree[index] !== null
                    }
                    mediaAssets={mediaAssets}
                    redoError={redoErrors[shot.shotId] ?? null}
                    onImportStock={(pageTitle, derivativeUrl) =>
                      handleStockImport(shot.shotId, pageTitle, derivativeUrl)
                    }
                    onRevise={async (patch) => {
                      try {
                        const revised = reviseWorkingVersion(
                          document,
                          shot.shotId,
                          patch,
                          crypto.randomUUID(),
                        );
                        const next = await applyLinkedStyle(revised);
                        setEditor({
                          ...editor,
                          document: next,
                          // 修订总是旁白+画面一体落新版本（buildRevisePatch 全量产
                          // spec），文案不区分类型，避免误标。
                          message: `镜头 ${index + 1} 已修订`,
                        });
                      } catch (error) {
                        setEditor({
                          ...editor,
                          message:
                            error instanceof Error ? error.message : "修订失败",
                        });
                      }
                    }}
                    onRedo={async (directive) => {
                      // 单镜头重做：规划器只认固定句式；锁定镜头按 ADR 0003 §1.3
                      // 拒机器改写。重做只换画面，旁白从当前 working 版本继承。
                      const plan = planFromSentence(directive);
                      if (!plan.ok) {
                        setRedoErrors({
                          ...redoErrors,
                          [shot.shotId]: `${plan.reason}${plan.guidance}`,
                        });
                        return;
                      }
                      const working = shot.contentVersions.find(
                        (version) =>
                          version.versionId === shot.workingVersionId,
                      );
                      if (!working) {
                        setRedoErrors({
                          ...redoErrors,
                          [shot.shotId]: "镜头没有工作版本，无法重做",
                        });
                        return;
                      }
                      const versionId = crypto.randomUUID();
                      try {
                        const candidate = addCandidateVersion(
                          document,
                          shot.shotId,
                          {
                            versionId,
                            createdAt: new Date().toISOString(),
                            durationMs: plan.spec.durationMs,
                            description: `镜头重做：${plan.title}`,
                            narrationText: working.narrationText,
                            sceneSource: { type: "spec", spec: plan.spec },
                            provenance: {
                              engineId: "planner-rules",
                              engineVersion: "1",
                              parentVersionId: working.versionId,
                            },
                          },
                        );
                        const next = await applyLinkedStyle(candidate);
                        setRedoErrors({ ...redoErrors, [shot.shotId]: null });
                        setEditor({
                          ...editor,
                          document: next,
                          message: `镜头 ${index + 1} 已重做（${plan.title}）`,
                        });
                      } catch (error) {
                        setRedoErrors({
                          ...redoErrors,
                          [shot.shotId]:
                            error instanceof ShotLockedError
                              ? "镜头已锁定，先解锁再重做"
                              : error instanceof Error
                                ? error.message
                                : "重做失败",
                        });
                      }
                    }}
                    onRollback={async (versionId) => {
                      try {
                        const selected = selectWorkingVersion(
                          document,
                          index,
                          versionId,
                        );
                        const next = await applyLinkedStyle(selected);
                        setEditor({
                          ...editor,
                          document: next,
                          message: `镜头 ${index + 1} 已回滚到所选版本${document.styleBibleRef ? "，并应用当前风格" : ""}`,
                        });
                        return null;
                      } catch (error) {
                        const message =
                          error instanceof Error ? error.message : "回滚失败";
                        setEditor({
                          ...editor,
                          message,
                        });
                        return message;
                      }
                    }}
                    onToggleLock={(locked) => {
                      try {
                        const next = setLocked(document, shot.shotId, locked);
                        setEditor({
                          ...editor,
                          document: next,
                          message: `镜头 ${index + 1} 已${locked ? "锁定" : "解锁"}`,
                        });
                      } catch (error) {
                        setEditor({
                          ...editor,
                          message:
                            error instanceof Error
                              ? error.message
                              : "锁定操作失败",
                        });
                      }
                    }}
                  />
                ))}
              </ol>
              {document.shots.length > 1 ? (
                <div className="transitions-editor">
                  <h4>转场</h4>
                  {transitionRows.map((row) => {
                    // T2 借帧窗口摘要：与预览/出片同 helper（previewTransitionWindows
                    // → resolveTransitionWindows），不写第二套帧数学。fade 行显示
                    // halfOut/halfIn 与全局窗口帧段；装配失败行沿用 error 提示。
                    let borrowSummary: string | null = null;
                    if (row.kind === "fade" && pieceTimeline) {
                      const preview = previewTransitionWindows(
                        document.transitions,
                        pieceTimeline.shots,
                        24,
                      );
                      const window = preview.windows.find(
                        (candidate) => candidate.boundary === row.boundary,
                      );
                      if (window)
                        borrowSummary = `借帧 左尾 ${window.halfOut} + 右头 ${window.halfIn}＝${window.frames} 帧（全局第 ${window.startFrame + 1}–${window.startFrame + window.frames} 帧叠黑；${row.durationMs}ms）`;
                    }
                    return (
                      <div
                        key={row.boundary}
                        className="transition-row"
                        data-boundary={row.boundary}
                      >
                        <span className="transition-boundary">
                          镜头 {row.boundary + 1} → {row.boundary + 2}
                        </span>
                        <select
                          className="transition-kind"
                          value={row.kind}
                          onChange={(event) => {
                            const kind =
                              event.target.value === "fade" ? "fade" : "none";
                            applyTransitionRows(
                              transitionRows.map((candidate) =>
                                candidate.boundary === row.boundary
                                  ? { ...candidate, kind }
                                  : candidate,
                              ),
                            );
                          }}
                        >
                          <option value="none">无</option>
                          <option value="fade">淡入淡出</option>
                        </select>
                        <label className="transition-duration-label">
                          时长
                          <input
                            className="transition-duration"
                            type="number"
                            min={100}
                            max={2000}
                            step={100}
                            value={row.durationMs}
                            onChange={(event) => {
                              applyTransitionRows(
                                transitionRows.map((candidate) =>
                                  candidate.boundary === row.boundary
                                    ? {
                                        ...candidate,
                                        durationMs: Number(event.target.value),
                                      }
                                    : candidate,
                                ),
                              );
                            }}
                          />
                          ms
                        </label>
                        {borrowSummary ? (
                          <p className="transition-borrow-summary">
                            {borrowSummary}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {transitionError ? (
                    <p className="transition-error">{transitionError}</p>
                  ) : null}
                  <p className="editor-hint">
                    转场为镜头间黑色淡入淡出（dip-to-black）：向相邻镜头借帧叠
                    黑幕，镜头时长不变；预览与出片同一帧数学。
                  </p>
                </div>
              ) : null}
              {pieceTimeline && pieceItems ? (
                <TimelinePreview
                  items={pieceItems}
                  timeline={pieceTimeline}
                  transitions={document.transitions}
                  assets={mediaAssets}
                />
              ) : null}
            </section>
          ) : null}
          <button
            type="button"
            className="editor-save"
            disabled={busy || document.title.length === 0}
            onClick={async () => {
              setEditor({ ...editor, busy: true, message: null });
              try {
                const saved = await saveVideoProject(document);
                setEditor({
                  document: saved,
                  message: `已保存（v${saved.savedVersion}）`,
                  busy: false,
                  sentence,
                  plan,
                  storyboard,
                });
              } catch (error) {
                setEditor({
                  ...editor,
                  busy: false,
                  message: error instanceof Error ? error.message : "保存失败",
                });
              }
            }}
          >
            保存
          </button>
          <button
            type="button"
            className="editor-render"
            disabled={busy || document.shots.length === 0}
            onClick={() => void renderFromWorkbench(editor, false)}
          >
            {busy ? "处理中…" : "生成无声横竖版 MP4"}
          </button>
          <button
            type="button"
            className="editor-render-narrated"
            disabled={
              busy ||
              !document.shots.some((shot) =>
                shot.contentVersions.some(
                  (version) =>
                    version.versionId === shot.workingVersionId &&
                    Boolean(version.narrationText?.trim()),
                ),
              )
            }
            onClick={() => void renderFromWorkbench(editor, true)}
          >
            {busy ? "处理中…" : "生成有声横竖版 MP4（含字幕）"}
          </button>
          {renderDownloads?.projectId === document.id &&
          renderDownloads.signature === renderSignature(document) ? (
            <div className="editor-downloads">
              {renderDownloads.files.map((file) => (
                <a
                  key={file.aspect}
                  href={file.url}
                  download={`${file.aspect}.mp4`}
                >
                  下载{renderDownloads.narrated ? "有声" : "无声"}
                  {file.aspect === "landscape" ? "横版" : "竖版"} MP4
                </a>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="editor-export"
            disabled={busy}
            onClick={() => {
              // P1-A 去程：导出当前文档（含渲染记录）给 CLI 渲染。
              // 注意此作用域里 document 是 VideoProject，DOM 走 window.document。
              const blob = new Blob([JSON.stringify(document, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const anchor = window.document.createElement("a");
              anchor.href = url;
              anchor.download = exportFileName(document);
              anchor.click();
              URL.revokeObjectURL(url);
              setEditor({
                ...editor,
                message: `已导出 ${anchor.download}。${document.styleBibleRef ? "请同时点上方「导出风格规范 JSON」，CLI 出片/导出须传 --style-bible <风格规范.json>；" : ""}CLI 出片：node scripts/video/render-scene.mjs --project <导出件> --out <目录>；整片 GIF：node scripts/video/export-gif.mjs --project <导出件> --aspect landscape；单镜头 SVG：node scripts/video/export-shot-svg.mjs --project <导出件> --shot 1，完成后回列表页「导入项目 JSON」`,
              });
            }}
          >
            导出项目 JSON
          </button>
          <button
            type="button"
            className="editor-export-portable"
            disabled={busy}
            onClick={() => void exportPortableProject(editor)}
          >
            导出可移植项目包（含素材）
          </button>
          {interactiveShotChoices.length > 0 ? (
            <>
              <label className="interactive-shot-choice">
                交互页镜头
                <select
                  className="interactive-shot-select"
                  value={chosenInteractiveShot}
                  onChange={(event) =>
                    setInteractiveShotIndex(Number(event.target.value))
                  }
                >
                  {interactiveShotChoices.length > 1 ? (
                    <option value={-1}>请选择 3D 镜头</option>
                  ) : null}
                  {interactiveShotChoices.map((choice) => (
                    <option key={choice.index} value={choice.index}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="editor-export-interactive"
                disabled={busy || chosenInteractiveShot < 0}
                onClick={() =>
                  void exportInteractivePage(editor, chosenInteractiveShot)
                }
              >
                导出交互页（3D 镜头）
              </button>
            </>
          ) : null}
          <p className="shot-template-note">
            浏览器单文件包上限 32 MiB；更大的媒体项目可用现有 CLI
            目录包。历史渲染记录可能包含原电脑路径，分享前请检查项目数据。
          </p>
          {message ? <p className="editor-message">{message}</p> : null}

          {document.renderRecords.length > 0 ? (
            <div className="render-records">
              <h3>渲染记录（{document.renderRecords.length}）</h3>
              <ul>
                {document.renderRecords.map((record) => (
                  <li key={record.renderId}>
                    {record.width}×{record.height} · {record.frames} 帧 ·{" "}
                    {record.codec} · {record.outputAssetRef}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </fieldset>
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <Link className="studio-brand" href="/">
          AI Creative Suite
        </Link>
        <span className="studio-divider" />
        <span className="studio-title">Video Studio</span>
        <span className="studio-badge">P0 本地工作台</span>
      </header>
      <section className="project-pane">
        <section className="sample-gallery" aria-label="可编辑样片库">
          <div className="sample-gallery-heading">
            <div>
              <h2>从样片开始</h2>
              <p>选择后复制为你的独立项目；镜头、文字和素材都可继续编辑。</p>
            </div>
          </div>
          <div className="sample-gallery-grid">
            {GALLERY_SAMPLES.map((sample) => (
              <article className="sample-card" key={sample.id}>
                <div
                  className="sample-card-poster"
                  role="img"
                  aria-label={`${sample.title}画面预览`}
                  style={{ backgroundImage: `url(${sample.poster})` }}
                />
                <div className="sample-card-body">
                  <h3>{sample.title}</h3>
                  <p>{sample.summary}</p>
                  <small>{sample.detail}</small>
                  <button
                    type="button"
                    className="sample-use"
                    disabled={galleryBusy !== null}
                    onClick={() => void useGallerySample(sample.id)}
                  >
                    {galleryBusy === sample.id ? "正在创建…" : "使用此样片"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className="project-toolbar">
          <h2>本地项目</h2>
          <button
            type="button"
            className="project-create"
            onClick={() => {
              setEditor({
                document: createEmptyVideoProject(),
                message: null,
                busy: false,
                sentence: "",
                plan: null,
                storyboard: null,
              });
              semanticRequestRef.current += 1;
              setSemanticPlan({
                busy: false,
                error: null,
                provenance: null,
                durationDeviation: null,
                    needsAssetsChoice: false,
              });
            }}
          >
            新建项目
          </button>
          <button
            type="button"
            className="project-import"
            onClick={() => importInputRef.current?.click()}
          >
            导入项目 JSON
          </button>
          <button
            type="button"
            className="project-import-portable"
            onClick={() => portableImportInputRef.current?.click()}
          >
            导入可移植项目包（含素材）
          </button>
          <button
            type="button"
            className="project-import"
            onClick={() => styleImportInputRef.current?.click()}
          >
            导入 Style Bible JSON
          </button>
          <input
            ref={styleImportInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                const bible = validateStyleBible(JSON.parse(await file.text()));
                const stored = await openStyleBible(bible.id);
                await saveStyleBible(bible, stored?.revision ?? 0);
                setListMessage(
                  `已导入 Style Bible（${bible.versions.length} 个版本）；现在可导入引用它的项目 JSON`,
                );
              } catch (error) {
                setListMessage(
                  error instanceof Error
                    ? error.message
                    : "导入 Style Bible 失败",
                );
              }
            }}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = ""; // 允许重复选择同一文件
              if (!file) return;
              try {
                // P1-A 回程：CLI 回写件（含 RenderRecord）导回，同一项目 ID 贯穿
                const imported = await importVideoProject(
                  parseProjectJson(await file.text()),
                );
                await refreshProjects();
                setEditor({
                  document: imported,
                  message: `已导入 ${imported.title}（v${imported.savedVersion}）`,
                  busy: false,
                  sentence: imported.brief.sentence,
                  plan: null,
                  storyboard: null,
                });
              } catch (error) {
                setListMessage(
                  error instanceof Error ? error.message : "导入失败",
                );
              }
            }}
          />
          <input
            ref={portableImportInputRef}
            className="project-portable-file-input"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                if (file.size > 32 * 1024 * 1024)
                  throw new Error(
                    "项目包超过浏览器 32 MiB 上限，请使用 CLI 目录包",
                  );
                const response = await fetch("/api/video/portable", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "import",
                    envelope: await file.text(),
                  }),
                });
                const payload = (await response.json()) as {
                  project?: VideoProject;
                  styleBible?: unknown;
                  installedMedia?: number;
                  error?: string;
                };
                if (!response.ok || !payload.project)
                  throw new Error(payload.error ?? "项目包导入失败");
                const imported = await importPortableVideoProject(
                  validateVideoProject(payload.project),
                  payload.styleBible
                    ? validateStyleBible(payload.styleBible)
                    : null,
                );
                await refreshProjects();
                setEditor({
                  document: imported,
                  message: `已导入项目包：${imported.title}；恢复 ${payload.installedMedia ?? 0} 个媒体原件。历史成片需在本机重新渲染。`,
                  busy: false,
                  sentence: imported.brief.sentence,
                  plan: null,
                  storyboard: null,
                });
              } catch (error) {
                setListMessage(
                  error instanceof Error ? error.message : "项目包导入失败",
                );
              }
            }}
          />
        </div>
        {listMessage ? <p className="editor-message">{listMessage}</p> : null}
        {projects.length === 0 ? (
          <p className="project-empty">还没有本地项目，点「新建项目」开始。</p>
        ) : (
          <table className="project-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>更新时间</th>
                <th>版本</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>{project.title}</td>
                  <td>{new Date(project.updatedAt).toLocaleString()}</td>
                  <td>v{project.savedVersion}</td>
                  <td>
                    <button
                      type="button"
                      className="project-open"
                      onClick={async () => {
                        const document = await openVideoProject(project.id);
                        if (!document) {
                          await refreshProjects();
                          return;
                        }
                        setEditor({
                          document,
                          message: null,
                          busy: false,
                          sentence: document.brief.sentence,
                          plan: null,
                          storyboard: null,
                        });
                        semanticRequestRef.current += 1;
                        setSemanticPlan({
                          busy: false,
                          error: null,
                          provenance: null,
                          durationDeviation: null,
                    needsAssetsChoice: false,
                        });
                      }}
                    >
                      打开
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
