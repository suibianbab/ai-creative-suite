import type { VideoProject } from "@acs/video-document";

// P1-2（Codex 复核 2026-10-28）：未绑定素材位的最终导出闸。
// 占位镜头画面自身诚实（「素材位·X 待绑定素材」），但「成功导出 MP4」
// 会被理解成片完成——未绑定素材位必须阻断最终导出并逐镜点名。
// 纯函数：只看各镜工作版本的 description 前缀（绑定完成时剥前缀，见
// shot-editor-card 媒体臂）；历史版本里的占位不算（可回滚语义）。
export function unboundSlotReasons(project: VideoProject): string[] {
  const reasons: string[] = [];
  for (const [index, shot] of project.shots.entries()) {
    const working = shot.contentVersions.find(
      (v) => v.versionId === shot.workingVersionId,
    );
    if (!working?.description.startsWith("【素材位】")) continue;
    const kind = working.description.replace(/^【素材位】/, "").split("——")[0];
    reasons.push(
      `镜头 ${index + 1} 素材位（${kind}）待绑定素材：请在镜头卡选择「媒体镜头」绑定已导入素材，或改用图解/删除该镜头`,
    );
  }
  return reasons;
}
