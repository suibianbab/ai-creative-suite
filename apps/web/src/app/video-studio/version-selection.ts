// 两个选版本入口共用的应用边界：检查目标版本对整片帧数的影响，再移动
// working 指针。锁定镜头仍允许人工选择，rollbackWorkingVersion 保留 audit 留痕。
import { rollbackWorkingVersion, type VideoProject } from "@acs/video-document";
import { describeDurationImpact, durationApplyError } from "./duration-impact";

export function selectWorkingVersion(
  project: VideoProject,
  shotIndex: number,
  versionId: string,
  at?: string,
): VideoProject {
  const shot = project.shots[shotIndex];
  const version = shot?.contentVersions.find(
    (candidate) => candidate.versionId === versionId,
  );
  if (!shot || !version) throw new Error("无法应用：候选版本不存在");

  const blocked = durationApplyError(
    describeDurationImpact(project, shotIndex, version.durationMs),
  );
  if (blocked) throw new Error(blocked);

  return rollbackWorkingVersion(project, shot.shotId, versionId, at);
}
