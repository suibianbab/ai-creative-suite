"use client";

import type { Shot } from "@acs/video-document";
import { useEffect, useState } from "react";
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
// 校验全走 shot-edit.ts 纯逻辑，非法草稿不回调。

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

  // working 版本变了（应用修订/重做/回滚后）→ 草稿重置到新工作版本。
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
  }, [shot.workingVersionId, shot]);

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
                const { patch, error } = buildRevisePatch(draft, spec);
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
