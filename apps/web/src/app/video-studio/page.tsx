"use client";

import {
  addCandidateVersion,
  type QuantizedTimeline,
  quantizeTimeline,
  reviseWorkingVersion,
  rollbackWorkingVersion,
  ShotLockedError,
  setLocked,
  type VideoProject,
} from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyPlan,
  applyStoryboard,
  describeStoryboardAppend,
} from "./apply-plan";
import {
  importVideoProject,
  listVideoProjects,
  openVideoProject,
  saveVideoProject,
  type VideoProjectSummary,
} from "./local-video-projects";
import {
  isStoryboardSentence,
  type PlanResult,
  planFromSentence,
  planStoryboard,
  type StoryboardResult,
  specSummary,
} from "./planner";
import { exportFileName, parseProjectJson } from "./project-io";
import {
  ScenePreview,
  TimelinePreview,
  type TimelinePreviewItem,
} from "./scene-preview";
import { ShotEditorCard } from "./shot-editor-card";
import { shotWorkingSpec } from "./shot-specs";
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

export default function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  // 分镜编辑器：单镜头重做的失败文案按 shotId 存（锁定/句式不合等），
  // 修订/回滚/锁定的结果走 editor.message。
  const [redoErrors, setRedoErrors] = useState<Record<string, string | null>>(
    {},
  );
  const importInputRef = useRef<HTMLInputElement>(null);

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
    // 镜头时间线（量化帧图 @24fps）：镜头卡 + 时间条 + 整片预览共用。
    // spec 解析走 shotWorkingSpec：unknown → validateSceneSpec，非法（导入件来自
    // 更新版本/手改）降级 null 走「不可预览」提示，不在渲染期抛错炸整页。
    const shotSpecs = document.shots.map((shot) => shotWorkingSpec(shot));
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
    if (
      document.shots.length > 0 &&
      durations.every((duration) => duration > 0) &&
      shotSpecs.every((spec) => spec !== null)
    ) {
      pieceTimeline = quantizeTimeline(durations, 24);
      pieceItems = shotSpecs.map((spec, index) => ({
        spec: spec as SceneSpec,
        startFrame: pieceTimeline!.shots[index]!.startFrame,
        frames: pieceTimeline!.shots[index]!.frames,
        narrationText: workingMeta[index]!.narrationText,
      }));
    }
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
            onClick={() => {
              setEditor(null);
              refreshProjects().catch(() => {});
            }}
          >
            返回列表
          </button>
        </header>
        <section className="editor-pane">
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
                disabled={busy || sentence.trim().length === 0}
                onClick={() => {
                  const trimmed = sentence.trim();
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
            </div>
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
              <ol className="plan-shot-list">
                {storyboard.shots.map((shot, index) => (
                  <li key={index} className="plan-shot-item">
                    <span className="plan-shot-label">
                      {index + 1}. {shot.label} ·{" "}
                      {shot.plan.spec.durationMs / 1000}s
                    </span>
                    <span className="plan-shot-hint">
                      {shot.plan.renderHint}
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
                  onClick={() => {
                    // P1：分镜应用 = 在当前项目上只追加 N 个镜头
                    const applied = applyStoryboard(document, storyboard, {
                      shot: () => crypto.randomUUID(),
                      version: () => crypto.randomUUID(),
                    });
                    setEditor({
                      document: applied.document,
                      message: applied.notice,
                      busy: false,
                      sentence,
                      plan: null,
                      storyboard: null,
                    });
                  }}
                >
                  确认应用（追加 {storyboard.shots.length} 个镜头）
                </button>
                <button
                  type="button"
                  className="plan-discard"
                  onClick={() =>
                    setEditor({ ...editor, storyboard: null, message: null })
                  }
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
                  onClick={() => {
                    // P2-B：空项目 = 首次规划落当前文档；已有镜头 = 明示另存为新项目
                    const applied = applyPlan(document, sentence.trim(), plan, {
                      project: crypto.randomUUID(),
                      shot: crypto.randomUUID(),
                      version: crypto.randomUUID(),
                    });
                    setEditor({
                      document: applied.document,
                      message: applied.notice,
                      busy: false,
                      sentence: sentence,
                      plan: null,
                      storyboard: null,
                    });
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

          {document.shots.length > 0 && pieceTimeline && pieceItems ? (
            <section className="editor-shots">
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
              <ol className="shot-list">
                {document.shots.map((shot, index) => (
                  <ShotEditorCard
                    key={shot.shotId}
                    shot={shot}
                    index={index}
                    frames={pieceTimeline!.shots[index]!.frames}
                    editable={shotSpecs[index] !== null}
                    redoError={redoErrors[shot.shotId] ?? null}
                    onRevise={(patch) => {
                      try {
                        const next = reviseWorkingVersion(
                          document,
                          shot.shotId,
                          patch,
                          crypto.randomUUID(),
                        );
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
                    onRedo={(directive) => {
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
                        const next = addCandidateVersion(
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
                    onRollback={(versionId) => {
                      try {
                        const next = rollbackWorkingVersion(
                          document,
                          shot.shotId,
                          versionId,
                        );
                        setEditor({
                          ...editor,
                          document: next,
                          message: `镜头 ${index + 1} 已回滚到所选版本`,
                        });
                      } catch (error) {
                        setEditor({
                          ...editor,
                          message:
                            error instanceof Error ? error.message : "回滚失败",
                        });
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
              <TimelinePreview items={pieceItems} timeline={pieceTimeline} />
            </section>
          ) : document.shots.length > 0 ? (
            <p className="editor-hint">
              镜头含非 spec 场景源或时长缺失，整片预览不可用。
            </p>
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
                message: `已导出 ${anchor.download}。CLI 出片：node scripts/video/render-scene.mjs --project <导出件> --out <目录>，完成后回列表页「导入项目 JSON」`,
              });
            }}
          >
            导出项目 JSON
          </button>
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
        </section>
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
        <div className="project-toolbar">
          <h2>本地项目</h2>
          <button
            type="button"
            className="project-create"
            onClick={() =>
              setEditor({
                document: createEmptyVideoProject(),
                message: null,
                busy: false,
                sentence: "",
                plan: null,
                storyboard: null,
              })
            }
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
