"use client";

import {
  applyStyleBible,
  type StyleBible,
  type StyleBibleVersion,
  type VideoProject,
  validateStyleBible,
} from "@acs/video-document";
import { useEffect, useRef, useState } from "react";
import { openStyleBible, saveStyleBible } from "./local-video-projects";

const DEFAULT_PALETTE: StyleBibleVersion["palette"] = {
  background: "#101820",
  foreground: "#f3e6cf",
  secondary: "#e8b04b",
  accent: "#e8b04b",
  object: "#c98548",
};
const PALETTE_LABELS: Record<keyof StyleBibleVersion["palette"], string> = {
  background: "背景",
  foreground: "主文字",
  secondary: "辅助文字/浅色块",
  accent: "强调",
  object: "主体/线条",
};

function downloadBible(bible: StyleBible) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(bible, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bible.id}.style-bible.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StyleBiblePanel({
  project,
  onApply,
}: {
  project: VideoProject;
  onApply: (next: VideoProject, message: string) => void;
}) {
  const [record, setRecord] =
    useState<Awaited<ReturnType<typeof openStyleBible>>>(null);
  const [draft, setDraft] =
    useState<StyleBibleVersion["palette"]>(DEFAULT_PALETTE);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const bibleId = project.styleBibleRef?.bibleId;

  useEffect(() => {
    if (!bibleId) {
      setRecord(null);
      return;
    }
    openStyleBible(bibleId)
      .then((found) => {
        setRecord(found);
        if (found) {
          const version = found.document.versions.find(
            (item) => item.versionId === project.styleBibleRef?.versionId,
          );
          if (version) {
            setDraft(version.palette);
            setSelected(version.versionId);
          }
        }
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "风格规范读取失败"),
      );
  }, [bibleId, project.styleBibleRef?.versionId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "风格规范操作失败");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (bible: StyleBible, versionId: string) => {
    const next = await applyStyleBible(project, bible, versionId);
    onApply(
      next,
      `已应用 Style Bible 版本 ${bible.versions.find((item) => item.versionId === versionId)?.name}；镜头改动已作为新内容版本，点「保存」持久化项目`,
    );
    setSelected(versionId);
  };

  return (
    <section className="style-bible-panel" aria-label="Style Bible 风格规范">
      <h3>Style Bible · 统一视觉风格</h3>
      <p>
        当前支持程序化文字与 3D 镜头的配色。字体固定为 NotoSansSC；3D 灯光固定为
        orbit3d@1 柔光预设。
      </p>
      {bibleId && !record ? (
        <p>本地缺少所引用的独立风格记录，请先导入相应 JSON。</p>
      ) : null}
      <div className="style-bible-colors">
        {(
          Object.keys(PALETTE_LABELS) as Array<
            keyof StyleBibleVersion["palette"]
          >
        ).map((key) => (
          <label key={key}>
            {PALETTE_LABELS[key]}
            <input
              type="color"
              value={draft[key]}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      {!record ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const versionId = crypto.randomUUID();
              const bible: StyleBible = {
                schemaVersion: 1,
                id: crypto.randomUUID(),
                currentVersionId: versionId,
                versions: [
                  {
                    versionId,
                    createdAt: new Date().toISOString(),
                    name: "初始风格",
                    palette: draft,
                    fontFamily: "NotoSansSC",
                    lightingPreset: "orbit3d-fixed-soft-studio",
                  },
                ],
              };
              const next = await applyStyleBible(project, bible, versionId);
              const saved = await saveStyleBible(bible);
              setRecord(saved);
              onApply(
                next,
                "Style Bible 已创建并应用；请保存项目，并导出风格规范 JSON 供 CLI 使用",
              );
            })
          }
        >
          创建并应用风格规范
        </button>
      ) : (
        <>
          <label>
            选用已有版本
            <select
              value={selected}
              disabled={busy}
              onChange={(event) => {
                const id = event.target.value;
                setSelected(id);
                const version = record.document.versions.find(
                  (item) => item.versionId === id,
                );
                if (version) setDraft(version.palette);
              }}
            >
              {record.document.versions.map((item, index) => (
                <option key={item.versionId} value={item.versionId}>
                  v{index + 1} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() =>
              run(async () => {
                const bible = {
                  ...record.document,
                  currentVersionId: selected,
                };
                const next = await applyStyleBible(project, bible, selected);
                const saved = await saveStyleBible(bible, record.revision);
                setRecord(saved);
                onApply(
                  next,
                  `已切换并应用风格版本 v${bible.versions.findIndex((item) => item.versionId === selected) + 1}；请保存项目`,
                );
              })
            }
          >
            切换并应用选中版本
          </button>
          <label className="derive-note-field">
            派生说明（选填，填写即标记为派生版本）
            <input
              className="derive-note-input"
              value={note}
              maxLength={200}
              placeholder="例如：把 secondary 换成暖木色"
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="bible-derive"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const versionId = crypto.randomUUID();
                const source = record.document.versions.find(
                  (item) => item.versionId === selected,
                );
                const noteValue = note.trim();
                const bible: StyleBible = {
                  ...record.document,
                  currentVersionId: versionId,
                  versions: [
                    ...record.document.versions,
                    {
                      versionId,
                      createdAt: new Date().toISOString(),
                      name: `风格版本 ${record.document.versions.length + 1}`,
                      palette: draft,
                      fontFamily: "NotoSansSC",
                      lightingPreset: "orbit3d-fixed-soft-studio",
                      // W2 派生：从当前选中版本派生并记录改动说明；旧项目
                      // 引用旧版本不受影响（版本不可变，digest 随之更新）。
                      ...(source && noteValue
                        ? {
                            derivedFrom: {
                              versionId: source.versionId,
                              note: noteValue,
                            },
                          }
                        : {}),
                    },
                  ],
                };
                const next = await applyStyleBible(project, bible, versionId);
                const saved = await saveStyleBible(bible, record.revision);
                setRecord(saved);
                setNote("");
                onApply(
                  next,
                  `风格版本 v${bible.versions.length} 已保存并应用${source && noteValue ? "（派生自已选版本）" : ""}；请保存项目及导出新版风格 JSON`,
                );
              })
            }
          >
            将当前颜色保存为（派生）新版本并应用
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => downloadBible(record.document)}
          >
            导出风格规范 JSON
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => importRef.current?.click()}
      >
        导入风格规范 JSON
      </button>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void run(async () => {
            const bible = validateStyleBible(JSON.parse(await file.text()));
            const stored = await openStyleBible(bible.id);
            const saved = await saveStyleBible(bible, stored?.revision ?? 0);
            setRecord(saved);
            const selectedVersion =
              bible.versions.find(
                (item) => item.versionId === project.styleBibleRef?.versionId,
              ) ??
              bible.versions.find(
                (item) => item.versionId === bible.currentVersionId,
              )!;
            setSelected(selectedVersion.versionId);
            setDraft(selectedVersion.palette);
            setMessage(
              `已导入独立风格规范 ${bible.id}，共 ${bible.versions.length} 个版本`,
            );
          });
        }}
      />
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
