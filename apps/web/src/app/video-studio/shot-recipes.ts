// W1 镜头配方：按用途选镜头的元数据目录与编译核心。配方只编译到已注册
// 组件 spec（或经应用层的受控 media-clip 镜头），不引入第二种项目模型
// 或任意代码入口；应用语义沿用 apply-plan 的「内存追加 + 保存确认」。
import type { MediaAsset, VideoProject } from "@acs/video-document";
import type { SceneSpec } from "@acs/video-scene";

export type RecipeInputs = {
  title?: string;
  subtitle?: string;
  labels?: string[];
  values?: number[];
  assetId?: string;
  durationMs?: number;
};

export type ShotRecipe = {
  id: string;
  version: number;
  purpose: string;
  topics: string[];
  aspects: Array<"landscape" | "portrait">;
  durationMs: { min: number; defaultMs: number; max: number };
  componentId: string;
  placeholders: Record<string, { label: string; example: string }>;
  requiresAsset: boolean;
  license: string;
  previewFrame: number;
  verified: boolean;
  build: (
    inputs: RecipeInputs,
  ) => { spec: SceneSpec } | { error: string };
};

const clampDuration = (
  recipe: { durationMs: { min: number; max: number } },
  raw: number | undefined,
  fallback: number,
) =>
  Math.min(
    recipe.durationMs.max,
    Math.max(recipe.durationMs.min, raw ?? fallback),
  );

const baseSpec = (
  componentId: string,
  durationMs: number,
  params: Record<string, unknown>,
): SceneSpec => ({
  specVersion: 1,
  componentId,
  componentVersion: 1,
  durationMs,
  seed: Math.floor(Math.random() * 9000) + 1000,
  background: "#ffffff",
  params,
});

export const SHOT_RECIPES: readonly ShotRecipe[] = [
  {
    id: "recipe-text-point",
    version: 1,
    purpose: "开场提问或收尾点题：一句话抓住注意力",
    topics: ["文字", "通用"],
    aspects: ["landscape", "portrait"],
    durationMs: { min: 2000, defaultMs: 3000, max: 5000 },
    componentId: "text-animation",
    placeholders: {
      title: { label: "主标题", example: "季度销量观察" },
      subtitle: { label: "副标题", example: "用数据看增长" },
    },
    requiresAsset: false,
    license: "仓库自有程序化文字版式，无第三方素材",
    previewFrame: 60,
    verified: true,
    build(inputs) {
      const durationMs = clampDuration(this, inputs.durationMs, this.durationMs.defaultMs);
      const title = inputs.title?.trim() || "一句话开场";
      const subtitle = inputs.subtitle?.trim() || "副标题补充说明";
      if (title.length > 40 || subtitle.length > 40)
        return { error: "标题与副标题各不超过 40 字" };
      return {
        spec: baseSpec("text-animation", durationMs, {
          title,
          subtitle,
          titleColor: "#1b2c29",
          subtitleColor: "#5d7469",
          entrance: "fade-up",
          enterMs: 450,
        }),
      };
    },
  },
  {
    id: "recipe-data-bar",
    version: 1,
    purpose: "数据对比结论：柱状图讲清一组数字",
    topics: ["数据", "通用"],
    aspects: ["landscape", "portrait"],
    durationMs: { min: 2400, defaultMs: 2800, max: 5000 },
    componentId: "bar-chart",
    placeholders: {
      title: { label: "图表标题", example: "四季度销量对比" },
      labels: { label: "分类名（2–8 个，逗号分隔）", example: "一季度, 二季度, 三季度, 四季度" },
      values: { label: "数值（与分类一一对应）", example: "32, 46, 58, 82" },
    },
    requiresAsset: false,
    license: "仓库自有程序化图表，无第三方素材",
    previewFrame: 60,
    verified: true,
    build(inputs) {
      const durationMs = clampDuration(this, inputs.durationMs, this.durationMs.defaultMs);
      const labels =
        inputs.labels === undefined && inputs.values === undefined
          ? ["一季度", "二季度", "三季度", "四季度"]
          : inputs.labels?.map((label) => label.trim()).filter(Boolean) ?? [];
      const values =
        inputs.labels === undefined && inputs.values === undefined
          ? [32, 46, 58, 82]
          : inputs.values ?? [];
      if (labels.length < 2 || labels.length > 8)
        return { error: "分类数量须为 2..8 个" };
      if (values.length !== labels.length)
        return { error: "数值数量须与分类一一对应" };
      if (values.some((value) => !Number.isFinite(value) || value < 0))
        return { error: "数值须为非负数字" };
      if (labels.some((label) => label.length > 6))
        return { error: "分类名不超过 6 字（图表标签截断口径）" };
      const title = inputs.title?.trim() || "数据对比";
      if (title.length > 20) return { error: "图表标题不超过 20 字" };
      return {
        spec: baseSpec("bar-chart", durationMs, {
          title,
          bars: labels.map((label, index) => ({ label, value: values[index]! })),
          barColor: "#2f6f4f",
          accentColor: "#d9822b",
          textColor: "#1b2c29",
          enterMs: 1400,
        }),
      };
    },
  },
  {
    id: "recipe-product-clip",
    version: 1,
    purpose: "商品实拍画面：用真实素材展示产品",
    topics: ["商品", "通用"],
    aspects: ["landscape", "portrait"],
    durationMs: { min: 2000, defaultMs: 3000, max: 6000 },
    componentId: "media-clip",
    placeholders: {
      assetId: { label: "项目内媒体素材", example: "（从已导入素材中选择）" },
    },
    requiresAsset: true,
    license: "画面素材由用户自备并自负授权；配方本身为程序化参数",
    previewFrame: 60,
    verified: true,
    // media-clip 是 sceneSource 级目标而非 params 级 spec，编译发生在
    // applyShotRecipe 的资产分支；build 仅把「无资产」显式挡下。
    build(inputs) {
      if (!inputs.assetId) return { error: "请先选择项目内的媒体素材" };
      return { error: "商品画面配方经「添加到项目」按所选素材编译" };
    },
  },
];
