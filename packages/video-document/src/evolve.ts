// 文档演进只允许追加（ADR 0003 §3.1「不可变文档版本」）。保存新版本前，
// 调用方必须证明：旧镜头的内容版本与事件、渲染记录、交付记录在新文档中
// 原样保留（旧序列是新序列的前缀），旧内容版本逐字段未改。标题、brief、
// workingVersionId、locked 等当前态/元数据可变。savedVersion 不参与判定。
import { canonicalJson } from "./canonical-json.js";
import type { VideoProject } from "./types.js";

export class VideoProjectMutationError extends Error {
  constructor(message: string) {
    super(`VideoProject 演进违反只追加约束: ${message}`);
    this.name = "VideoProjectMutationError";
  }
}

function requirePrefix(
  previous: unknown[],
  next: unknown[],
  describe: (index: number) => string,
): void {
  if (next.length < previous.length) {
    throw new VideoProjectMutationError(
      `${describe(0)} 序列变短：只允许追加，不允许删除（旧 ${previous.length} 项，新 ${next.length} 项）`,
    );
  }
  for (const [index, item] of previous.entries()) {
    if (canonicalJson(item) !== canonicalJson(next[index])) {
      throw new VideoProjectMutationError(
        `${describe(index)} 被改写或重排：旧值必须原样保留`,
      );
    }
  }
}

export function assertAppendOnlyEvolution(
  previous: VideoProject,
  next: VideoProject,
): void {
  if (previous.id !== next.id) {
    throw new VideoProjectMutationError(
      `项目 id 不同（${previous.id} → ${next.id}），不能作为同一项目的演进保存`,
    );
  }
  if (next.shots.length < previous.shots.length) {
    throw new VideoProjectMutationError("shots 序列变短：不允许删除镜头");
  }
  const nextShotById = new Map(next.shots.map((shot) => [shot.shotId, shot]));
  for (const [index, previousShot] of previous.shots.entries()) {
    const nextShot = nextShotById.get(previousShot.shotId);
    if (!nextShot) {
      throw new VideoProjectMutationError(
        `shots[${index}]（${previousShot.shotId}）在新文档中缺失`,
      );
    }
    requirePrefix(
      previousShot.contentVersions,
      nextShot.contentVersions,
      (slot) => `shots[${index}].contentVersions[${slot}]`,
    );
    requirePrefix(
      previousShot.events,
      nextShot.events,
      (slot) => `shots[${index}].events[${slot}]`,
    );
  }
  requirePrefix(
    previous.renderRecords,
    next.renderRecords,
    (slot) => `renderRecords[${slot}]`,
  );
  requirePrefix(
    previous.deliveries,
    next.deliveries,
    (slot) => `deliveries[${slot}]`,
  );
}
