// StyleFramePanel 的纯状态推导：不依赖 React，可单测。
// confirmationBlockSignature 是「已生成关键帧是否仍对应当前项目」的廉价
// 判据——与 style-confirmation.ts 的工作集快照覆盖同一批字段（风格引用、
// 全部镜头工作版本、转场），用字符串比较避免每次渲染都算异步摘要。
import type {
  StyleConfirmationStatus,
  VideoProject,
} from "@acs/video-document";

export function confirmationBlockSignature(project: VideoProject): string {
  return JSON.stringify({
    styleBibleRef: project.styleBibleRef ?? null,
    workingVersionIds: project.shots.map((shot) => shot.workingVersionId),
    transitions: project.transitions ?? [],
  });
}

export function describeConfirmationStatus(
  status: StyleConfirmationStatus,
): string {
  if (status.valid) {
    const at = status.confirmation.confirmedAt.replace("T", " ").slice(0, 19);
    return `有效：已确认第 ${status.confirmation.frameIndex + 1} 帧代表帧（${at} UTC）`;
  }
  return `未生效：${status.reason}`;
}
