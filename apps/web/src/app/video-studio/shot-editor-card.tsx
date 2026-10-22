"use client";

import type {
  MediaAsset,
  MediaClipPatch,
  Shot,
  ThreeSceneSpec,
  VideoProject,
} from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
import { useEffect, useMemo, useState } from "react";
import {
  applyLayoutToSpec,
  describeLineChartLabels,
  EMPTY_LAYOUT_DRAFTS,
  type LayoutEditDraft,
  layoutDraftFromSpec,
  previewLineOverride,
} from "./aspect-layout-edit";
import {
  type CandidateSummary,
  candidateChoices,
  candidateSummaries,
  defaultCandidatePair,
  statusLabel,
} from "./candidate-compare";
import {
  applyChartTemplate,
  buildChartRevisePatch,
  CHART_TEMPLATES,
  type ChartEditDraft,
  draftChartFromSpec,
  isChartComponentId,
} from "./chart-templates";
import { describeDurationImpact, durationApplyError } from "./duration-impact";
import {
  applyFlowTemplate,
  buildFlowRevisePatch,
  draftFlowFromSpec,
  FLOW_TEMPLATES,
  type FlowEditDraft,
  isFlowComponentId,
} from "./flow-templates";
import {
  applyLoadingTemplate,
  buildLoadingRevisePatch,
  draftLoadingFromSpec,
  isLoadingComponentId,
  LOADING_TEMPLATES,
  type LoadingEditDraft,
} from "./loading-templates";
import {
  applyMapTemplate,
  buildMapRevisePatch,
  draftMapFromSpec,
  isMapComponentId,
  MAP_TEMPLATES,
  type MapEditDraft,
} from "./map-templates";
import { assetLabel } from "./media-assets";
import {
  buildMediaRevisePatch,
  draftMediaFromVersion,
  MEDIA_TEMPLATE_ID,
  MEDIA_TEMPLATE_LABEL,
  type MediaEditDraft,
  mediaTemplateSelectValue,
} from "./media-clip-templates";
import { LINE_TEMPLATE_LABELS, SHAPE_TEMPLATE_LABELS } from "./planner";
import {
  attachDescription,
  buildRevisePatch,
  draftDurationMs,
  draftFromWorking,
  type ShotEditDraft,
  speechOverflowMs,
} from "./shot-edit";
import { shotWorkingSpec } from "./shot-specs";
import {
  applySketchTemplate,
  buildSketchRevisePatch,
  draftSketchFromSpec,
  isSketchComponentId,
  SKETCH_TEMPLATES,
  type SketchEditDraft,
} from "./sketch-templates";
import {
  applyStickTemplate,
  buildStickRevisePatch,
  draftStickFromSpec,
  isStickComponentId,
  STICK_TEMPLATES,
  type StickEditDraft,
} from "./stick-templates";
import { isStockSourceEnabled } from "./stock-capability";
import { StockSearchPanel } from "./stock-search-panel";
import {
  buildThreeSceneVersion,
  DEFAULT_THREE_COMPONENT_ID,
  DEFAULT_THREE_PARAMS,
  THREE_TEMPLATE_ID,
  THREE_TEMPLATE_LABEL,
  threeTemplateSelectValue,
} from "./three-templates";

// 分镜编辑器镜头卡：只读信息 + 展开式编辑（旁白/画面修订、单镜头重做、
// 版本回滚、锁定）。草稿是本地状态，点「应用修订」才经回调落文档；
// 校验全走 shot-edit.ts / chart-templates.ts / map-templates.ts /
// flow-templates.ts / stick-templates.ts / sketch-templates.ts /
// loading-templates.ts 纯逻辑，非法草稿不回调。

const EMPTY_CHART_DRAFT: ChartEditDraft = {
  title: "",
  data: "",
  value: "",
  prefix: "",
  suffix: "",
};

const EMPTY_MAP_DRAFT: MapEditDraft = { title: "", data: "" };

const EMPTY_FLOW_DRAFT: FlowEditDraft = { title: "", data: "" };

const EMPTY_STICK_DRAFT: StickEditDraft = { title: "", data: "" };

const EMPTY_SKETCH_DRAFT: SketchEditDraft = { title: "", data: "" };

const EMPTY_LOADING_DRAFT: LoadingEditDraft = {
  title: "",
  label: "",
  count: "",
  target: "",
};

const EMPTY_MEDIA_DRAFT: MediaEditDraft = {
  assetId: "",
  inMsText: "0",
  outMsText: "2000",
  fit: "cover",
  focalPercentText: "50",
  audio: "mute",
};

// 媒体/3D→spec 换装的合成基底：resolveAnyTemplate 会覆写 componentId/params，
// 基底只贡献 seed/background/durationMs（时长 ≥200ms 保 spec 合法下限）。
function mediaSubstrateSpec(durationMs: number): SceneSpec {
  return {
    specVersion: 1,
    componentId: "bar-chart",
    componentVersion: 1,
    durationMs: Math.max(durationMs, 200),
    seed: 1,
    background: "#ffffff",
    params: {},
  };
}

// 模板下拉跨图表/地图/流程/火柴人/手绘/加载六族解析：先按图表找，找不到
// 再按流程、地图、火柴人、手绘、加载找。
function resolveAnyTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec | null; error: string | null } {
  const chart = applyChartTemplate(spec, templateId);
  if (chart.spec) return { spec: chart.spec, error: null };
  const flow = applyFlowTemplate(spec, templateId);
  if (flow.spec) return { spec: flow.spec, error: null };
  const map = applyMapTemplate(spec, templateId);
  if (map.spec) return { spec: map.spec, error: null };
  const stick = applyStickTemplate(spec, templateId);
  if (stick.spec) return { spec: stick.spec, error: null };
  const sketch = applySketchTemplate(spec, templateId);
  if (sketch.spec) return { spec: sketch.spec, error: null };
  const loading = applyLoadingTemplate(spec, templateId);
  if (loading.spec) return { spec: loading.spec, error: null };
  return { spec: null, error: flow.error ?? map.error ?? chart.error };
}

export type ShotEditorCardProps = {
  shot: Shot;
  index: number;
  // 整片时间线不可量化（存量零帧/不可预览场景源）时为 null，卡片照常可编辑。
  frames: number | null;
  // 整片文档：改时长时量化全片帧数、检查相邻转场借帧（只读，不落库）。
  project: VideoProject;
  // shotWorkingSpec 降级（非 spec/媒体场景源/非法 spec）时 false → 只读卡。
  editable: boolean;
  // P2.5-T3：媒体镜头编辑臂所需账本（素材下拉/默认入出点）。
  mediaAssets: MediaAsset[];
  onRevise: (patch: {
    narrationText?: string;
    description?: string;
    spec?: unknown;
    mediaClip?: MediaClipPatch;
    threeScene?: ThreeSceneSpec;
  }) => void;
  onRedo: (directive: string) => void;
  // 成功返回 null；被统一选版本闸门拦下时返回用户可见错误。
  onRollback: (versionId: string) => Promise<string | null>;
  onToggleLock: (locked: boolean) => void;
  redoError: string | null;
  // P2.6-T7：媒体臂在线素材面板的「下载并应用」回调（返回成功消息）。
  onImportStock: (pageTitle: string, derivativeUrl: string) => Promise<string>;
};

export function ShotEditorCard({
  shot,
  index,
  frames,
  project,
  editable,
  mediaAssets,
  onRevise,
  onRedo,
  onRollback,
  onToggleLock,
  redoError,
  onImportStock,
}: ShotEditorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  const spec = shotWorkingSpec(shot);
  const mediaSource =
    working?.sceneSource.type === "media-clip" ? working.sceneSource : null;
  const threeSource =
    working?.sceneSource.type === "three" ? working.sceneSource : null;
  // spec 缺席但工作版本是媒体/3D → 用合成基底撑起通用草稿（旁白/时长）与模板链
  const editSpec =
    spec ??
    (working && (mediaSource || threeSource)
      ? mediaSubstrateSpec(working.durationMs)
      : null);
  const canEdit = editable && working !== undefined && editSpec !== null;

  const [draft, setDraft] = useState<ShotEditDraft>(() =>
    working && editSpec
      ? draftFromWorking(
          {
            narrationText: working.narrationText,
            durationMs: working.durationMs,
            description: working.description,
          },
          editSpec,
        )
      : {
          description: "",
          narrationText: "",
          background: "#ffffff",
          durationSeconds: 0,
          title: "",
          subtitle: "",
          templateAdvanced: false,
        },
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [directive, setDirective] = useState("");
  const [selectedVersion, setSelectedVersion] = useState(shot.workingVersionId);
  // 关键镜头双候选（B）：两列对比既有内容版本；不新增文档字段与事件。
  const candidatePair = defaultCandidatePair(shot);
  const candidateList = candidateSummaries(shot);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [leftCandidateId, setLeftCandidateId] = useState(
    candidatePair?.leftId ?? "",
  );
  const [rightCandidateId, setRightCandidateId] = useState(
    candidatePair?.rightId ?? "",
  );
  const [pendingTemplateId, setPendingTemplateId] = useState("");
  // 媒体臂启用条件：已选媒体条目，或工作版本就是媒体且未选 spec 模板
  const editingMedia =
    pendingTemplateId === MEDIA_TEMPLATE_ID ||
    (mediaSource !== null && pendingTemplateId === "");
  // 3D 臂同构：选中 3D 模板即切到只读信息块（无 spec 字段可编）；
  // 工作版本已是 three 且未换装时也停在该臂。
  const editingThree =
    pendingTemplateId === THREE_TEMPLATE_ID ||
    (threeSource !== null && pendingTemplateId === "");
  const [chartDraft, setChartDraft] = useState<ChartEditDraft>(() =>
    spec && isChartComponentId(spec.componentId)
      ? draftChartFromSpec(spec)
      : EMPTY_CHART_DRAFT,
  );
  const [chartError, setChartError] = useState<string | null>(null);
  const [mapDraft, setMapDraft] = useState<MapEditDraft>(() =>
    spec && isMapComponentId(spec.componentId)
      ? draftMapFromSpec(spec)
      : EMPTY_MAP_DRAFT,
  );
  const [mapError, setMapError] = useState<string | null>(null);
  const [flowDraft, setFlowDraft] = useState<FlowEditDraft>(() =>
    spec && isFlowComponentId(spec.componentId)
      ? draftFlowFromSpec(spec)
      : EMPTY_FLOW_DRAFT,
  );
  const [flowError, setFlowError] = useState<string | null>(null);
  const [stickDraft, setStickDraft] = useState<StickEditDraft>(() =>
    spec && isStickComponentId(spec.componentId)
      ? draftStickFromSpec(spec)
      : EMPTY_STICK_DRAFT,
  );
  const [stickError, setStickError] = useState<string | null>(null);
  const [sketchDraft, setSketchDraft] = useState<SketchEditDraft>(() =>
    spec && isSketchComponentId(spec.componentId)
      ? draftSketchFromSpec(spec)
      : EMPTY_SKETCH_DRAFT,
  );
  const [sketchError, setSketchError] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState<LoadingEditDraft>(() =>
    spec && isLoadingComponentId(spec.componentId)
      ? draftLoadingFromSpec(spec)
      : EMPTY_LOADING_DRAFT,
  );
  const [loadingError, setLoadingError] = useState<string | null>(null);
  // 双画幅版式覆写（2026-10-23 brief §三B）：仅 text-animation / line-chart
  // 出「画幅微调」区块；草稿随工作版本重置，换模板 = 新视觉基底 → 清空。
  const layoutEditable =
    editSpec !== null &&
    (editSpec.componentId === "text-animation" ||
      editSpec.componentId === "line-chart");
  const [layoutDraft, setLayoutDraft] = useState<LayoutEditDraft | null>(() =>
    editSpec && layoutEditable ? layoutDraftFromSpec(editSpec) : null,
  );
  const [layoutAspect, setLayoutAspect] = useState<"portrait" | "landscape">(
    "portrait",
  );
  const [layoutError, setLayoutError] = useState<string | null>(null);
  // P2.5-T3 媒体草稿（第七族）：素材/入出点/fit/注视点/原声，校验与预警全走
  // media-clip-templates.ts 纯逻辑，非法草稿不回调。
  const [mediaDraft, setMediaDraft] = useState<MediaEditDraft | null>(
    () => draftMediaFromVersion(working, mediaAssets).draft,
  );
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaWarnings, setMediaWarnings] = useState<string[]>([]);

  // 改时长的影响提示（纯预览）：草稿秒数非有限或 <1ms 时不量化，
  // 避免把非法输入当成编辑结果；其余一律走 duration-impact 的纯逻辑。
  const durationImpact = useMemo(() => {
    if (!canEdit) return null;
    const ms = Math.round(draft.durationSeconds * 1000);
    if (!Number.isFinite(ms) || ms < 1) return null;
    return describeDurationImpact(project, index, ms);
  }, [canEdit, project, index, draft.durationSeconds]);

  // 工作版本变化（应用修订/重做/回滚）→ 对比面板回到默认对，不显示陈旧两列。
  // 只盯 workingVersionId：锁定切换会换 shot 对象身份但不动工作版本。
  useEffect(() => {
    const next = defaultCandidatePair(shot);
    setLeftCandidateId(next?.leftId ?? "");
    setRightCandidateId(next?.rightId ?? "");
    setCompareError(null);
  }, [shot.workingVersionId]);

  // 两列面板与旧版“回滚到此版本”共享 page 的选版本闸门。
  const chooseCandidate = async (summary: CandidateSummary) => {
    setCompareError(await onRollback(summary.versionId));
  };

  // working 版本变了（应用修订/重做/回滚后）→ 草稿重置到新工作版本。
  // 只盯 workingVersionId（终评整改）：锁定切换会换 shot 对象身份但不动
  // working 版本，不得清掉进行中的编辑草稿。
  useEffect(() => {
    setSelectedVersion(shot.workingVersionId);
    const nextWorking = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const nextSpec = shotWorkingSpec(shot);
    const nextMediaSource =
      nextWorking?.sceneSource.type === "media-clip"
        ? nextWorking.sceneSource
        : null;
    const nextEditSpec =
      nextSpec ??
      (nextWorking &&
      (nextMediaSource || nextWorking.sceneSource.type === "three")
        ? mediaSubstrateSpec(nextWorking.durationMs)
        : null);
    if (nextWorking && nextEditSpec) {
      setDraft(
        draftFromWorking(
          {
            narrationText: nextWorking.narrationText,
            durationMs: nextWorking.durationMs,
            description: nextWorking.description,
          },
          nextEditSpec,
        ),
      );
      setEditError(null);
    }
    setPendingTemplateId("");
    setMediaDraft(draftMediaFromVersion(nextWorking, mediaAssets).draft);
    setMediaError(null);
    setMediaWarnings([]);
    setChartError(null);
    setChartDraft(
      nextSpec && isChartComponentId(nextSpec.componentId)
        ? draftChartFromSpec(nextSpec)
        : EMPTY_CHART_DRAFT,
    );
    setMapError(null);
    setMapDraft(
      nextSpec && isMapComponentId(nextSpec.componentId)
        ? draftMapFromSpec(nextSpec)
        : EMPTY_MAP_DRAFT,
    );
    setFlowError(null);
    setFlowDraft(
      nextSpec && isFlowComponentId(nextSpec.componentId)
        ? draftFlowFromSpec(nextSpec)
        : EMPTY_FLOW_DRAFT,
    );
    setStickError(null);
    setStickDraft(
      nextSpec && isStickComponentId(nextSpec.componentId)
        ? draftStickFromSpec(nextSpec)
        : EMPTY_STICK_DRAFT,
    );
    setSketchError(null);
    setSketchDraft(
      nextSpec && isSketchComponentId(nextSpec.componentId)
        ? draftSketchFromSpec(nextSpec)
        : EMPTY_SKETCH_DRAFT,
    );
    setLoadingError(null);
    setLoadingDraft(
      nextSpec && isLoadingComponentId(nextSpec.componentId)
        ? draftLoadingFromSpec(nextSpec)
        : EMPTY_LOADING_DRAFT,
    );
    setLayoutError(null);
    setLayoutAspect("portrait");
    setLayoutDraft(
      nextSpec &&
        (nextSpec.componentId === "text-animation" ||
          nextSpec.componentId === "line-chart")
        ? layoutDraftFromSpec(nextSpec)
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖收紧是有意的（见上注）
  }, [shot.workingVersionId]);

  // 换模板 = 换视觉基底：旧画幅覆写不再适用 → 草稿清空（应用链还有
  // componentId 兜底，家族换走时静默不并入 layout）。
  useEffect(() => {
    if (pendingTemplateId === "") return;
    setLayoutError(null);
    setLayoutDraft((current) => {
      if (!current) return current;
      return current.componentId === "text-animation"
        ? {
            componentId: "text-animation",
            portrait: { ...EMPTY_LAYOUT_DRAFTS.text },
            landscape: { ...EMPTY_LAYOUT_DRAFTS.text },
          }
        : {
            componentId: "line-chart",
            portrait: { ...EMPTY_LAYOUT_DRAFTS.line },
            landscape: { ...EMPTY_LAYOUT_DRAFTS.line },
          };
    });
  }, [pendingTemplateId]);

  // 覆写草稿的单字段更新（联合类型按画幅分桶，计算键展开需窄化辅助）。
  const updateLayoutField = (
    aspect: "portrait" | "landscape",
    patch: Partial<LayoutEditDraft["portrait"]>,
  ) => {
    setLayoutDraft((current) =>
      current
        ? ({
            ...current,
            [aspect]: { ...current[aspect], ...patch },
          } as LayoutEditDraft)
        : current,
    );
  };

  const overflowMs = canEdit ? speechOverflowMs(draft) : 0;
  const templateLabels =
    spec?.componentId === "line-drawing"
      ? LINE_TEMPLATE_LABELS
      : spec?.componentId === "basic-shapes"
        ? SHAPE_TEMPLATE_LABELS
        : null;
  // 3D 只读臂：已有 three 工作版本看实际 spec；刚选中模板则预览模板默认值。
  const threeParams =
    threeSource?.spec.params ??
    (pendingTemplateId === THREE_TEMPLATE_ID ? DEFAULT_THREE_PARAMS : null);
  const threeSummary = threeParams
    ? `组件：${threeSource?.spec.componentId ?? DEFAULT_THREE_COMPONENT_ID} · 参数：${Object.entries(
        threeParams,
      )
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("，")}`
    : null;

  return (
    <li className="shot-card">
      <span className="shot-order">
        {index + 1}（order {shot.order}）{shot.locked ? " · 锁定" : ""}
      </span>
      <span className="shot-description">
        {working ? working.description : "（无工作版本）"}
      </span>
      {working?.narrationText ? (
        <span className="shot-narration">旁白：{working.narrationText}</span>
      ) : null}
      <span className="shot-duration">
        {working ? `${working.durationMs / 1000}s` : ""} ·{" "}
        {frames === null ? "帧数不可用" : `${frames} 帧`}
      </span>
      <label className="shot-lock-toggle">
        <input
          type="checkbox"
          checked={shot.locked}
          onChange={(event) => onToggleLock(event.target.checked)}
        />
        锁定
      </label>
      {canEdit ? (
        <button
          type="button"
          className="shot-edit-toggle"
          onClick={() => {
            setExpanded(!expanded);
            setEditError(null);
          }}
        >
          {expanded ? "收起编辑" : "编辑"}
        </button>
      ) : null}
      <select
        className="shot-version-select"
        value={selectedVersion}
        onChange={(event) => setSelectedVersion(event.target.value)}
        aria-label={`镜头 ${index + 1} 版本`}
      >
        {shot.contentVersions.map((version, versionIndex) => (
          <option key={version.versionId} value={version.versionId}>
            #{versionIndex + 1}{" "}
            {version.versionId === shot.workingVersionId ? "（工作）" : ""}{" "}
            {version.description.slice(0, 24)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="shot-rollback"
        disabled={selectedVersion === shot.workingVersionId}
        onClick={() => void onRollback(selectedVersion)}
      >
        回滚到此版本
      </button>
      {shot.contentVersions.length >= 2 ? (
        <button
          type="button"
          className="shot-compare-toggle"
          onClick={() => {
            setCompareOpen(!compareOpen);
            setCompareError(null);
          }}
        >
          {compareOpen ? "收起对比" : "对比候选"}
        </button>
      ) : null}
      {compareOpen && shot.contentVersions.length >= 2 ? (
        <div className="shot-compare-panel">
          {[
            {
              label: "候选 A",
              value: leftCandidateId,
              setValue: setLeftCandidateId,
              exclude: rightCandidateId,
            },
            {
              label: "候选 B",
              value: rightCandidateId,
              setValue: setRightCandidateId,
              exclude: leftCandidateId,
            },
          ].map((column) => {
            const summary = candidateList.find(
              (candidate) => candidate.versionId === column.value,
            );
            if (!summary) return null;
            const impact = describeDurationImpact(
              project,
              index,
              summary.durationMs,
            );
            const framesText = summary.isWorking
              ? `当前 ${impact.beforeFrames ?? "不可量化"} 帧`
              : `${impact.beforeFrames ?? "不可量化"} → ${impact.afterFrames ?? "不可量化"} 帧`;
            return (
              <div className="shot-compare-column" key={column.label}>
                <p className="shot-compare-title">
                  {column.label} #{summary.index} {statusLabel(summary.status)}
                </p>
                <select
                  className="shot-compare-select"
                  aria-label={`镜头 ${index + 1} ${column.label}`}
                  value={column.value}
                  onChange={(event) => column.setValue(event.target.value)}
                >
                  {candidateChoices(candidateList, column.exclude).map(
                    (choice) => (
                      <option key={choice.versionId} value={choice.versionId}>
                        #{choice.index} {choice.description.slice(0, 24)}
                      </option>
                    ),
                  )}
                </select>
                <p className="shot-compare-description">
                  {summary.description}
                </p>
                <p className="shot-compare-meta">
                  {summary.durationMs / 1000}s · {framesText}
                </p>
                <button
                  type="button"
                  className="shot-compare-choose"
                  disabled={summary.isWorking}
                  onClick={() => chooseCandidate(summary)}
                >
                  选用此候选
                </button>
              </div>
            );
          })}
          {compareError ? (
            <p className="shot-edit-error">{compareError}</p>
          ) : null}
          <p className="shot-compare-note">
            说明来自版本记录，不代表画面质量；选用只切换工作版本，不改变审批状态。
          </p>
        </div>
      ) : null}
      {expanded && canEdit && editSpec ? (
        <div className="shot-edit-form">
          <label className="shot-edit-field">
            镜头说明
            <input
              className="shot-description-input"
              maxLength={200}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <label className="shot-edit-field">
            旁白
            <textarea
              className="shot-narration-input"
              value={draft.narrationText}
              maxLength={2000}
              onChange={(event) =>
                setDraft({ ...draft, narrationText: event.target.value })
              }
            />
          </label>
          {/* M6/终评 F1：组件模板下拉在共享层（各编辑臂恒可见恒可撤）——媒体/
              3D 镜头换回 spec 组件的唯一入口；工作版本已是媒体/3D 且未选换装
              时，value 停在本族条目（mediaTemplateSelectValue /
              threeTemplateSelectValue）。 */}
          <label className="shot-edit-field">
            组件模板（图表 / 地图 / 流程 / 火柴人 / 手绘 / 加载 / 媒体 / 3D）
            <select
              className="chart-template-select"
              value={threeTemplateSelectValue(
                mediaTemplateSelectValue(
                  pendingTemplateId,
                  mediaSource !== null,
                ),
                threeSource !== null,
              )}
              onChange={(event) => {
                const templateId = event.target.value;
                setPendingTemplateId(templateId);
                setChartError(null);
                setMapError(null);
                setFlowError(null);
                setStickError(null);
                setSketchError(null);
                setLoadingError(null);
                if (!templateId) return;
                // 3D：只切换编辑臂，应用时按当前工作版本时长生成 three 场景源
                if (templateId === THREE_TEMPLATE_ID) return;
                // 第七族「媒体」：不走六族换装，选中即播种媒体草稿
                if (templateId === MEDIA_TEMPLATE_ID) {
                  const seeded = draftMediaFromVersion(working, mediaAssets);
                  setMediaDraft(seeded.draft);
                  setMediaError(seeded.error);
                  setMediaWarnings([]);
                  return;
                }
                const applied = resolveAnyTemplate(editSpec, templateId);
                if (applied.error || !applied.spec) {
                  setChartError(applied.error ?? "模板无效");
                  return;
                }
                // 选中即预填该模板数据到编辑字段（应用时才落文档）
                if (isChartComponentId(applied.spec.componentId)) {
                  setChartDraft(draftChartFromSpec(applied.spec));
                } else if (isMapComponentId(applied.spec.componentId)) {
                  setMapDraft(draftMapFromSpec(applied.spec));
                } else if (isFlowComponentId(applied.spec.componentId)) {
                  setFlowDraft(draftFlowFromSpec(applied.spec));
                } else if (isStickComponentId(applied.spec.componentId)) {
                  setStickDraft(draftStickFromSpec(applied.spec));
                } else if (isSketchComponentId(applied.spec.componentId)) {
                  setSketchDraft(draftSketchFromSpec(applied.spec));
                } else if (isLoadingComponentId(applied.spec.componentId)) {
                  setLoadingDraft(draftLoadingFromSpec(applied.spec));
                }
              }}
            >
              <option value="">— 保持当前组件 —</option>
              <optgroup label="图表">
                {CHART_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="地图">
                {MAP_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="流程">
                {FLOW_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="火柴人">
                {STICK_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="手绘">
                {SKETCH_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="加载">
                {LOADING_TEMPLATES.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="媒体">
                <option value={MEDIA_TEMPLATE_ID}>
                  {MEDIA_TEMPLATE_LABEL}
                </option>
              </optgroup>
              <optgroup label="3D">
                <option value={THREE_TEMPLATE_ID}>
                  {THREE_TEMPLATE_LABEL}
                </option>
              </optgroup>
            </select>
          </label>
          {!editingMedia ? (
            <>
              {editingThree ? (
                <>
                  <p className="shot-three-info">
                    3D 镜头 · 出片时烘焙；工作台不预览 3D 画面
                  </p>
                  <p className="shot-three-info">{threeSummary}</p>
                </>
              ) : (
                <label className="shot-edit-field">
                  背景色
                  <input
                    className="shot-bg-input"
                    value={draft.background}
                    onChange={(event) =>
                      setDraft({ ...draft, background: event.target.value })
                    }
                  />
                </label>
              )}
              {/* 时长输入与帧数影响对 spec 臂和 3D 臂共享：零帧 3D 镜头
                  也要有改回可出片时长的入口；媒体时长仍来自出入点。 */}
              <label className="shot-edit-field">
                时长（秒）
                <input
                  className="shot-duration-input"
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={draft.durationSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      durationSeconds: Number(event.target.value),
                    })
                  }
                />
              </label>
              {durationImpact?.changed ? (
                <p
                  className={
                    durationImpact.frameError || durationImpact.transitionIssue
                      ? "shot-impact shot-impact-warn"
                      : "shot-impact"
                  }
                >
                  整片帧数：{durationImpact.beforeFrames ?? "无法量化"} →{" "}
                  {durationImpact.afterFrames ?? "无法量化"} 帧 @24fps
                  {durationImpact.frameError
                    ? ` · ${durationImpact.frameError}`
                    : ""}
                  {durationImpact.transitionIssue
                    ? ` · ${durationImpact.transitionIssue}`
                    : ""}
                </p>
              ) : null}
              {!editingThree ? (
                <>
                  {editSpec.componentId === "text-animation" ? (
                    <>
                      <label className="shot-edit-field">
                        标题
                        <input
                          className="shot-title-input"
                          maxLength={80}
                          value={draft.title}
                          onChange={(event) =>
                            setDraft({ ...draft, title: event.target.value })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        副标题
                        <input
                          className="shot-subtitle-input"
                          maxLength={80}
                          value={draft.subtitle}
                          onChange={(event) =>
                            setDraft({ ...draft, subtitle: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : templateLabels ? (
                    <span className="shot-edit-field">
                      <button
                        type="button"
                        className="shot-template-button"
                        onClick={() =>
                          setDraft({ ...draft, templateAdvanced: true })
                        }
                        disabled={draft.templateAdvanced}
                      >
                        换一枚模板
                      </button>
                      <span className="shot-template-note">
                        当前第 {(editSpec.seed % templateLabels.length) + 1} /
                        {templateLabels.length} 枚
                        {draft.templateAdvanced
                          ? ` → 换成第 ${((editSpec.seed + 1) % templateLabels.length) + 1} 枚`
                          : ""}
                      </span>
                    </span>
                  ) : null}
                  {isChartComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        图表标题
                        <input
                          className="chart-title-input"
                          maxLength={40}
                          value={chartDraft.title}
                          onChange={(event) =>
                            setChartDraft({
                              ...chartDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      {editSpec.componentId === "number-counter" ? (
                        <>
                          <label className="shot-edit-field">
                            数值
                            <input
                              className="chart-value-input"
                              value={chartDraft.value}
                              onChange={(event) =>
                                setChartDraft({
                                  ...chartDraft,
                                  value: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="shot-edit-field">
                            前缀
                            <input
                              className="chart-prefix-input"
                              maxLength={6}
                              value={chartDraft.prefix}
                              onChange={(event) =>
                                setChartDraft({
                                  ...chartDraft,
                                  prefix: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="shot-edit-field">
                            后缀
                            <input
                              className="chart-suffix-input"
                              maxLength={6}
                              value={chartDraft.suffix}
                              onChange={(event) =>
                                setChartDraft({
                                  ...chartDraft,
                                  suffix: event.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      ) : (
                        <label className="shot-edit-field">
                          数据（每行 标签,数值
                          {editSpec.componentId === "line-chart"
                            ? "，折线可只写数值"
                            : ""}
                          ）
                          <textarea
                            className="chart-data-input"
                            rows={6}
                            value={chartDraft.data}
                            onChange={(event) =>
                              setChartDraft({
                                ...chartDraft,
                                data: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      {chartError ? (
                        <p className="chart-edit-error">{chartError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {isMapComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        地图标题
                        <input
                          className="map-title-input"
                          maxLength={40}
                          value={mapDraft.title}
                          onChange={(event) =>
                            setMapDraft({
                              ...mapDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        数据（每行{" "}
                        {editSpec.componentId === "map-grid"
                          ? "标签,行,列[,数值]（行/列 0..7）"
                          : "名称,x,y（首行起点、末行终点，中间为途经；可省名称）"}
                        ）
                        <textarea
                          className="map-data-input"
                          rows={6}
                          value={mapDraft.data}
                          onChange={(event) =>
                            setMapDraft({
                              ...mapDraft,
                              data: event.target.value,
                            })
                          }
                        />
                      </label>
                      {mapError ? (
                        <p className="map-edit-error">{mapError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {isFlowComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        流程标题
                        <input
                          className="flow-title-input"
                          maxLength={40}
                          value={flowDraft.title}
                          onChange={(event) =>
                            setFlowDraft({
                              ...flowDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        数据（
                        {editSpec.componentId === "flow-steps"
                          ? "每行一个步骤标签，2..8 行、1..10 字符"
                          : "节点段每行 标签,x,y[,菱形]；单独一行 --- 分隔；边段每行 标签->标签[,边标]"}
                        ）
                        <textarea
                          className="flow-data-input"
                          rows={8}
                          value={flowDraft.data}
                          onChange={(event) =>
                            setFlowDraft({
                              ...flowDraft,
                              data: event.target.value,
                            })
                          }
                        />
                      </label>
                      {flowError ? (
                        <p className="flow-edit-error">{flowError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {isStickComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        火柴人标题
                        <input
                          className="stick-title-input"
                          maxLength={40}
                          value={stickDraft.title}
                          onChange={(event) =>
                            setStickDraft({
                              ...stickDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        数据（每行 动作,起点x[,终点x]（动作
                        走/站/挥手/指/跳，坐标 0..1000；终点缺省 = 起点））
                        <textarea
                          className="stick-data-input"
                          rows={4}
                          value={stickDraft.data}
                          onChange={(event) =>
                            setStickDraft({
                              ...stickDraft,
                              data: event.target.value,
                            })
                          }
                        />
                      </label>
                      {stickError ? (
                        <p className="stick-edit-error">{stickError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {isSketchComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        手绘标题
                        <input
                          className="sketch-title-input"
                          maxLength={40}
                          value={sketchDraft.title}
                          onChange={(event) =>
                            setSketchDraft({
                              ...sketchDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        数据（每行
                        文本[,下划线|圈]（强调缺省无，文本可含逗号））
                        <textarea
                          className="sketch-data-input"
                          rows={5}
                          value={sketchDraft.data}
                          onChange={(event) =>
                            setSketchDraft({
                              ...sketchDraft,
                              data: event.target.value,
                            })
                          }
                        />
                      </label>
                      {sketchError ? (
                        <p className="sketch-edit-error">{sketchError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {isLoadingComponentId(editSpec.componentId) ? (
                    <>
                      <label className="shot-edit-field">
                        加载标题
                        <input
                          className="loading-title-input"
                          maxLength={40}
                          value={loadingDraft.title}
                          onChange={(event) =>
                            setLoadingDraft({
                              ...loadingDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="shot-edit-field">
                        状态文案（1..12 字）
                        <input
                          className="loading-label-input"
                          maxLength={12}
                          value={loadingDraft.label}
                          onChange={(event) =>
                            setLoadingDraft({
                              ...loadingDraft,
                              label: event.target.value,
                            })
                          }
                        />
                      </label>
                      {editSpec.componentId === "loading-dots" ? (
                        <label className="shot-edit-field">
                          点数（3..6）
                          <input
                            className="loading-count-input"
                            type="number"
                            min={3}
                            max={6}
                            value={loadingDraft.count}
                            onChange={(event) =>
                              setLoadingDraft({
                                ...loadingDraft,
                                count: event.target.value,
                              })
                            }
                          />
                        </label>
                      ) : (
                        <label className="shot-edit-field">
                          目标百分比（1..100）
                          <input
                            className="loading-target-input"
                            type="number"
                            min={1}
                            max={100}
                            value={loadingDraft.target}
                            onChange={(event) =>
                              setLoadingDraft({
                                ...loadingDraft,
                                target: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      {loadingError ? (
                        <p className="loading-edit-error">{loadingError}</p>
                      ) : null}
                    </>
                  ) : null}
                  {layoutDraft && editSpec ? (
                    <fieldset className="aspect-layout-fieldset">
                      <legend>画幅微调（另一画幅保持自动布局）</legend>
                      <div className="aspect-layout-tabs">
                        <button
                          type="button"
                          className={`aspect-layout-tab${layoutAspect === "portrait" ? " is-active" : ""}`}
                          onClick={() => setLayoutAspect("portrait")}
                        >
                          竖版
                        </button>
                        <button
                          type="button"
                          className={`aspect-layout-tab${layoutAspect === "landscape" ? " is-active" : ""}`}
                          onClick={() => setLayoutAspect("landscape")}
                        >
                          横版
                        </button>
                      </div>
                      {layoutDraft.componentId === "text-animation" ? (
                        <>
                          <label className="shot-edit-field">
                            标题换行（每行一条；各行拼接须等于标题）
                            <textarea
                              className="layout-title-lines"
                              rows={3}
                              value={layoutDraft[layoutAspect].titleLinesText}
                              onChange={(event) =>
                                updateLayoutField(layoutAspect, {
                                  titleLinesText: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="shot-edit-field">
                            字号缩放（0.5–1.3，空 = 自动）
                            <input
                              className="layout-title-scale"
                              type="number"
                              step="0.05"
                              min="0.5"
                              max="1.3"
                              value={layoutDraft[layoutAspect].titleScale}
                              onChange={(event) =>
                                updateLayoutField(layoutAspect, {
                                  titleScale: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="shot-edit-field">
                            垂直位置（-0.25–0.25，正 = 下移，空 = 居中）
                            <input
                              className="layout-vertical-offset"
                              type="number"
                              step="0.05"
                              min="-0.25"
                              max="0.25"
                              value={layoutDraft[layoutAspect].verticalOffset}
                              onChange={(event) =>
                                updateLayoutField(layoutAspect, {
                                  verticalOffset: event.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label className="shot-edit-field">
                            轴标签间隔（1–点数；首点与末点恒显，空 = 全显）
                            <input
                              className="layout-label-step"
                              type="number"
                              min="1"
                              value={layoutDraft[layoutAspect].labelStepText}
                              onChange={(event) =>
                                updateLayoutField(layoutAspect, {
                                  labelStepText: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className="layout-short-labels">
                            <p className="layout-short-labels-title">
                              逐项短标签（留空 = 原样；≤12 字）
                            </p>
                            {(
                              (
                                editSpec.params as {
                                  points?: Array<{ label?: string }>;
                                }
                              ).points ?? []
                            ).map((point, pointIndex) => (
                              <label
                                key={pointIndex}
                                className="layout-short-label-row"
                              >
                                <span>
                                  {point.label ?? `#${pointIndex + 1}`}
                                </span>
                                <input
                                  className="layout-short-label-input"
                                  maxLength={12}
                                  value={
                                    layoutDraft[layoutAspect].shortLabels[
                                      pointIndex
                                    ] ?? ""
                                  }
                                  onChange={(event) =>
                                    updateLayoutField(layoutAspect, {
                                      shortLabels: {
                                        ...layoutDraft[layoutAspect]
                                          .shortLabels,
                                        [pointIndex]: event.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            ))}
                          </div>
                          {(() => {
                            const preview = previewLineOverride(
                              layoutDraft[layoutAspect],
                              (
                                (editSpec.params as { points?: unknown[] })
                                  .points ?? []
                              ).length,
                            );
                            const hints = describeLineChartLabels(
                              editSpec.params as {
                                points: Array<{
                                  label?: string;
                                  value: number;
                                }>;
                              },
                              preview ? { [layoutAspect]: preview } : undefined,
                              layoutAspect,
                            );
                            if (
                              hints.hidden.length === 0 &&
                              hints.truncated.length === 0 &&
                              hints.shortened.length === 0
                            )
                              return null;
                            return (
                              <div className="layout-label-hints">
                                {hints.hidden.length > 0 ? (
                                  <p>
                                    已隐藏（间隔）：
                                    {hints.hidden
                                      .map((item) => item.label)
                                      .join("、")}
                                  </p>
                                ) : null}
                                {hints.truncated.length > 0 ? (
                                  <p>
                                    超长截断：
                                    {hints.truncated
                                      .map((item) => `${item.from}→${item.to}`)
                                      .join("、")}
                                  </p>
                                ) : null}
                                {hints.shortened.length > 0 ? (
                                  <p>
                                    已简写：
                                    {hints.shortened
                                      .map((item) => `${item.from}→${item.to}`)
                                      .join("、")}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                        </>
                      )}
                      <p className="aspect-layout-hint">
                        覆写仅影响所选画幅；清空全部字段 = 回到自动布局。
                        随「应用修订」一并保存为新的镜头内容版本。
                      </p>
                      {layoutError ? (
                        <p className="layout-edit-error">{layoutError}</p>
                      ) : null}
                    </fieldset>
                  ) : null}
                  {overflowMs > 0 ? (
                    <span className="shot-overflow-note">
                      旁白按语速需{" "}
                      {(
                        (Math.round(draft.durationSeconds * 1000) +
                          overflowMs) /
                        1000
                      ).toFixed(1)}
                      s，超出当前 {draft.durationSeconds.toFixed(1)}s
                      <button
                        type="button"
                        className="shot-align-speech"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            durationSeconds:
                              (Math.round(draft.durationSeconds * 1000) +
                                overflowMs) /
                              1000,
                          })
                        }
                      >
                        按语速对齐
                      </button>
                    </span>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <label className="shot-edit-field">
                素材
                <select
                  className="media-asset-select"
                  value={mediaDraft?.assetId ?? ""}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      assetId: event.target.value,
                    })
                  }
                >
                  {mediaAssets.length === 0 ? (
                    <option value="">（项目尚无素材）</option>
                  ) : (
                    mediaAssets.map((asset) => (
                      <option key={asset.assetId} value={asset.assetId}>
                        {assetLabel(asset, mediaAssets)}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {/* P2.6-T7：在线素材搜索面板——仅媒体臂、素材下拉正下方；
                  状态按卡独立，下载成功直接落成该镜头的新工作版本。
                  P2.5-T5 复核：与两条 stock 路由共用开关，正式环境不渲染
                  点了只会 503 的死入口（条件 JSX，不能早退——卡片有 hooks）。 */}
              {isStockSourceEnabled() ? (
                <StockSearchPanel
                  disabled={!canEdit}
                  onImportStock={onImportStock}
                />
              ) : null}
              <label className="shot-edit-field">
                入点（ms）
                <input
                  className="media-in-input"
                  value={mediaDraft?.inMsText ?? ""}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      inMsText: event.target.value,
                    })
                  }
                />
              </label>
              <label className="shot-edit-field">
                出点（ms）
                <input
                  className="media-out-input"
                  value={mediaDraft?.outMsText ?? ""}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      outMsText: event.target.value,
                    })
                  }
                />
              </label>
              <span className="media-span-note">
                片段时长{" "}
                {Math.max(
                  (Number(mediaDraft?.outMsText) || 0) -
                    (Number(mediaDraft?.inMsText) || 0),
                  0,
                )}
                ms（出点−入点，出片同长）
              </span>
              <label className="shot-edit-field">
                画面适配
                <select
                  className="media-fit-select"
                  value={mediaDraft?.fit ?? "cover"}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      fit:
                        event.target.value === "contain" ? "contain" : "cover",
                    })
                  }
                >
                  <option value="cover">cover（裁切铺满）</option>
                  <option value="contain">contain（完整留边）</option>
                </select>
              </label>
              <label className="shot-edit-field">
                注视点（%，cover 横向裁切时生效）
                <input
                  className="media-focal-input"
                  value={mediaDraft?.focalPercentText ?? ""}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      focalPercentText: event.target.value,
                    })
                  }
                />
              </label>
              <label className="shot-edit-field">
                原声
                <select
                  className="media-audio-select"
                  value={mediaDraft?.audio ?? "mute"}
                  onChange={(event) =>
                    setMediaDraft({
                      ...(mediaDraft ?? EMPTY_MEDIA_DRAFT),
                      audio: event.target.value === "keep" ? "keep" : "mute",
                    })
                  }
                >
                  <option value="mute">静音（预览/出片均不带原声）</option>
                  <option value="keep">保留（出片与旁白混音，T4 兑现）</option>
                </select>
              </label>
              {mediaWarnings.map((warning) => (
                <p key={warning} className="media-warning" role="status">
                  {warning}
                </p>
              ))}
              {mediaError ? (
                <p className="shot-edit-error">{mediaError}</p>
              ) : null}
            </>
          )}
          {editError ? <p className="shot-edit-error">{editError}</p> : null}
          <div className="shot-edit-actions">
            <button
              type="button"
              className="shot-apply"
              onClick={() => {
                // 媒体臂（第七族）：校验/预警全走 media-clip-templates 纯逻辑；
                // 旁白沿用共享草稿，非法不回调（与 spec 臂同一纪律）。
                if (editingMedia) {
                  if (!mediaDraft) {
                    setMediaError("项目尚无媒体素材，请先在素材面板上传");
                    return;
                  }
                  const built = buildMediaRevisePatch(
                    mediaDraft,
                    mediaAssets,
                    draft.narrationText,
                  );
                  if (built.error || !built.patch) {
                    setMediaError(built.error ?? "媒体字段无效");
                    return;
                  }
                  const attached = attachDescription(
                    built.patch,
                    draft.description,
                  );
                  if ("error" in attached) {
                    setEditError(attached.error);
                    setMediaError(null);
                    return;
                  }
                  setMediaError(null);
                  setMediaWarnings(built.warnings);
                  setEditError(null);
                  onRevise(attached.patch);
                  return;
                }
                // 3D 臂（Ruling 11/4）：只换场景源；旁白沿用共享草稿。时长
                // 走与 spec 臂同一份共享草稿（零帧 3D 镜头也要能改回可出片
                // 时长），场景源仍是 three，不借模板 spec 绕时长。
                if (editingThree) {
                  const duration = draftDurationMs(draft);
                  if ("error" in duration) {
                    setEditError(duration.error);
                    return;
                  }
                  const built = buildThreeSceneVersion({
                    durationMs: duration.durationMs,
                    seed: spec?.seed ?? threeSource?.spec.seed ?? 1,
                    params: threeSource?.spec.params,
                  });
                  const attached = attachDescription(
                    {
                      narrationText: draft.narrationText,
                      threeScene: built.spec,
                    },
                    draft.description,
                  );
                  if ("error" in attached) {
                    setEditError(attached.error);
                    return;
                  }
                  // 与 spec 臂同口径的零帧闸门：存量零帧改好即放行。
                  const blocked = durationApplyError(durationImpact);
                  if (blocked) {
                    setEditError(blocked);
                    return;
                  }
                  setEditError(null);
                  onRevise(attached.patch);
                  return;
                }
                // 换模板 = 以模板 spec 为基底；与同草稿的并发编辑（旁白/背景/
                // 时长 + 图表/地图/流程/火柴人/手绘/加载数据——选中模板时已
                // 预填该模板默认值）一次应用一并落库，不静默丢弃（终评 I1
                // 合并语义）。
                let baseSpec = editSpec;
                if (pendingTemplateId) {
                  const applied = resolveAnyTemplate(
                    editSpec,
                    pendingTemplateId,
                  );
                  if (applied.error || !applied.spec) {
                    setEditError(applied.error ?? "模板无效");
                    return;
                  }
                  baseSpec = applied.spec;
                }
                const chartResult = isChartComponentId(baseSpec.componentId)
                  ? buildChartRevisePatch(baseSpec, chartDraft)
                  : null;
                if (chartResult && (chartResult.error || !chartResult.spec)) {
                  setChartError(chartResult.error ?? "图表数据无效");
                  return;
                }
                const mapResult = isMapComponentId(
                  (chartResult?.spec ?? baseSpec).componentId,
                )
                  ? buildMapRevisePatch(chartResult?.spec ?? baseSpec, mapDraft)
                  : null;
                if (mapResult && (mapResult.error || !mapResult.spec)) {
                  setMapError(mapResult.error ?? "地图数据无效");
                  return;
                }
                const flowResult = isFlowComponentId(
                  (mapResult?.spec ?? chartResult?.spec ?? baseSpec)
                    .componentId,
                )
                  ? buildFlowRevisePatch(
                      mapResult?.spec ?? chartResult?.spec ?? baseSpec,
                      flowDraft,
                    )
                  : null;
                if (flowResult && (flowResult.error || !flowResult.spec)) {
                  setFlowError(flowResult.error ?? "流程数据无效");
                  return;
                }
                const stickResult = isStickComponentId(
                  (
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildStickRevisePatch(
                      flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      stickDraft,
                    )
                  : null;
                if (stickResult && (stickResult.error || !stickResult.spec)) {
                  setStickError(stickResult.error ?? "火柴人数据无效");
                  return;
                }
                const sketchResult = isSketchComponentId(
                  (
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildSketchRevisePatch(
                      stickResult?.spec ??
                        flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      sketchDraft,
                    )
                  : null;
                if (
                  sketchResult &&
                  (sketchResult.error || !sketchResult.spec)
                ) {
                  setSketchError(sketchResult.error ?? "手绘数据无效");
                  return;
                }
                const loadingResult = isLoadingComponentId(
                  (
                    sketchResult?.spec ??
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec
                  ).componentId,
                )
                  ? buildLoadingRevisePatch(
                      sketchResult?.spec ??
                        stickResult?.spec ??
                        flowResult?.spec ??
                        mapResult?.spec ??
                        chartResult?.spec ??
                        baseSpec,
                      loadingDraft,
                    )
                  : null;
                if (
                  loadingResult &&
                  (loadingResult.error || !loadingResult.spec)
                ) {
                  setLoadingError(loadingResult.error ?? "加载数据无效");
                  return;
                }
                const { patch, error } = buildRevisePatch(
                  draft,
                  loadingResult?.spec ??
                    sketchResult?.spec ??
                    stickResult?.spec ??
                    flowResult?.spec ??
                    mapResult?.spec ??
                    chartResult?.spec ??
                    baseSpec,
                );
                if (error || !patch) {
                  setEditError(error ?? "草稿无效");
                  return;
                }
                // 画幅微调并入（2026-10-23）：在最终 spec（含模板/图表链产物）
                // 上应用 layout 草稿；换模板换家族时静默不并入（草稿已清空，
                // 此处是兜底）。错误显示在画幅微调区块内，不落库。
                let reviseSpec: unknown = patch.spec;
                if (layoutDraft) {
                  const finalSpec =
                    (patch.spec as SceneSpec | undefined) ?? editSpec;
                  if (
                    finalSpec &&
                    (finalSpec.componentId === "text-animation" ||
                      finalSpec.componentId === "line-chart") &&
                    finalSpec.componentId === layoutDraft.componentId
                  ) {
                    const appliedLayout = applyLayoutToSpec(
                      finalSpec,
                      layoutDraft,
                    );
                    if ("error" in appliedLayout) {
                      setLayoutError(appliedLayout.error);
                      return;
                    }
                    reviseSpec = appliedLayout.spec;
                  }
                }
                // 零帧时长必须挡在 onRevise 之前：否则下一次渲染
                // quantizeTimeline 抛 ZeroFrameShotError，整页崩溃丢草稿。
                const blocked = durationApplyError(durationImpact);
                if (blocked) {
                  setEditError(blocked);
                  return;
                }
                setEditError(null);
                setChartError(null);
                setMapError(null);
                setFlowError(null);
                setStickError(null);
                setSketchError(null);
                setLoadingError(null);
                setLayoutError(null);
                const attached = attachDescription(
                  { ...patch, spec: reviseSpec },
                  draft.description,
                );
                if ("error" in attached) {
                  setEditError(attached.error);
                  return;
                }
                onRevise(attached.patch);
              }}
            >
              应用修订
            </button>
            <button
              type="button"
              className="shot-cancel"
              onClick={() => {
                setDraft(
                  draftFromWorking(
                    {
                      narrationText: working.narrationText,
                      durationMs: working.durationMs,
                      description: working.description,
                    },
                    editSpec,
                  ),
                );
                setEditError(null);
                setLayoutError(null);
                setLayoutDraft(
                  editSpec && layoutEditable
                    ? layoutDraftFromSpec(editSpec)
                    : null,
                );
              }}
            >
              取消
            </button>
          </div>
          <div className="shot-redo-row">
            <input
              className="shot-redo-input"
              placeholder="重做指令：做一个10秒的图形动画，标题是…"
              value={directive}
              onChange={(event) => setDirective(event.target.value)}
            />
            <button
              type="button"
              className="shot-redo-button"
              disabled={directive.trim().length === 0}
              onClick={() => onRedo(directive)}
            >
              重做此镜头
            </button>
          </div>
          {redoError ? <p className="shot-redo-error">{redoError}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
