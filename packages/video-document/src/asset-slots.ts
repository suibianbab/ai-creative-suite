import type { ContentVersion, VideoProject } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 旧项目尚无 assetSlot 字段；从实际占位画面识别，而不信可编辑的说明文字。
export function mediaSlotKindFromSpec(spec: unknown): string | null {
  if (!isRecord(spec) || spec.componentId !== "text-animation") return null;
  const params = spec.params;
  if (!isRecord(params)) return null;
  const title = params.title;
  const subtitle = params.subtitle;
  if (typeof title === "string" && title.startsWith("素材位·")) {
    return title.slice("素材位·".length) || "待绑定素材";
  }
  if (typeof subtitle === "string" && subtitle.startsWith("待绑定素材")) {
    return "待绑定素材";
  }
  return null;
}

export function pendingMediaSlotKind(version: ContentVersion): string | null {
  if (version.sceneSource.type !== "spec") return null;
  return (
    version.assetSlot?.kind ?? mediaSlotKindFromSpec(version.sceneSource.spec)
  );
}

export function unboundMediaSlotReasons(project: VideoProject): string[] {
  const reasons: string[] = [];
  for (const [index, shot] of project.shots.entries()) {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const kind = working && pendingMediaSlotKind(working);
    if (!kind) continue;
    reasons.push(
      `镜头 ${index + 1} 素材位（${kind}）待绑定素材：请在镜头卡绑定已导入素材，或明确改用普通图解/删除该镜头`,
    );
  }
  return reasons;
}
