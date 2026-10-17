"use client";

import type { VideoProject } from "@acs/video-document";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  listVideoProjects,
  openVideoProject,
  saveVideoProject,
  type VideoProjectSummary,
} from "./local-video-projects";
import { type PlanResult, planFromSentence, specSummary } from "./planner";
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

const COMPONENT_LABEL: Record<string, string> = {
  "text-animation": "文字",
  "line-drawing": "线描",
  "basic-shapes": "图形",
};

// 确认环落地：按 operations.test.ts 的 baseProject 结构直接构造初始文档
// （首镜头 = 初始内容版本 + submitted(human) 事件，workingVersionId 指向它；
// 不用 addCandidateVersion——它作用于已存在的镜头）。
function projectFromPlan(
  sentence: string,
  plan: Extract<PlanResult, { ok: true }>,
): VideoProject {
  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();
  const label = COMPONENT_LABEL[plan.spec.componentId] ?? plan.spec.componentId;
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: plan.title,
    brief: { sentence, aspectTargets: ["landscape", "portrait"] },
    shots: [
      {
        shotId: crypto.randomUUID(),
        order: 0,
        locked: false,
        workingVersionId: versionId,
        contentVersions: [
          {
            versionId,
            createdAt: now,
            durationMs: plan.spec.durationMs,
            description: `${label}动画：${plan.title}`,
            narrationText: "",
            sceneSource: { type: "spec", spec: plan.spec },
            provenance: { engineId: "planner-rules", engineVersion: "1" },
          },
        ],
        events: [{ kind: "submitted", versionId, at: now, actor: "human" }],
      },
    ],
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
                  onClick={() =>
                    setEditor({
                      document: projectFromPlan(sentence.trim(), plan),
                      message: "已应用规划，确认无误后点「保存」",
                      busy: false,
                      sentence: sentence,
                      plan: null,
                    })
                  }
                >
                  确认应用
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
          {message ? <p className="editor-message">{message}</p> : null}
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
        </div>
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
