import type {
  ContentVersion,
  Shot,
  ThreeSceneSpec,
  VideoProject,
} from "./types.js";
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

// P2.5-T3（spec §2.1 R1）：mediaClip patch——工作台媒体镜头的人工修订通道。
// durationMs 由 op 计算（outMs−inMs），调用方不得自带（C4 单一事实源）。
export type MediaClipPatch = {
  mediaAssetId: string;
  inMs: number;
  outMs: number;
  fit: "cover" | "contain";
  focalX: number;
  audio: "mute" | "keep";
};

// 人工修订（分镜编辑器）：以当前 working 版本为 base 追加新 ContentVersion +
// submitted(human)。锁定镜头允许（ADR 0003 §1.3 人工路径），并追加 audit 事件
// 留痕。patch.spec 由调用方先用 video-scene 的 validateSceneSpec + 组件注册表
// 校验过（本包不依赖 video-scene，spec 在文档内是 unknown）；patch.mediaClip
// 的 C1-C6 契约由收尾 validateVideoProject 后盾拦（R2）。patch.threeScene
// （P3-B Ruling 11）落 three 场景源，params 深度校验由烘焙期注册表负责。
export function reviseWorkingVersion(
  p: VideoProject,
  shotId: string,
  patch: {
    narrationText?: string;
    // 镜头说明（用户可读的画面意图）：显式给出则原样落库；缺省沿用
    // 「（人工修订）」后缀口径，保证说明仍能区分人工版本。
    description?: string;
    spec?: unknown;
    mediaClip?: MediaClipPatch;
    threeScene?: ThreeSceneSpec;
  },
  newVersionId: string,
  at = new Date().toISOString(),
): VideoProject {
  const shot = p.shots.find((s) => s.shotId === shotId);
  if (!shot) throw new Error(`shotId ${shotId} 不存在`);
  const base = shot.contentVersions.find(
    (v) => v.versionId === shot.workingVersionId,
  );
  if (!base) {
    throw new Error(
      `镜头 ${shotId} 的工作版本 ${shot.workingVersionId} 不存在`,
    );
  }
  // spec / mediaClip / threeScene 三者互斥：一次修订只能指定一种场景源。
  const sourceKinds =
    (patch.spec !== undefined ? 1 : 0) +
    (patch.mediaClip !== undefined ? 1 : 0) +
    (patch.threeScene !== undefined ? 1 : 0);
  if (sourceKinds > 1) {
    throw new Error(
      "spec、mediaClip 与 threeScene 互斥：一次修订只能指定一种场景源",
    );
  }
  // 说明长度与 ContentVersion.description 的 1..200 契约一致，提前 fail-loud。
  if (patch.description !== undefined) {
    const d = patch.description.trim();
    if (d.length === 0 || d.length > 200) {
      throw new Error("镜头说明须为 1..200 字符");
    }
  }
  const version: ContentVersion = {
    ...base,
    versionId: newVersionId,
    createdAt: at,
    durationMs:
      patch.mediaClip !== undefined
        ? patch.mediaClip.outMs - patch.mediaClip.inMs
        : patch.threeScene !== undefined
          ? patch.threeScene.durationMs
          : patch.spec === undefined
            ? base.durationMs
            : (patch.spec as { durationMs: number }).durationMs,
    description:
      patch.description === undefined
        ? `${base.description.slice(0, 160)}（人工修订）`
        : patch.description.trim(),
    narrationText: patch.narrationText ?? base.narrationText,
    sceneSource:
      patch.mediaClip !== undefined
        ? { type: "media-clip", ...patch.mediaClip }
        : patch.threeScene !== undefined
          ? { type: "three", spec: patch.threeScene }
          : patch.spec === undefined
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
      {
        kind: "submitted",
        versionId: newVersionId,
        at,
        actor: "human" as const,
      },
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
