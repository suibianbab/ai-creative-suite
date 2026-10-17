"use client";

import type { VideoProject } from "@acs/video-document";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyPlan } from "./apply-plan";
import {
  importVideoProject,
  listVideoProjects,
  openVideoProject,
  saveVideoProject,
  type VideoProjectSummary,
} from "./local-video-projects";
import { type PlanResult, planFromSentence, specSummary } from "./planner";
import { exportFileName, parseProjectJson } from "./project-io";
import { ScenePreview } from "./scene-preview";
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
};

export default function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await listVideoProjects());
  }, []);

  useEffect(() => {
    refreshProjects().catch((error: unknown) =>
      console.error("视频项目列表读取失败", error),
    );
  }, [refreshProjects]);

  if (editor) {
    const { document, message, busy, sentence, plan } = editor;
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
                placeholder="做一个12秒的文字动画，标题是云制作，副标题是Video Studio"
                onChange={(event) =>
                  setEditor({ ...editor, sentence: event.target.value })
                }
              />
              <button
                type="button"
                className="planner-run"
                disabled={busy || sentence.trim().length === 0}
                onClick={() =>
                  setEditor({
                    ...editor,
                    plan: planFromSentence(sentence.trim()),
                    message: null,
                  })
                }
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
            规划器只认固定句式，解析失败会把语法原样告诉你；确认应用后生成首个镜头。
          </p>
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
