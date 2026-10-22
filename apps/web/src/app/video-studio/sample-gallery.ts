import {
  applyStyleBible,
  type MediaAsset,
  type SceneSource,
  type StyleBible,
  styleSceneSpec,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type GallerySampleId = "stem" | "data" | "product";

export const GALLERY_SAMPLES: ReadonlyArray<{
  id: GallerySampleId;
  title: string;
  summary: string;
  detail: string;
  poster: string;
}> = [
  {
    id: "stem",
    title: "水循环 · STEM 解说",
    summary: "概念开场、四步流程、数据强调、收尾",
    detail: "4 镜头 · 约 9 秒 · 可改文字、流程和配色",
    poster: "/samples/p4-stem.svg",
  },
  {
    id: "data",
    title: "季度销量 · 数据动画",
    summary: "标题、柱状对比、关键数字、结论",
    detail: "4 镜头 · 约 9 秒 · 可改图表数据与标题",
    poster: "/samples/p4-data.svg",
  },
  {
    id: "product",
    title: "FORM 01 帽子 · 产品展示",
    summary: "产品开场、真实商品画面、局部画面、卖点收尾",
    detail: "5 镜头 · 约 12 秒 · 可上传自己的视频替换商品素材",
    poster: "/samples/p4-product.png",
  },
];

const STEM_PALETTE = {
  background: "#101f34",
  foreground: "#f3f5f7",
  secondary: "#b4d8e4",
  accent: "#f5b652",
  object: "#42a5a0",
};
const DATA_PALETTE = {
  background: "#122137",
  foreground: "#f5f7fa",
  secondary: "#afcde6",
  accent: "#ffbc60",
  object: "#4a9fdb",
};

type SampleShot = {
  durationMs: number;
  description: string;
  narrationText: string;
  source: SceneSource;
};

function spec(
  componentId: string,
  durationMs: number,
  seed: number,
  params: Record<string, unknown>,
): SceneSource {
  const scene: SceneSpec = {
    specVersion: 1,
    componentId,
    componentVersion: 1,
    durationMs,
    seed,
    background: "#ffffff",
    params,
  };
  validateSceneSpec(scene, defaultRegistry);
  return { type: "spec", spec: scene };
}

function text(
  title: string,
  subtitle: string,
  durationMs: number,
  seed: number,
): SceneSource {
  return spec("text-animation", durationMs, seed, {
    title,
    subtitle,
    titleColor: "#1b2c29",
    subtitleColor: "#5d7469",
    entrance: "fade-up",
    enterMs: 450,
  });
}

function sampleShots(
  id: GallerySampleId,
  productAsset?: MediaAsset,
): SampleShot[] {
  if (id === "stem")
    return [
      {
        durationMs: 2000,
        description: "开场：提出水循环主题",
        narrationText: "水循环。",
        source: text("水的旅程", "看见一滴水的循环", 2000, 4101),
      },
      {
        durationMs: 2500,
        description: "以四步流程解释水循环",
        narrationText: "蒸发、凝结、降水、汇流。",
        source: spec("flow-steps", 2500, 4102, {
          title: "水循环的四个阶段",
          steps: [
            { label: "蒸发" },
            { label: "凝结" },
            { label: "降水" },
            { label: "汇流" },
          ],
          direction: "horizontal",
          boxColor: "#dcebe1",
          arrowColor: "#2f6f4f",
          textColor: "#1b2c29",
          enterMs: 1200,
        }),
      },
      {
        durationMs: 2500,
        description: "用数字强调地表水与大气持续交换",
        narrationText: "循环从未停止。",
        source: spec("number-counter", 2500, 4103, {
          title: "持续循环",
          value: 100,
          prefix: "",
          suffix: "%",
          decimals: 0,
          countMs: 1500,
          numberColor: "#1b2c29",
          accentColor: "#2f6f4f",
        }),
      },
      {
        durationMs: 2000,
        description: "收尾：回扣水的旅程",
        narrationText: "一滴水，连接万物。",
        source: text("一滴水，连接万物", "探索更多自然科学", 2000, 4104),
      },
    ];
  if (id === "data")
    return [
      {
        durationMs: 2000,
        description: "开场：介绍季度销量数据",
        narrationText: "季度销量观察。",
        source: text("季度销量观察", "用数据看增长", 2000, 4201),
      },
      {
        durationMs: 2800,
        description: "柱状图对比四个季度",
        narrationText: "第四季度达到最高。",
        source: spec("bar-chart", 2800, 4202, {
          title: "四季度销量对比",
          bars: [
            { label: "一季度", value: 32 },
            { label: "二季度", value: 46 },
            { label: "三季度", value: 58 },
            { label: "四季度", value: 82 },
          ],
          barColor: "#2f6f4f",
          accentColor: "#d9822b",
          textColor: "#1b2c29",
          enterMs: 1400,
        }),
      },
      {
        durationMs: 2200,
        description: "关键数字：四季度 82 单位",
        narrationText: "关键数字是八十二。",
        source: spec("number-counter", 2200, 4203, {
          title: "四季度销量",
          value: 82,
          prefix: "",
          suffix: " 单位",
          decimals: 0,
          countMs: 1400,
          numberColor: "#1b2c29",
          accentColor: "#d9822b",
        }),
      },
      {
        durationMs: 2000,
        description: "收尾：给出增长结论",
        narrationText: "趋势清晰可见。",
        source: text("增长，清晰可见", "替换为你的真实数据", 2000, 4204),
      },
    ];
  if (!productAsset || productAsset.original.durationMs < 3000)
    throw new Error("产品样片需要完整的 3 秒商品示例素材");
  return [
    {
      durationMs: 2000,
      description: "品牌开场：FORM 01 帽子",
      narrationText: "FORM 01，日常新形态。",
      source: text("FORM 01", "日常新形态", 2000, 4301),
    },
    {
      durationMs: 3000,
      description: "商品整体画面：保持原始外观与标识",
      narrationText: "经典帽型，细节可见。",
      source: {
        type: "media-clip",
        mediaAssetId: productAsset.assetId,
        inMs: 0,
        outMs: 3000,
        fit: "contain",
        focalX: 0.5,
        audio: "mute",
      },
    },
    {
      durationMs: 2000,
      description: "商品局部画面：帽身与标识",
      narrationText: "让材质与纹理成为主角。",
      source: {
        type: "media-clip",
        mediaAssetId: productAsset.assetId,
        inMs: 500,
        outMs: 2500,
        fit: "cover",
        focalX: 0.5,
        audio: "mute",
      },
    },
    {
      durationMs: 2500,
      description: "卖点文字：简洁造型与日常搭配",
      narrationText: "简洁造型，轻松搭配。",
      source: text("简洁造型", "轻松搭配每一天", 2500, 4304),
    },
    {
      durationMs: 2000,
      description: "品牌收尾：示例品牌占位，发布前请替换",
      narrationText: "FORM 01。",
      source: text("FORM 01", "你的品牌与口号", 2000, 4305),
    },
  ];
}

export async function createGallerySample(
  id: GallerySampleId,
  productAsset?: MediaAsset,
): Promise<{ project: VideoProject; bible: StyleBible | null }> {
  const entry = GALLERY_SAMPLES.find((item) => item.id === id);
  if (!entry) throw new Error("未知样片");
  const now = new Date().toISOString();
  const shots = sampleShots(id, productAsset).map((shot, order) => {
    const versionId = crypto.randomUUID();
    return {
      shotId: crypto.randomUUID(),
      order,
      locked: false,
      workingVersionId: versionId,
      contentVersions: [
        {
          versionId,
          createdAt: now,
          durationMs: shot.durationMs,
          description: shot.description,
          narrationText: shot.narrationText,
          sceneSource: shot.source,
          provenance: { engineId: "gallery-template", engineVersion: "1" },
        },
      ],
      events: [
        {
          kind: "submitted" as const,
          versionId,
          at: now,
          actor: "human" as const,
        },
      ],
    };
  });
  let project: VideoProject = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: entry.title,
    brief: {
      sentence: `样片库：${entry.title}。这是可编辑起点，请在发布前替换示例文案和素材。`,
      aspectTargets: ["landscape", "portrait"],
    },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    ...(productAsset ? { mediaAssets: [productAsset] } : {}),
  };
  const palette = id === "stem" ? STEM_PALETTE : DATA_PALETTE;
  let bible: StyleBible | null = null;
  if (id !== "product") {
    const versionId = crypto.randomUUID();
    bible = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      currentVersionId: versionId,
      versions: [
        {
          versionId,
          createdAt: now,
          name: id === "stem" ? "深蓝科学" : "深蓝数据",
          palette,
          fontFamily: "NotoSansSC",
          lightingPreset: "orbit3d-fixed-soft-studio",
        },
      ],
    };
    project = {
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        contentVersions: shot.contentVersions.map((version) => ({
          ...version,
          sceneSource:
            version.sceneSource.type === "spec"
              ? {
                  type: "spec" as const,
                  spec: styleSceneSpec(
                    version.sceneSource.spec as Record<string, unknown>,
                    bible!.versions[0]!,
                  ),
                }
              : version.sceneSource,
        })),
      })),
    };
    project = await applyStyleBible(project, bible, versionId);
  }
  return { project: validateVideoProject(project), bible };
}
