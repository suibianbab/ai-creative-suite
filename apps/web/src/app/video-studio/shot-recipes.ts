// W1 镜头配方：按用途选镜头的元数据目录与编译核心。配方只编译到已注册
// 组件 spec（或经应用层的受控 media-clip 镜头），不引入第二种项目模型
// 或任意代码入口；应用语义沿用 apply-plan 的「内存追加 + 保存确认」。
import type {
  MediaAsset,
  SceneSource,
  VideoProject,
} from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  type SvgNode,
  validateSceneSpec,
} from "@acs/video-scene";

export type RecipeInputs = {
  title?: string;
  subtitle?: string;
  labels?: string[];
  values?: number[];
  assetId?: string;
  durationMs?: number;
  narrationText?: string;
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
  build: (inputs: RecipeInputs) => { spec: SceneSpec } | { error: string };
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
  seed: number,
): SceneSpec => ({
  specVersion: 1,
  componentId,
  // Codex P2-4：enterMs/sequence 感知组件用 @2（@1 拒绝这两个字段）。
  componentVersion:
    componentId === "compare-split" || componentId === "timeline-milestones"
      ? 2
      : 1,
  durationMs,
  // 预览/出片同源：配方用固定 seed，同一输入永远同一画面。
  seed,
  background: "#ffffff",
  params,
});

// 预览帧的序列化：属性值与文本一律 XML 转义（用户输入会进入 SVG）。
const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function serializeNode(node: SvgNode): string {
  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
  const children = (node.children ?? [])
    .map((child) => serializeNode(child))
    .join("");
  const text = node.text ? escapeXml(node.text) : "";
  return `<${node.tag}${attrs}>${text}${children}</${node.tag}>`;
}

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;

function placeholderSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}"><rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="#141a22"/><rect x="70" y="45" width="180" height="80" rx="8" fill="#223247" stroke="#4aa3d9" stroke-width="2"/><text x="160" y="92" fill="#eef3f8" font-family="sans-serif" font-size="14" text-anchor="middle">${escapeXml(label)}</text></svg>`;
}

export function recipePreviewSvg(
  recipe: ShotRecipe,
  inputs: RecipeInputs = {},
): string {
  if (recipe.componentId === "media-clip")
    return placeholderSvg("商品画面占位");
  const attempt = recipe.build(inputs);
  const built = "spec" in attempt ? attempt : recipe.build({});
  if (!("spec" in built)) return placeholderSvg("预览暂不可用");
  const spec = built.spec;
  const durationFrames = Math.ceil((spec.durationMs / 1000) * 24);
  const node = defaultRegistry
    .get(spec.componentId, spec.componentVersion)
    .render(spec, {
      frame: Math.min(recipe.previewFrame, durationFrames - 1),
      fps: 24,
      durationFrames,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      random: () => 0.42,
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">${serializeNode(node)}</svg>`;
}

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
      const durationMs = clampDuration(
        this,
        inputs.durationMs,
        this.durationMs.defaultMs,
      );
      const title = inputs.title?.trim() || "一句话开场";
      const subtitle = inputs.subtitle?.trim() || "副标题补充说明";
      if (title.length > 40 || subtitle.length > 40)
        return { error: "标题与副标题各不超过 40 字" };
      return {
        spec: baseSpec(
          "text-animation",
          durationMs,
          {
            title,
            subtitle,
            titleColor: "#1b2c29",
            subtitleColor: "#5d7469",
            entrance: "fade-up",
            enterMs: 450,
          },
          4601,
        ),
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
      labels: {
        label: "分类名（2–8 个，逗号分隔）",
        example: "一季度, 二季度, 三季度, 四季度",
      },
      values: { label: "数值（与分类一一对应）", example: "32, 46, 58, 82" },
    },
    requiresAsset: false,
    license: "仓库自有程序化图表，无第三方素材",
    previewFrame: 60,
    verified: true,
    build(inputs) {
      const durationMs = clampDuration(
        this,
        inputs.durationMs,
        this.durationMs.defaultMs,
      );
      const labels =
        inputs.labels === undefined && inputs.values === undefined
          ? ["一季度", "二季度", "三季度", "四季度"]
          : (inputs.labels?.map((label) => label.trim()).filter(Boolean) ?? []);
      const values =
        inputs.labels === undefined && inputs.values === undefined
          ? [32, 46, 58, 82]
          : (inputs.values ?? []);
      if (labels.length < 2 || labels.length > 8)
        return { error: "分类数量须为 2..8 个" };
      if (values.length !== labels.length)
        return { error: "数值数量须与分类一一对应" };
      if (values.some((value) => !Number.isFinite(value) || value < 0))
        return { error: "数值须为非负数字" };
      if (values.some((value) => value > 1e12))
        return { error: "数值须不超过 1e12（组件上限）" };
      if (labels.some((label) => label.length > 6))
        return { error: "分类名不超过 6 字（图表标签截断口径）" };
      const title = inputs.title?.trim() || "数据对比";
      if (title.length > 20) return { error: "图表标题不超过 20 字" };
      return {
        spec: baseSpec(
          "bar-chart",
          durationMs,
          {
            title,
            bars: labels.map((label, index) => ({
              label,
              value: values[index]!,
            })),
            barColor: "#2f6f4f",
            accentColor: "#d9822b",
            textColor: "#1b2c29",
            enterMs: 1400,
          },
          4602,
        ),
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
  {
    id: "recipe-compare-split",
    version: 1,
    purpose: "前后对比：左旧右新分栏，差值徽章直观展示改善/恶化",
    topics: ["对比", "数据"],
    aspects: ["landscape", "portrait"],
    durationMs: { min: 2400, defaultMs: 3200, max: 5000 },
    componentId: "compare-split",
    placeholders: {
      title: { label: "对比标题", example: "上线前后响应速度" },
      beforeValue: { label: "前值", example: "8.2 秒" },
      afterValue: { label: "后值", example: "1.4 秒" },
    },
    requiresAsset: false,
    license: "仓库自有程序化布局，无第三方素材",
    previewFrame: 60,
    verified: true,
    build(inputs) {
      const durationMs = Math.min(
        this.durationMs.max,
        Math.max(
          this.durationMs.min,
          inputs.durationMs ?? this.durationMs.defaultMs,
        ),
      );
      const title = inputs.title?.trim() || "前后对比";
      const beforeValue = inputs.subtitle?.trim() || "旧数据";
      const afterValue = inputs.labels?.[0]?.trim() || "新数据";
      return {
        spec: baseSpec(
          "compare-split",
          durationMs,
          {
            title,
            metricLabel: "关键指标",
            beforeLabel: "改造前",
            beforeValue,
            beforeNote: "原始基线",
            afterLabel: "改造后",
            afterValue,
            afterNote: "优化结果",
            deltaText: `${beforeValue} → ${afterValue}`,
            deltaPositive: true,
            textColor: "#1b2c29",
            panelColor: "#e8f0eb",
            accentColor: "#d9822b",
            positiveColor: "#2f6f4f",
            negativeColor: "#b3261e",
            enterMs: 1200,
          },
          4701,
        ),
      };
    },
  },
  {
    id: "recipe-timeline-milestones",
    version: 1,
    purpose: "里程碑时间轴：节点式展示项目/计划的各阶段与完成状态",
    topics: ["规划", "通用"],
    aspects: ["landscape", "portrait"],
    durationMs: { min: 2400, defaultMs: 3600, max: 6000 },
    componentId: "timeline-milestones",
    placeholders: {
      title: { label: "时间轴标题", example: "产品路线图" },
      labels: {
        label: "节点标签（逗号分隔，2–6 个）",
        example: "调研, 设计, 开发, 上线",
      },
    },
    requiresAsset: false,
    license: "仓库自有程序化布局，无第三方素材",
    previewFrame: 60,
    verified: true,
    build(inputs) {
      const durationMs = Math.min(
        this.durationMs.max,
        Math.max(
          this.durationMs.min,
          inputs.durationMs ?? this.durationMs.defaultMs,
        ),
      );
      const labels = inputs.labels?.map((l) => l.trim()).filter(Boolean) ?? [
        "调研",
        "设计",
        "开发",
        "上线",
      ];
      if (labels.length < 2 || labels.length > 6)
        return { error: "里程碑数量须为 2..6 个" };
      const title = inputs.title?.trim() || "里程碑";
      const statuses: Array<"done" | "active" | "pending"> = labels.map(
        (_, i) =>
          i < labels.length - 2
            ? "done"
            : i === labels.length - 2
              ? "active"
              : "pending",
      );
      return {
        spec: baseSpec(
          "timeline-milestones",
          durationMs,
          {
            title,
            milestones: labels.map((label, i) => ({
              date: `Q${i + 1}`,
              label,
              status: statuses[i],
            })),
            textColor: "#1b2c29",
            lineColor: "#c8d4cd",
            doneColor: "#2f6f4f",
            activeColor: "#d9822b",
            pendingColor: "#9aa8a0",
            enterMs: 1400,
          },
          4702,
        ),
      };
    },
  },
];

const DEFAULT_NARRATION: Record<string, string> = {
  "recipe-text-point": "一句话开场，点出主题。",
  "recipe-data-bar": "用一组数字，讲清对比结论。",
  "recipe-product-clip": "来看产品的真实画面。",
};

// 应用配方：向当前项目内存文档追加一个普通 ContentVersion 镜头（与
// apply-plan 同款「追加 + 待保存确认」语义，不直接落库）。media-clip
// 是 sceneSource 级目标，走资产分支构造受控媒体镜头。
export function applyShotRecipe(
  document: VideoProject,
  recipeId: string,
  inputs: RecipeInputs,
  mediaAssets: MediaAsset[] = [],
): { document: VideoProject; notice: string } | { error: string } {
  const recipe = SHOT_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) return { error: `未知配方：${recipeId}` };
  // 风格契约同口径：外部媒体画面无法由 Style Bible 保证——链接风格的
  // 项目明确拒绝媒体配方，而不是等保存/出片才失败。
  if (recipe.componentId === "media-clip" && document.styleBibleRef)
    return {
      error:
        "项目已链接 Style Bible，不支持媒体镜头配方（外部画面无法由风格规范保证）",
    };
  let durationMs = Math.min(
    recipe.durationMs.max,
    Math.max(
      recipe.durationMs.min,
      inputs.durationMs ?? recipe.durationMs.defaultMs,
    ),
  );
  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();
  let sceneSource: SceneSource;
  let usedAsset: MediaAsset | null = null;
  if (recipe.componentId === "media-clip") {
    const asset = mediaAssets.find((item) => item.assetId === inputs.assetId);
    if (!asset) return { error: "请先选择项目内已导入的媒体素材" };
    if (asset.original.durationMs < 200)
      return { error: "媒体素材短于 200 毫秒，不能创建有效镜头" };
    usedAsset = asset;
    // 媒体镜头契约：durationMs 必须等于 outMs−inMs。素材比配方时长短时，
    // 镜头时长取片段长度，而不是留下保存必炸的半吊子镜头。
    durationMs = Math.min(durationMs, asset.original.durationMs);
    sceneSource = {
      type: "media-clip",
      mediaAssetId: asset.assetId,
      inMs: 0,
      outMs: durationMs,
      fit: "contain",
      focalX: 0.5,
      audio: "mute",
    };
  } else {
    const built = recipe.build(inputs);
    if (!("spec" in built)) return { error: built.error };
    const spec =
      built.spec.durationMs === durationMs
        ? built.spec
        : { ...built.spec, durationMs };
    // 编译产物必须过组件校验（含用户输入分支），坏 spec 不进文档。
    try {
      validateSceneSpec(spec, defaultRegistry);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "配方参数无效",
      };
    }
    sceneSource = { type: "spec", spec };
  }
  const narrationText =
    inputs.narrationText?.trim() ||
    DEFAULT_NARRATION[recipeId] ||
    recipe.purpose;
  const shot = {
    shotId: crypto.randomUUID(),
    // 导入件允许 order 跳号（校验只要求严格升序）——追加位取 max+1。
    order:
      document.shots.reduce((max, item) => Math.max(max, item.order), -1) + 1,
    locked: false,
    workingVersionId: versionId,
    contentVersions: [
      {
        versionId,
        createdAt: now,
        durationMs,
        description: `配方镜头：${recipe.purpose}`,
        narrationText,
        sceneSource,
        provenance: {
          engineId: "shot-recipe",
          engineVersion: String(recipe.version),
        },
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
  const shots = [...document.shots, shot];
  const isFirst = document.shots.length === 0;
  // 对账口径与 apply-plan 一致：按工作版本时长累计（film*After 可与
  // shots 的 working 版本总时长对账，见 BriefApplication 契约）。
  const totalMs = shots.reduce((ms, item) => {
    const working = item.contentVersions.find(
      (version) => version.versionId === item.workingVersionId,
    );
    return ms + (working ?? item.contentVersions[0]!).durationMs;
  }, 0);
  return {
    document: {
      ...document,
      shots,
      // media-clip 契约：镜头引用的资产必须在项目账本内（账本只追加）。
      ...(usedAsset
        ? {
            mediaAssets: (document.mediaAssets ?? []).some(
              (item) => item.assetId === usedAsset!.assetId,
            )
              ? document.mediaAssets
              : [...(document.mediaAssets ?? []), usedAsset],
          }
        : {}),
      brief: {
        ...document.brief,
        applications: [
          ...(document.brief.applications ?? []),
          {
            sentence: `镜头配方 ${recipeId}：${recipe.purpose}`,
            appendedShotCount: 1,
            appendedDurationMs: durationMs,
            filmShotCountAfter: shots.length,
            filmTotalMsAfter: totalMs,
            appliedAt: now,
          },
        ],
      },
    },
    notice: isFirst
      ? `已应用配方（首个镜头 / ${(totalMs / 1000).toFixed(1)} 秒）到当前项目，确认无误后点「保存」`
      : `已追加配方镜头（整片 ${shots.length} 个镜头 / ${(totalMs / 1000).toFixed(1)} 秒），确认无误后点「保存」`,
  };
}
