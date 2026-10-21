// P3-B：工作台 3D 镜头模板（纯逻辑，不 import React）。
// Ruling 10：web 不跨目录 import scripts/video/three/*——默认参数常量在此自带，
// 与烘焙注册表 orbit3d@1 的参数表逐项一致；生成的 spec 由出片期注册表深校验。
import type { SceneSource, ThreeSceneSpec } from "@acs/video-document";

export const THREE_TEMPLATE_ID = "three-3d";
export const THREE_TEMPLATE_LABEL = "3D 镜头（出片时烘焙）";

export const DEFAULT_THREE_COMPONENT_ID = "orbit3d";
export const DEFAULT_THREE_BACKGROUND = "#101820";

// orbit3d.validateParams 的默认值（六键齐全，无多余键）。
export const DEFAULT_THREE_PARAMS = {
  shape: "box",
  color: "#4f9dff",
  accent: "#e8b04b",
  spinPerFrame: 0.02,
  tilt: 0.35,
  zoom: 1,
} as const satisfies Record<string, unknown>;

export type ThreeSceneVersionInput = {
  durationMs: number;
  seed: number;
  // 传入时整体替换默认参数（不合并默认键），与注册表语义一致。
  params?: Record<string, unknown>;
};

export function buildThreeSceneVersion({
  durationMs,
  seed,
  params,
}: ThreeSceneVersionInput): Extract<SceneSource, { type: "three" }> {
  return {
    type: "three",
    spec: {
      specVersion: 1,
      componentId: DEFAULT_THREE_COMPONENT_ID,
      componentVersion: 1,
      durationMs,
      seed,
      background: DEFAULT_THREE_BACKGROUND,
      params:
        params === undefined ? { ...DEFAULT_THREE_PARAMS } : { ...params },
    },
  };
}

export function threeSceneFromVersion(
  working: { sceneSource: SceneSource } | undefined,
): ThreeSceneSpec | null {
  return working && working.sceneSource.type === "three"
    ? working.sceneSource.spec
    : null;
}

// 与 mediaTemplateSelectValue 同构：工作版本已是 three 且未选换装模板时，
// 下拉默认停在本族条目，不再显示为「保持当前组件」。
export function threeTemplateSelectValue(
  pendingTemplateId: string,
  threeSourcePresent: boolean,
): string {
  return pendingTemplateId === "" && threeSourcePresent
    ? THREE_TEMPLATE_ID
    : pendingTemplateId;
}
