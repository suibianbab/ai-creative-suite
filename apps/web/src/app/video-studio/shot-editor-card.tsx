"use client";

import type { Shot } from "@acs/video-document";
import { useEffect, useState } from "react";
import {
  applyChartTemplate,
  buildChartRevisePatch,
  CHART_TEMPLATES,
  type ChartEditDraft,
  draftChartFromSpec,
  isChartComponentId,
} from "./chart-templates";
import { LINE_TEMPLATE_LABELS, SHAPE_TEMPLATE_LABELS } from "./planner";
import {
  buildRevisePatch,
  draftFromWorking,
  type ShotEditDraft,
  speechOverflowMs,
} from "./shot-edit";
import { shotWorkingSpec } from "./shot-specs";

// 分镜编辑器镜头卡：只读信息 + 展开式编辑（旁白/画面修订、单镜头重做、
// 版本回滚、锁定）。草稿是本地状态，点「应用修订」才经回调落文档；
// 校验全走 shot-edit.ts / chart-templates.ts 纯逻辑，非法草稿不回调。

const EMPTY_CHART_DRAFT: ChartEditDraft = {
  title: "",
  data: "",
  value: "",
  prefix: "",
  suffix: "",
};

export type ShotEditorCardProps = {
  shot: Shot;
  index: number;
  frames: number;
  // shotWorkingSpec 降级（非 spec 场景源/非法 spec）时 false → 只读卡。
  editable: boolean;
  onRevise: (patch: { narrationText?: string; spec?: unknown }) => void;
  onRedo: (directive: string) => void;
  onRollback: (versionId: string) => void;
  onToggleLock: (locked: boolean) => void;
  redoError: string | null;
};

export function ShotEditorCard({
  shot,
  index,
  frames,
  editable,
  onRevise,
  onRedo,
  onRollback,
  onToggleLock,
  redoError,
}: ShotEditorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  const spec = shotWorkingSpec(shot);
  const canEdit = editable && working !== undefined && spec !== null;

  const [draft, setDraft] = useState<ShotEditDraft>(() =>
    working && spec
      ? draftFromWorking(
          {
            narrationText: working.narrationText,
            durationMs: working.durationMs,
          },
          spec,
        )
      : {
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
  const [pendingTemplateId, setPendingTemplateId] = useState("");
  const [chartDraft, setChartDraft] = useState<ChartEditDraft>(() =>
    spec && isChartComponentId(spec.componentId)
      ? draftChartFromSpec(spec)
      : EMPTY_CHART_DRAFT,
  );
  const [chartError, setChartError] = useState<string | null>(null);

  // working 版本变了（应用修订/重做/回滚后）→ 草稿重置到新工作版本。
  // 只盯 workingVersionId（终评整改）：锁定切换会换 shot 对象身份但不动
  // working 版本，不得清掉进行中的编辑草稿。
  useEffect(() => {
    setSelectedVersion(shot.workingVersionId);
    const nextWorking = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const nextSpec = shotWorkingSpec(shot);
    if (nextWorking && nextSpec) {
      setDraft(
        draftFromWorking(
          {
            narrationText: nextWorking.narrationText,
            durationMs: nextWorking.durationMs,
          },
          nextSpec,
        ),
      );
      setEditError(null);
    }
    setPendingTemplateId("");
    setChartError(null);
    setChartDraft(
      nextSpec && isChartComponentId(nextSpec.componentId)
        ? draftChartFromSpec(nextSpec)
        : EMPTY_CHART_DRAFT,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖收紧是有意的（见上注）
  }, [shot.workingVersionId]);

  const overflowMs = canEdit ? speechOverflowMs(draft) : 0;
  const templateLabels =
    spec?.componentId === "line-drawing"
      ? LINE_TEMPLATE_LABELS
      : spec?.componentId === "basic-shapes"
        ? SHAPE_TEMPLATE_LABELS
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
        {working ? `${working.durationMs / 1000}s` : ""} · {frames} 帧
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
        onClick={() => onRollback(selectedVersion)}
      >
        回滚到此版本
      </button>
      {expanded && canEdit && spec ? (
        <div className="shot-edit-form">
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
          {spec.componentId === "text-animation" ? (
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
                onClick={() => setDraft({ ...draft, templateAdvanced: true })}
                disabled={draft.templateAdvanced}
              >
                换一枚模板
              </button>
              <span className="shot-template-note">
                当前第 {(spec.seed % templateLabels.length) + 1} /
                {templateLabels.length} 枚
                {draft.templateAdvanced
                  ? ` → 换成第 ${((spec.seed + 1) % templateLabels.length) + 1} 枚`
                  : ""}
              </span>
            </span>
          ) : null}
          <label className="shot-edit-field">
            组件模板（换成图表）
            <select
              className="chart-template-select"
              value={pendingTemplateId}
              onChange={(event) => {
                const templateId = event.target.value;
                setPendingTemplateId(templateId);
                setChartError(null);
                if (!templateId) return;
                const applied = applyChartTemplate(spec, templateId);
                if (applied.error || !applied.spec) {
                  setChartError(applied.error ?? "模板无效");
                  return;
                }
                // 选中即预填该模板数据到编辑字段（应用时才落文档）
                setChartDraft(draftChartFromSpec(applied.spec));
              }}
            >
              <option value="">— 保持当前组件 —</option>
              {CHART_TEMPLATES.map((template) => (
                <option key={template.templateId} value={template.templateId}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          {isChartComponentId(spec.componentId) ? (
            <>
              <label className="shot-edit-field">
                图表标题
                <input
                  className="chart-title-input"
                  maxLength={40}
                  value={chartDraft.title}
                  onChange={(event) =>
                    setChartDraft({ ...chartDraft, title: event.target.value })
                  }
                />
              </label>
              {spec.componentId === "number-counter" ? (
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
                  {spec.componentId === "line-chart" ? "，折线可只写数值" : ""}
                  ）
                  <textarea
                    className="chart-data-input"
                    rows={6}
                    value={chartDraft.data}
                    onChange={(event) =>
                      setChartDraft({ ...chartDraft, data: event.target.value })
                    }
                  />
                </label>
              )}
              {chartError ? (
                <p className="chart-edit-error">{chartError}</p>
              ) : null}
            </>
          ) : null}
          {overflowMs > 0 ? (
            <span className="shot-overflow-note">
              旁白按语速需{" "}
              {(
                (Math.round(draft.durationSeconds * 1000) + overflowMs) /
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
                      (Math.round(draft.durationSeconds * 1000) + overflowMs) /
                      1000,
                  })
                }
              >
                按语速对齐
              </button>
            </span>
          ) : null}
          {editError ? <p className="shot-edit-error">{editError}</p> : null}
          <div className="shot-edit-actions">
            <button
              type="button"
              className="shot-apply"
              onClick={() => {
                // 换模板优先：纯 spec 修订（旁白/时长保持文档现值，二次应用可再改）
                if (pendingTemplateId) {
                  const applied = applyChartTemplate(spec, pendingTemplateId);
                  if (applied.error || !applied.spec) {
                    setEditError(applied.error ?? "模板无效");
                    return;
                  }
                  setEditError(null);
                  setChartError(null);
                  onRevise({ spec: applied.spec });
                  return;
                }
                // 图表数据编辑先合入 spec，再走既有 narration/背景/时长门
                const chartResult = isChartComponentId(spec.componentId)
                  ? buildChartRevisePatch(spec, chartDraft)
                  : null;
                if (chartResult && (chartResult.error || !chartResult.spec)) {
                  setChartError(chartResult.error ?? "图表数据无效");
                  return;
                }
                const { patch, error } = buildRevisePatch(
                  draft,
                  chartResult?.spec ?? spec,
                );
                if (error || !patch) {
                  setEditError(error ?? "草稿无效");
                  return;
                }
                setEditError(null);
                onRevise(patch);
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
                    },
                    spec,
                  ),
                );
                setEditError(null);
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
