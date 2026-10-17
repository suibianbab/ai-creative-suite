// 镜头 → 可预览 SceneSpec 的安全解析（终评 Important#2）。
// video-document 里 spec 是 unknown（包不依赖 video-scene）；导入件的 spec 可能
// 来自更新版本（未注册组件）或手改。渲染前必须在这里验掉非法 spec 并降级为
// null（工作台显示「不可预览」提示），而不是裸 cast 递进渲染路径在 React 渲染期
// 抛错、炸掉整页编辑器（应用无 error boundary）。

import type { Shot } from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export function shotWorkingSpec(shot: Shot): SceneSpec | null {
  const working = shot.contentVersions.find(
    (version) => version.versionId === shot.workingVersionId,
  );
  if (!working || working.sceneSource.type !== "spec") return null;
  try {
    return validateSceneSpec(working.sceneSource.spec, defaultRegistry);
  } catch {
    return null; // 未注册组件/结构非法：不可预览，但不炸页
  }
}
