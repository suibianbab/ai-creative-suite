// W2 风格代表帧：确认帧渲染与失效判定（纯函数，UI 与导出闸门共用）。
// 帧由镜头注册表在导出坐标空间直接渲染——与出片同组件同 spec；确认绑定
// 内容版本 + 风格版本摘要 + 帧摘要三重身份，任一变化即失效。
import type { StyleFrameApproval, VideoProject } from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  type SvgNode,
  serializeSvgNode,
} from "@acs/video-scene";

export type ApprovalFrame = {
  aspect: "landscape" | "portrait";
  svg: string;
  sha256: string;
};

export type ApprovalStatus = { valid: boolean; reasons: string[] };

const sha256Hex = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

function svgDocument(
  node: SvgNode,
  width: number,
  height: number,
  background: string,
) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" font-family="NotoSansSC, sans-serif">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    serializeSvgNode(node) +
    `</svg>`
  );
}

export async function renderApprovalFrames(
  spec: SceneSpec,
): Promise<ApprovalFrame[]> {
  const durationFrames = Math.ceil((spec.durationMs / 1000) * 24);
  const frame = Math.floor(durationFrames / 2);
  const results: ApprovalFrame[] = [];
  for (const [aspect, width, height] of [
    ["landscape", 1280, 720],
    ["portrait", 720, 1280],
  ] as const) {
    const node = defaultRegistry
      .get(spec.componentId, spec.componentVersion)
      .render(spec, {
        frame,
        fps: 24,
        durationFrames,
        width,
        height,
        random: () => 0.42,
      });
    const svg = svgDocument(node, width, height, spec.background);
    results.push({ aspect, svg, sha256: await sha256Hex(svg) });
  }
  return results;
}

function invalidationReasons(
  approval: StyleFrameApproval,
  project: VideoProject,
): string[] {
  const reasons: string[] = [];
  const shot = project.shots.find((item) => item.shotId === approval.shotId);
  if (!shot) return [`镜头 ${approval.shotId.slice(0, 8)} 已不存在，确认失效`];
  if (shot.workingVersionId !== approval.contentVersionId)
    reasons.push("镜头内容版本已修改，确认失效");
  if (
    !project.styleBibleRef ||
    project.styleBibleRef.digest !== approval.styleBibleRef.digest ||
    project.styleBibleRef.versionId !== approval.styleBibleRef.versionId
  )
    reasons.push("风格版本已变化，确认失效");
  return reasons;
}

async function frameReason(
  approval: StyleFrameApproval,
  project: VideoProject,
): Promise<string | null> {
  const shot = project.shots.find((item) => item.shotId === approval.shotId);
  const working = shot?.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working || working.sceneSource.type !== "spec")
    return "镜头不再是可渲染 spec，确认失效";
  try {
    const frames = await renderApprovalFrames(
      working.sceneSource.spec as SceneSpec,
    );
    for (const expected of approval.frames) {
      const actual = frames.find((frame) => frame.aspect === expected.aspect);
      if (!actual || actual.sha256 !== expected.svgSha256)
        return "画面与确认帧不一致，确认失效";
    }
  } catch {
    return "镜头 spec 已无法渲染，确认失效";
  }
  return null;
}

// 项目级汇总：任何已记录的确认失效即整体不放行；无确认 = 功能未启用不拦截。
export async function approvalStatus(
  project: VideoProject,
): Promise<ApprovalStatus> {
  const approvals = project.styleFrameApprovals ?? [];
  if (approvals.length === 0) return { valid: true, reasons: [] };
  const reasons: string[] = [];
  for (const approval of approvals) {
    reasons.push(...invalidationReasons(approval, project));
    const frame = await frameReason(approval, project);
    if (frame) reasons.push(frame);
  }
  return { valid: reasons.length === 0, reasons };
}
