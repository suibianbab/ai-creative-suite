// 文档演进只允许追加（ADR 0003 §3.1「不可变文档版本」）。保存新版本前，
// 调用方必须证明：旧镜头的内容版本与事件、渲染记录、交付记录在新文档中
// 原样保留（旧序列是新序列的前缀），旧内容版本逐字段未改。标题、brief、
// workingVersionId 等当前态/元数据可变（brief.sentence/aspectTargets 亦然）；
// 但 brief.applications（分镜应用快照）例外——只追加，见下方校验。locked 可变
// 但最终状态由本次追加段最后一条 lock-changed 事件裁定（setLocked 的审计契约）。
// savedVersion 不参与判定。
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
    // 锁定审计不变量（Codex 复核反馈 ×2）：locked 的最终状态由本次追加段
    // 最后一条 lock-changed 事件裁定。两条规则：
    //   1) locked 变化 → 追加段必须有 lock-changed 事件（直改拒绝）；
    //   2) 追加段存在 lock-changed → 末条事件值必须等于最终 locked。
    // 旧实现用 some() 找「任意位置的同值事件」背书——构造 [锁 true，解 false]
    // 而终态 true 可绕过；旧前缀里的同值历史事件同理不能背书。
    const appendedEvents = nextShot.events.slice(previousShot.events.length);
    let lastLockChanged: { locked: boolean } | undefined;
    for (const event of appendedEvents) {
      if (event.kind === "lock-changed") {
        lastLockChanged = event;
      }
    }
    if (
      previousShot.locked !== nextShot.locked &&
      lastLockChanged === undefined
    ) {
      throw new VideoProjectMutationError(
        `shots[${index}]（${previousShot.shotId}）locked ${previousShot.locked} → ${nextShot.locked} 未追加 lock-changed 事件（锁定变化必须走 setLocked 留审计事件）`,
      );
    }
    if (
      lastLockChanged !== undefined &&
      lastLockChanged.locked !== nextShot.locked
    ) {
      throw new VideoProjectMutationError(
        `shots[${index}]（${previousShot.shotId}）追加段最后一条 lock-changed（locked=${lastLockChanged.locked}）与最终 locked=${nextShot.locked} 矛盾（末条事件裁定最终状态）`,
      );
    }
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
  // brief.applications（分镜应用快照）：逐次审计记录，与 shots/events 同一
  // 只追加纪律——已保存条目不得删除或改写；此前无记录（单镜头/旧项目路径）
  // 则不受约束。
  if (previous.brief.applications !== undefined) {
    requirePrefix(
      previous.brief.applications,
      next.brief.applications ?? [],
      (slot) => `brief.applications[${slot}]`,
    );
  }
}
