import {
  defaultRegistry,
  type ExplainerParams,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";

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
    templateId: "composition-process-4",
    componentId: "explainer-composition",
    label: "多元素 · 四步说明",
    description: "标题＋四步流程＋两条注释；可替换成任意行业的四阶段说明。",
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
    description: "标题＋现有线描组件＋标注；可编辑 SVG 路径数据。",
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
    description: "标题＋本地上传的内嵌图片＋标注；选中后请替换占位图。",
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
