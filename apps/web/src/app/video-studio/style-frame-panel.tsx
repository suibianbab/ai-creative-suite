"use client";

// W2 风格代表帧确认面板：选镜头与时间点 → 真实渲染器出横竖关键帧 →
// 人工显式确认。确认记录经 appendStyleFrameConfirmation 绑定不可变版本
// 与摘要后追加进项目（点「保存」落库）；出片路由按确认状态放行。
import {
  appendStyleFrameConfirmation,
  type StyleConfirmationStatus,
  styleConfirmationStatus,
  type VideoProject,
} from "@acs/video-document";
import { useEffect, useState } from "react";
import { openStyleBible } from "./local-video-projects";
import {
  confirmationBlockSignature,
  describeConfirmationStatus,
} from "./style-frame-panel-state";

type GeneratedFrames = {
  frameId: string;
  frameIndex: number;
  keyframes: Array<{
    aspect: "landscape" | "portrait";
    url: string;
    digest: string;
    bytes: number;
    outputRef: string;
  }>;
  signature: string;
};

const SOURCE_LABEL: Record<string, string> = {
  spec: "",
  three: "（3D 镜头，暂不支持）",
  "media-clip": "（媒体镜头，暂不支持）",
  "editor-binding": "（外部编辑器镜头，暂不支持）",
};

export function StyleFramePanel({
  project,
  onApply,
}: {
  project: VideoProject;
  onApply: (next: VideoProject, message: string) => void;
}) {
  const specShots = project.shots.filter((shot) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    return working?.sceneSource.type === "spec";
  });
  const [shotId, setShotId] = useState(specShots[0]?.shotId ?? "");
  const [frameMsText, setFrameMsText] = useState("500");
  const [generated, setGenerated] = useState<GeneratedFrames | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<StyleConfirmationStatus | null>(null);
  const signature = confirmationBlockSignature(project);

  // 状态是推导出来的：项目一变（含保存/导入回来的新对象）就重算。
  useEffect(() => {
    let cancelled = false;
    styleConfirmationStatus(project)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "确认状态计算失败"),
      );
    return () => {
      cancelled = true;
    };
  }, [project, signature]);

  const selected = specShots.find((shot) => shot.shotId === shotId);
  const working = selected?.contentVersions.find(
    (version) => version.versionId === selected.workingVersionId,
  );
  const frameMs = Number.parseInt(frameMsText, 10);
  const frameMsValid =
    working !== undefined &&
    Number.isInteger(frameMs) &&
    frameMs >= 0 &&
    frameMs < working.durationMs;
  const generatedMatchesProject =
    generated !== null && generated.signature === signature;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      if (!project.styleBibleRef)
        throw new Error("项目未链接 Style Bible，请先在上方创建并应用风格");
      if (!selected || !working || !frameMsValid)
        throw new Error("请选择程序化画面镜头，并填写 0 到时长内的帧时间");
      const record = await openStyleBible(project.styleBibleRef.bibleId);
      if (!record)
        throw new Error(
          "本地缺少所引用的独立风格记录，请先导入 Style Bible JSON",
        );
      const response = await fetch("/api/video/style-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          styleBible: record.document,
          shotId,
          frameMs,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "关键帧生成失败");
      setGenerated({ ...payload, signature });
      setStatus(null); // 生成后等待确认；状态行由确认动作刷新
    });

  const confirm = () =>
    run(async () => {
      if (!generated || !generatedMatchesProject)
        throw new Error("项目内容已变更，请重新生成关键帧后再确认");
      const next = await appendStyleFrameConfirmation(project, {
        shotId,
        frameMs,
        keyframes: generated.keyframes.map((frame) => ({
          aspect: frame.aspect,
          digest: frame.digest,
          bytes: frame.bytes,
          outputRef: frame.outputRef,
        })),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      setGenerated(null);
      setNote("");
      onApply(
        next,
        "风格代表帧已确认：请点「保存」持久化项目，确认在内容或风格再次变更前持续有效",
      );
    });

  if (!project.styleBibleRef) return null;

  return (
    <section className="style-frame-panel" aria-label="风格代表帧确认">
      <h3>风格代表帧确认</h3>
      <p>
        从程序化镜头选一时间点，用与出片同一渲染器生成横竖关键帧，人工确认后才能导出。
        修改任何镜头、转场或风格版本后，旧确认自动失效，需重新确认。
      </p>
      <label>
        代表帧镜头
        <select
          className="style-frame-shot"
          value={shotId}
          disabled={busy}
          onChange={(event) => {
            setShotId(event.target.value);
            setGenerated(null);
          }}
        >
          {project.shots.map((shot, index) => {
            const shotWorking = shot.contentVersions.find(
              (version) => version.versionId === shot.workingVersionId,
            );
            return (
              <option
                key={shot.shotId}
                value={shot.shotId}
                disabled={shotWorking?.sceneSource.type !== "spec"}
              >
                镜头 {index + 1}
                {SOURCE_LABEL[shotWorking?.sceneSource.type ?? ""] ?? ""}
              </option>
            );
          })}
        </select>
      </label>
      {working ? (
        <label>
          帧时间（毫秒，0..{working.durationMs - 1}）
          <input
            className="style-frame-ms"
            type="number"
            min={0}
            max={working.durationMs - 1}
            step={100}
            value={frameMsText}
            disabled={busy}
            onChange={(event) => {
              setFrameMsText(event.target.value);
              setGenerated(null);
            }}
          />
        </label>
      ) : null}
      <button
        type="button"
        className="style-frame-generate"
        disabled={busy || !frameMsValid}
        onClick={generate}
      >
        生成横竖关键帧
      </button>
      {generated ? (
        <div className="style-frame-images">
          {generated.keyframes.map((frame) => (
            <figure key={frame.aspect}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`style-frame-img-${frame.aspect}`}
                src={frame.url}
                alt={`${frame.aspect === "landscape" ? "横版" : "竖版"}关键帧（第 ${generated.frameIndex + 1} 帧）`}
              />
              <figcaption>
                {frame.aspect === "landscape" ? "横版" : "竖版"} ·{" "}
                {frame.bytes.toLocaleString()} 字节 ·{" "}
                {frame.digest.slice(0, 12)}…
              </figcaption>
            </figure>
          ))}
          <label>
            确认备注（可选）
            <input
              className="style-frame-note"
              value={note}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="style-frame-confirm"
            disabled={
              busy || !generatedMatchesProject || (status?.valid ?? false)
            }
            onClick={confirm}
          >
            确认代表帧
          </button>
          {!generatedMatchesProject ? (
            <p role="alert">
              项目内容已变更，此关键帧不再对应当前项目，请重新生成。
            </p>
          ) : null}
        </div>
      ) : null}
      {status ? (
        <p className="style-frame-status" role="status">
          确认状态：{describeConfirmationStatus(status)}
        </p>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
