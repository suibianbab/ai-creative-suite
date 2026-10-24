import {
  defaultRegistry,
  type ExplainerParams,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";
import type { ShotEditDraft } from "./shot-edit";

const COMPOSITION_TEMPLATE_PREFIX = "composition-";

export function isCompositionTemplateId(templateId: string): boolean {
  return templateId.startsWith(COMPOSITION_TEMPLATE_PREFIX);
}

// Template browsing never writes the shared background field. Only the Apply
// action hands off the template background, and a user edit always wins.
export function compositionReviseDraft(
  templateId: string,
  draft: ShotEditDraft,
  composedSpec: SceneSpec,
  backgroundTouched: boolean,
): ShotEditDraft {
  return isCompositionTemplateId(templateId) && !backgroundTouched
    ? { ...draft, background: composedSpec.background }
    : draft;
}

type CompositionTemplate = {
  templateId: string;
  componentId: "explainer-composition";
  label: string;
  description: string;
  params: ExplainerParams;
};

const shared = {
  titleColor: "#ffffff",
  textColor: "#ffffff",
  boxColor: "#3268d9",
  arrowColor: "#8ec5ff",
  strokeColor: "#8ec5ff",
  titleY: 145,
  titleEnterMs: 0,
  diagramOffsetX: 0,
  diagramOffsetY: -40,
  diagramEnterMs: 500,
} as const;

// A one-pixel placeholder keeps the template valid until the user replaces
// it with a bounded self-contained raster in the editor.
const IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";

export const COMPOSITION_TEMPLATES: readonly CompositionTemplate[] = [
  {
    templateId: "composition-cycle-4",
    componentId: "explainer-composition",
    label: "多元素 · 循环图解",
    description: "四阶段闭环、短注与中心文字均可编辑，适合过程或系统循环说明。",
    params: {
      ...shared,
      title: "循环过程",
      diagramOffsetY: -60,
      diagram: {
        kind: "cycle",
        steps: [
          { label: "阶段一", caption: "起点" },
          { label: "阶段二", caption: "变化" },
          { label: "阶段三", caption: "传递" },
          { label: "阶段四", caption: "返回" },
        ],
        centerText: "持续循环",
      },
      annotations: [
        {
          text: "在此说明循环的驱动力",
          x: 500,
          y: 780,
          portraitY: 1340,
          enterMs: 2800,
        },
      ],
    },
  },
  {
    templateId: "composition-process-4",
    componentId: "explainer-composition",
    label: "多元素 · 四步说明",
    description: "默认深色背景；标题＋四步流程＋两条注释，可替换为任意行业。",
    params: {
      ...shared,
      title: "项目实施步骤",
      diagram: {
        kind: "flow",
        steps: [
          { label: "调研" },
          { label: "方案" },
          { label: "实施" },
          { label: "验收" },
        ],
      },
      annotations: [
        { text: "按阶段推进", x: 500, y: 700, portraitY: 1260, enterMs: 1500 },
        {
          text: "成果逐步确认",
          x: 500,
          y: 780,
          portraitY: 1380,
          enterMs: 1900,
        },
      ],
    },
  },
  {
    templateId: "composition-drawing",
    componentId: "explainer-composition",
    label: "多元素 · 线描解说",
    description:
      "默认深色背景；标题＋现有线描组件＋标注，可编辑 SVG 路径数据。",
    params: {
      ...shared,
      title: "结构示意",
      diagramOffsetY: 20,
      diagram: {
        kind: "drawing",
        paths: [
          "M 190 280 L 810 280 L 810 650 L 190 650 Z",
          "M 250 340 L 450 340 L 450 430 L 250 430 Z",
          "M 500 470 L 620 470 L 620 560 L 500 560 Z",
        ],
      },
      annotations: [
        { text: "关键结构", x: 500, y: 780, portraitY: 1250, enterMs: 1200 },
      ],
    },
  },
  {
    templateId: "composition-image",
    componentId: "explainer-composition",
    label: "多元素 · 图片解说",
    description: "默认深色背景；标题＋本地上传图片＋标注，须替换占位图。",
    params: {
      ...shared,
      title: "图片说明",
      diagram: { kind: "image", src: IMAGE_PLACEHOLDER },
      annotations: [
        {
          text: "上传图片并填写说明",
          x: 500,
          y: 780,
          portraitY: 1250,
          enterMs: 2100,
        },
      ],
    },
  },
];

export function applyCompositionTemplate(
  spec: SceneSpec,
  templateId: string,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  const applied = applySceneTemplate(
    COMPOSITION_TEMPLATES,
    spec,
    templateId,
    "未知多元素模板",
  );
  if (!applied.spec) return applied;
  return { spec: { ...applied.spec, background: "#102033" }, error: null };
}

export function applyCompositionDraft(
  spec: SceneSpec,
  draft: ExplainerParams,
): { spec: SceneSpec; error: null } | { spec: null; error: string } {
  if (draft.diagram.kind === "image" && draft.diagram.src === IMAGE_PLACEHOLDER)
    return { spec: null, error: "请先上传图片，不能保存占位图" };
  const next = { ...spec, params: structuredClone(draft) };
  try {
    validateSceneSpec(next, defaultRegistry);
    return { spec: next, error: null };
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
