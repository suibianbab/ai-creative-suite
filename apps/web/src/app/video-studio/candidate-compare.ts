// 关键镜头双候选（B）：候选就是镜头的既有内容版本，本模块只读文档、不
// 产生新概念——不新增字段、不新增事件，状态一律由 events 推导。对比上限
// 两列：左边默认当前工作版本，右边默认最新的非工作版本。
import { deriveStatus, type Shot, type ShotStatus } from "@acs/video-document";

export type CandidateSummary = {
  versionId: string;
  // 1 起，与镜头卡的版本下拉编号一致。
  index: number;
  // 事件推导（deriveStatus），不落库。
  status: ShotStatus;
  description: string;
  durationMs: number;
  isWorking: boolean;
};

export function candidateSummaries(shot: Shot): CandidateSummary[] {
  return shot.contentVersions.map((version, position) => ({
    versionId: version.versionId,
    index: position + 1,
    status: deriveStatus(shot.events, version.versionId),
    description: version.description,
    durationMs: version.durationMs,
    isWorking: version.versionId === shot.workingVersionId,
  }));
}

// 少于两个版本没有可对比的对象。右边取内容版本里最后一个非工作版本
// （最近的另一条拍法），不按时间排序——版本数组本身就是追加顺序。
export function defaultCandidatePair(
  shot: Shot,
): { leftId: string; rightId: string } | null {
  const left = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  const right = [...shot.contentVersions]
    .reverse()
    .find((version) => version.versionId !== shot.workingVersionId);
  if (!left || !right) return null;
  return { leftId: left.versionId, rightId: right.versionId };
}

// 两列下拉互相排除：不能把同一个版本同时放在两列里「自己比自己」。
export function candidateChoices(
  summaries: CandidateSummary[],
  excludedId: string | null,
): CandidateSummary[] {
  if (excludedId === null) return summaries;
  return summaries.filter((summary) => summary.versionId !== excludedId);
}

export function statusLabel(status: ShotStatus): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "candidate":
      return "候选";
    case "approved":
      return "已批准";
  }
}
