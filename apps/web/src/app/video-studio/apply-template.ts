// P2.5-T3 六族 applyXTemplate 机械共体提取（spec §1 裁定）：找模板 → 深拷贝
// params → validateSceneSpec 门。六族保留薄包装（签名与报错文案不变，既有
// 测试零改动即等价证明）；第七族（媒体）产物是 ContentVersion 级 patch，
// 与 spec params 不同类，不入此基底。
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type TemplateLike = {
  templateId: string;
  componentId: SceneSpec["componentId"];
  params: Record<string, unknown>;
};

export function applySceneTemplate(
  templates: readonly TemplateLike[],
  spec: SceneSpec,
  templateId: string,
  unknownTemplateLabel: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const template = templates.find((t) => t.templateId === templateId);
  if (!template) {
    return { spec: null, error: `${unknownTemplateLabel} ${templateId}` };
  }
  // 深拷贝：编辑产物不得回流污染模板库
  const next: SceneSpec = {
    ...spec,
    componentId: template.componentId,
    componentVersion: 1,
    params: structuredClone(template.params),
  };
  try {
    validateSceneSpec(next, defaultRegistry);
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { spec: next, error: null };
}
