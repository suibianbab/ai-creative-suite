import type { ContentVersion, Shot, VideoProject } from "./types.js";
import { validateVideoProject } from "./validate.js";

export class ShotLockedError extends Error {}

// 全部纯函数：返回新 VideoProject，不修改入参；收尾跑 validateVideoProject 保证指针/事件不变量。
// savedVersion 不在此处递增——文档保存（Task 8）才计数。

function updateShot(
  p: VideoProject,
  shotId: string,
  update: (shot: Shot) => Shot,
): VideoProject {
  const index = p.shots.findIndex((s) => s.shotId === shotId);
  if (index === -1) throw new Error(`shotId ${shotId} 不存在`);
  const next: VideoProject = {
    ...p,
    shots: p.shots.map((s, i) => (i === index ? update(s) : s)),
  };
  return validateVideoProject(next);
}

// AI 重做：追加不可变内容版本 + submitted(ai) 事件，working 指针指向新版本。
// 锁定镜头拒绝 AI 改写（ADR 0003 §1.3）——人工路径走 rollbackWorkingVersion + audit。
export function addCandidateVersion(
  p: VideoProject,
  shotId: string,
  version: ContentVersion,
  at = new Date().toISOString(),
): VideoProject {
  const shot = p.shots.find((s) => s.shotId === shotId);
  if (!shot) throw new Error(`shotId ${shotId} 不存在`);
  if (shot.locked) {
    throw new ShotLockedError(
      `镜头 ${shotId} 已锁定，禁止 AI 改写（ADR 0003 §1.3）`,
    );
  }
  return updateShot(p, shotId, (s) => ({
    ...s,
    contentVersions: [...s.contentVersions, version],
    events: [
      ...s.events,
      { kind: "submitted", versionId: version.versionId, at, actor: "ai" },
    ],
    workingVersionId: version.versionId,
  }));
}

// 人工审批：只追加 approved(human) 事件；不改内容版本。
export function approveVersion(
  p: VideoProject,
  shotId: string,
  versionId: string,
  at = new Date().toISOString(),
): VideoProject {
  return updateShot(p, shotId, (s) => ({
    ...s,
    events: [...s.events, { kind: "approved", versionId, at, actor: "human" }],
  }));
}

// 人工锁定/解锁：每次变化都留 lock-changed(human) 事件。
export function setLocked(
  p: VideoProject,
  shotId: string,
  locked: boolean,
  at = new Date().toISOString(),
): VideoProject {
  return updateShot(p, shotId, (s) => ({
    ...s,
    locked,
    events: [...s.events, { kind: "lock-changed", locked, at, actor: "human" }],
  }));
}

// 人工回滚 working 指针：内容历史不动；locked 镜头允许（人工路径），追加 audit 事件留痕。
export function rollbackWorkingVersion(
  p: VideoProject,
  shotId: string,
  versionId: string,
  at = new Date().toISOString(),
): VideoProject {
  return updateShot(p, shotId, (s) => ({
    ...s,
    workingVersionId: versionId,
    events: [
      ...s.events,
      { kind: "audit", note: "回滚工作版本", at, actor: "human" },
    ],
  }));
}

// 人工修订（分镜编辑器）：以当前 working 版本为 base 追加新 ContentVersion +
// submitted(human)。锁定镜头允许（ADR 0003 §1.3 人工路径），并追加 audit 事件
// 留痕。patch.spec 由调用方先用 video-scene 的 validateSceneSpec + 组件注册表
// 校验过（本包不依赖 video-scene，spec 在文档内是 unknown）。
export function reviseWorkingVersion(
  p: VideoProject,
  shotId: string,
  patch: { narrationText?: string; spec?: unknown },
  newVersionId: string,
  at = new Date().toISOString(),
): VideoProject {
  const shot = p.shots.find((s) => s.shotId === shotId);
  if (!shot) throw new Error(`shotId ${shotId} 不存在`);
  const base = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  if (!base) {
    throw new Error(`镜头 ${shotId} 的工作版本 ${shot.workingVersionId} 不存在`);
  }
  const version: ContentVersion = {
    ...base,
    versionId: newVersionId,
    createdAt: at,
    durationMs:
      patch.spec === undefined
        ? base.durationMs
        : (patch.spec as { durationMs: number }).durationMs,
    description: `${base.description.slice(0, 160)}（人工修订）`,
    narrationText: patch.narrationText ?? base.narrationText,
    sceneSource:
      patch.spec === undefined
        ? base.sceneSource
        : { type: "spec", spec: patch.spec },
    provenance: {
      ...base.provenance,
      engineId: "human-edit",
      engineVersion: "1",
      parentVersionId: base.versionId,
    },
  };
  return updateShot(p, shotId, (s) => ({
    ...s,
    contentVersions: [...s.contentVersions, version],
    events: [
      ...s.events,
      { kind: "submitted", versionId: newVersionId, at, actor: "human" as const },
      ...(s.locked
        ? [
            {
              kind: "audit" as const,
              note: "人工修订（锁定镜头）",
              at,
              actor: "human" as const,
            },
          ]
        : []),
    ],
    workingVersionId: newVersionId,
  }));
}
