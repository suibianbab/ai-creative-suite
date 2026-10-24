// W2 风格代表帧确认：把「人工看过真实渲染器出的横竖关键帧并签收」落成
// 可对账的项目内账本。确认绑定不可变的内容版本、风格版本引用与摘要；
// 有效性不存可变标志位，而是每次与当前工作集快照比对推导——任何镜头
// 工作版本、转场或风格引用变化后，旧确认自然失效，保存/刷新/导入后
// 状态依旧准确（不需要迁移或清洗）。
import { canonicalJson } from "./canonical-json.js";
import { EXPORT_FPS } from "./aspect.js";
import { quantizeTimeline } from "./quantize.js";
import type {
  AspectTarget,
  ContentVersion,
  StyleBibleRef,
  StyleFrameConfirmation,
  StyleFrameKeyframeEvidence,
  VideoProject,
} from "./types.js";
import { validateVideoProject } from "./validate.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// 与 RenderRecord.contentDigest 同源：canonicalJson(ContentVersion) 的 SHA-256。
export async function contentVersionDigest(
  version: ContentVersion,
): Promise<string> {
  return sha256Canonical(version);
}

export type WorkingSetSnapshot = {
  styleBibleRef: StyleBibleRef | null;
  transitionsDigest: string;
  entries: Array<{
    shotId: string;
    versionId: string;
    contentDigest: string;
  }>;
};

// 工作集 = 全部镜头的当前工作内容版本（含媒体/3D 镜头——它们的版本变化
// 同样改变成片，必须让旧确认失效）+ 转场 + 风格引用。
export async function buildWorkingSetSnapshot(
  project: VideoProject,
): Promise<WorkingSetSnapshot> {
  const entries = [];
  for (const shot of project.shots) {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    if (!working) throw new Error(`镜头 ${shot.shotId} 工作版本缺失`);
    entries.push({
      shotId: shot.shotId,
      versionId: working.versionId,
      contentDigest: await contentVersionDigest(working),
    });
  }
  return {
    styleBibleRef: project.styleBibleRef ?? null,
    transitionsDigest: await sha256Canonical(project.transitions ?? []),
    entries,
  };
}

export async function workingSetDigest(project: VideoProject): Promise<string> {
  return sha256Canonical(await buildWorkingSetSnapshot(project));
}

export type StyleConfirmationStatus =
  | { valid: true; confirmation: StyleFrameConfirmation }
  | {
      valid: false;
      reason: string;
      confirmation: StyleFrameConfirmation | null;
    };

// 最近一条确认生效（只追加账本，后签收覆盖先签收）。判据全部对照当前
// 项目状态：风格引用一致 + 工作集摘要一致（顺带覆盖了代表帧镜头的工作
// 版本与内容摘要）。任何一项漂移都给出可操作的失效原因。
export async function styleConfirmationStatus(
  project: VideoProject,
): Promise<StyleConfirmationStatus> {
  const latest = project.styleFrameConfirmations?.at(-1) ?? null;
  if (!project.styleBibleRef) {
    return {
      valid: false,
      reason: "项目未链接 Style Bible，不适用风格代表帧确认",
      confirmation: latest,
    };
  }
  if (!latest) {
    return {
      valid: false,
      reason: "尚无风格代表帧确认：请先选择镜头生成横竖关键帧并确认",
      confirmation: null,
    };
  }
  if (
    canonicalJson(latest.styleBibleRef) !==
    canonicalJson(project.styleBibleRef)
  ) {
    return {
      valid: false,
      reason: "风格版本已变更，旧确认不能放行新导出：请重新生成关键帧并确认",
      confirmation: latest,
    };
  }
  const digest = await workingSetDigest(project);
  if (latest.workingSetDigest !== digest) {
    return {
      valid: false,
      reason: "项目内容（镜头工作版本或转场）已变更，旧确认不能放行新导出：请重新确认",
      confirmation: latest,
    };
  }
  return { valid: true, confirmation: latest };
}

export type StyleFrameConfirmationDraft = {
  shotId: string;
  frameMs: number;
  keyframes: StyleFrameKeyframeEvidence[];
  note?: string;
  confirmationId?: string;
  at?: string;
};

function assertKeyframes(
  keyframes: StyleFrameKeyframeEvidence[],
): void {
  const aspects = new Set(keyframes.map((frame) => frame.aspect));
  if (
    keyframes.length !== 2 ||
    !aspects.has("landscape") ||
    !aspects.has("portrait")
  ) {
    throw new Error("关键帧须恰好横竖各一条（landscape + portrait）");
  }
  for (const frame of keyframes) {
    if (!SHA256_HEX.test(frame.digest))
      throw new Error("关键帧 digest 须为 64 位小写十六进制");
    if (!Number.isInteger(frame.bytes) || frame.bytes < 1)
      throw new Error("关键帧 bytes 须为正整数");
    if (
      typeof frame.outputRef !== "string" ||
      frame.outputRef.length < 1 ||
      frame.outputRef.length > 200 ||
      frame.outputRef.includes("..")
    )
      throw new Error("关键帧 outputRef 须为 1..200 字符且不含 ..");
  }
}

// 服务端出好关键帧后由工作台调用：不信任调用方给的摘要，逐项重算并校验，
// 通过才追加进只追加账本并整包 validateVideoProject。
export async function appendStyleFrameConfirmation(
  project: VideoProject,
  draft: StyleFrameConfirmationDraft,
): Promise<VideoProject> {
  const ref = project.styleBibleRef;
  if (!ref) throw new Error("项目未链接 Style Bible，无法确认风格代表帧");
  const shot = project.shots.find((entry) => entry.shotId === draft.shotId);
  if (!shot) throw new Error(`镜头 ${draft.shotId} 不存在`);
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working) throw new Error("镜头工作版本缺失");
  if (working.sceneSource.type !== "spec") {
    throw new Error(
      "代表帧只能选程序化画面镜头（媒体/3D 镜头不在当前关键帧渲染能力内）",
    );
  }
  if (
    !Number.isInteger(draft.frameMs) ||
    draft.frameMs < 0 ||
    draft.frameMs >= working.durationMs
  ) {
    throw new Error(
      `frameMs 须为 0..${working.durationMs - 1} 的整数毫秒`,
    );
  }
  if (
    draft.note !== undefined &&
    (typeof draft.note !== "string" ||
      draft.note.length < 1 ||
      draft.note.length > 200)
  ) {
    throw new Error("确认备注须为 1..200 字符");
  }
  assertKeyframes(draft.keyframes);
  const frames = quantizeTimeline([working.durationMs], EXPORT_FPS).shots[0]!
    .frames;
  const frameIndex = Math.min(
    Math.floor((draft.frameMs * EXPORT_FPS) / 1000),
    frames - 1,
  );
  const record: StyleFrameConfirmation = {
    confirmationId: draft.confirmationId ?? crypto.randomUUID(),
    shotId: shot.shotId,
    versionId: working.versionId,
    contentDigest: await contentVersionDigest(working),
    frameMs: draft.frameMs,
    frameIndex,
    styleBibleRef: { ...ref },
    workingSetDigest: await workingSetDigest(project),
    keyframes: draft.keyframes.map((frame) => ({ ...frame })),
    ...(draft.note === undefined ? {} : { note: draft.note }),
    confirmedAt: draft.at ?? new Date().toISOString(),
    actor: "human",
  };
  return validateVideoProject({
    ...project,
    styleFrameConfirmations: [
      ...(project.styleFrameConfirmations ?? []),
      record,
    ],
  });
}
