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
import "./video-studio.css";

// 新项目从空镜头开始（validateVideoProject 允许 shots 为空数组）；
// 第一个镜头由 Task 9 的规划器写入，这里不造占位 spec。
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
    const { document, message, busy } = editor;
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
          <p className="editor-hint">
            规划器与预览在下一步接入；当前可改标题并保存到本地。
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
                        setEditor({ document, message: null, busy: false });
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
