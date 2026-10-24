"use client";
import type { VideoProject } from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";
// W2 风格代表帧确认面板：选镜头 → 生成双画幅关键帧（注册表直渲染）→
// 显式确认（绑定内容版本/风格版本/帧摘要）→ 状态徽章实时反映失效原因。
import { useEffect, useMemo, useState } from "react";
import {
  type ApprovalFrame,
  approvalStatus,
  renderApprovalFrames,
} from "./frame-approval";

export function FrameApprovalPanel({
  project,
  onApply,
}: {
  project: VideoProject;
  onApply: (next: VideoProject, message: string) => void;
}) {
  const specShots = useMemo(
    () =>
      project.shots.filter((shot) => {
        const working = shot.contentVersions.find(
          (version) => version.versionId === shot.workingVersionId,
        );
        return working?.sceneSource.type === "spec";
      }),
    [project.shots],
  );
  const [shotId, setShotId] = useState(specShots[0]?.shotId ?? "");
  const [frames, setFrames] = useState<ApprovalFrame[] | null>(null);
  const [status, setStatus] = useState({
    valid: true,
    reasons: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void approvalStatus(project).then(setStatus);
  }, [project]);

  const generate = async () => {
    const shot = specShots.find((item) => item.shotId === shotId);
    const working = shot?.contentVersions.find(
      (version) => version.versionId === shot?.workingVersionId,
    );
    if (!shot || !working || working.sceneSource.type !== "spec") {
      setMessage("请选择一个可渲染的程序化镜头");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setFrames(
        await renderApprovalFrames(working.sceneSource.spec as SceneSpec),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关键帧生成失败");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!frames || !project.styleBibleRef) return;
    const shot = project.shots.find((item) => item.shotId === shotId);
    if (!shot) return;
    const entry = {
      shotId,
      contentVersionId: shot.workingVersionId,
      styleBibleRef: project.styleBibleRef,
      frames: frames.map(({ aspect, sha256 }) => ({
        aspect,
        svgSha256: sha256,
      })),
      confirmedAt: new Date().toISOString(),
    };
    const next: VideoProject = {
      ...project,
      styleFrameApprovals: [
        ...(project.styleFrameApprovals ?? []).filter(
          (approval) => approval.shotId !== shotId,
        ),
        entry,
      ],
    };
    onApply(
      next,
      "代表帧已确认；确认随项目保存持久化，内容或风格变化后自动失效",
    );
  };

  return (
    <section className="frame-approval-panel" aria-label="风格代表帧确认">
      <h3>风格代表帧确认</h3>
      <p>
        导出前先看双画幅代表帧：确认绑定镜头内容版本、风格版本与画面摘要，
        任一变化后确认失效并阻断导出。
      </p>
      <label className="approval-shot-field">
        代表镜头
        <select
          className="approval-shot-select"
          value={shotId}
          disabled={busy}
          onChange={(event) => {
            setShotId(event.target.value);
            setFrames(null);
          }}
        >
          {specShots.length === 0 ? (
            <option value="">（无可渲染的程序化镜头）</option>
          ) : null}
          {specShots.map((shot, index) => (
            <option key={shot.shotId} value={shot.shotId}>
              镜头 {index + 1} ·{" "}
              {shot.contentVersions
                .find((version) => version.versionId === shot.workingVersionId)
                ?.description.slice(0, 12) ?? ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="approval-generate"
        disabled={busy || !shotId}
        onClick={() => void generate()}
      >
        生成双画幅关键帧
      </button>
      {frames ? (
        <div className="approval-frames">
          {frames.map((frame) => (
            <div
              key={frame.aspect}
              className={`approval-frame approval-frame-${frame.aspect}`}
              aria-label={`${frame.aspect} 确认帧`}
              dangerouslySetInnerHTML={{ __html: frame.svg }}
            />
          ))}
        </div>
      ) : null}
      {project.styleFrameApprovals?.length ? (
        <p
          className={`approval-status${status.valid ? " is-valid" : " is-stale"}`}
        >
          {status.valid
            ? `已确认 ${project.styleFrameApprovals.length} 个镜头的代表帧`
            : status.reasons.join("；")}
        </p>
      ) : (
        <p className="approval-status">尚未确认任何代表帧（未启用导出闸门）</p>
      )}
      {frames ? (
        <button
          type="button"
          className="approval-confirm"
          disabled={busy}
          onClick={confirm}
        >
          确认代表帧
        </button>
      ) : null}
      {message ? <p className="approval-message">{message}</p> : null}
    </section>
  );
}
