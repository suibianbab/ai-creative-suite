// —— 任务 2（2026-10-28）：图片镜头基础运动 ——
// 五档受控运动（无关键帧编辑器）：推近/拉远/左右平移 + 静止。变换纯函数
// 由进度（0..1）唯一决定，预览与出片单源。
// P1-3（Codex 复核 2026-10-28）：平移超采必须覆盖位移——scale(s) 单侧
// 余量 (s−1)/2，平移端点 ±6% 需 s ≥ 1.12；原 1.06 只有 3% 余量，样片
// 实测右缘露黑条。pan 档固定 scale(1.12)（与缩放档上限一致）。
export type MediaMotion =
  | "still"
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right";

const MOTION_SET = new Set<MediaMotion>([
  "still",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
]);

export function isMediaMotion(value: unknown): value is MediaMotion {
  return typeof value === "string" && MOTION_SET.has(value as MediaMotion);
}

// progress ∈ [0,1]；返回 CSS transform（scale/translate 百分比）。确定性：
// 同 motion+progress 恒同输出（无时钟/随机）。transform-origin 恒中心，
// 与 focalX 裁切独立叠加（裁切先定取景，运动在其上做克制动效）。
export function mediaMotionTransform(
  motion: MediaMotion | undefined,
  progress: number,
): string {
  const t = Math.min(Math.max(progress, 0), 1);
  switch (motion) {
    case undefined:
    case "still":
      return "none";
    case "zoom-in":
      return `scale(${(1 + 0.12 * t).toFixed(4)})`;
    case "zoom-out":
      return `scale(${(1.12 - 0.12 * t).toFixed(4)})`;
    case "pan-left":
      return `scale(1.12) translateX(${(6 - 12 * t).toFixed(2)}%)`;
    case "pan-right":
      return `scale(1.12) translateX(${(-6 + 12 * t).toFixed(2)}%)`;
  }
}
