"use client";
import type { MediaAsset } from "@acs/video-document";
// 「按用途选镜头」配方目录（W1）：卡片带元数据与 SVG 预览，选中后把
// 输入交给上层（page 接 applyShotRecipe 追加到当前项目内存文档）。
import { useMemo, useState } from "react";
import {
  type RecipeInputs,
  recipePreviewSvg,
  SHOT_RECIPES,
  type ShotRecipe,
} from "./shot-recipes";

export type RecipeCatalogProps = {
  busy: boolean;
  mediaAssets: MediaAsset[];
  onApply: (recipeId: string, inputs: RecipeInputs) => string | null; // 返回错误文案；null = 已应用
};

function RecipeInputsForm({
  recipe,
  mediaAssets,
  busy,
  onApply,
}: {
  recipe: ShotRecipe;
  mediaAssets: MediaAsset[];
  busy: boolean;
  onApply: RecipeCatalogProps["onApply"];
}) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [labels, setLabels] = useState("");
  const [values, setValues] = useState("");
  const [assetId, setAssetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const inputs: RecipeInputs = {};
    if (recipe.componentId === "text-animation") {
      if (title.trim()) inputs.title = title.trim();
      if (subtitle.trim()) inputs.subtitle = subtitle.trim();
    } else if (recipe.componentId === "bar-chart") {
      if (title.trim()) inputs.title = title.trim();
      const parsedLabels = labels
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const rawValues = values.split(/[,，]/).map((item) => item.trim());
      const badIndex = rawValues.findIndex(
        (item) => item !== "" && !Number.isFinite(Number(item)),
      );
      if (badIndex >= 0) {
        setError(`第 ${badIndex + 1} 个数值「${rawValues[badIndex]}」不是数字`);
        return;
      }
      const parsedValues = rawValues
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
      if (parsedLabels.length > 0) inputs.labels = parsedLabels;
      if (parsedValues.length > 0) inputs.values = parsedValues;
    } else if (recipe.componentId === "media-clip") {
      if (assetId) inputs.assetId = assetId;
    }
    const failure = onApply(recipe.id, inputs);
    setError(failure);
  };
  return (
    <div className="recipe-inputs">
      {recipe.componentId === "text-animation" ? (
        <>
          <label className="recipe-field">
            主标题
            <input
              className="recipe-title-input"
              value={title}
              maxLength={40}
              placeholder={recipe.placeholders.title?.example}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="recipe-field">
            副标题
            <input
              className="recipe-subtitle-input"
              value={subtitle}
              maxLength={40}
              placeholder={recipe.placeholders.subtitle?.example}
              onChange={(event) => setSubtitle(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {recipe.componentId === "bar-chart" ? (
        <>
          <label className="recipe-field">
            图表标题
            <input
              className="recipe-title-input"
              value={title}
              maxLength={20}
              placeholder={recipe.placeholders.title?.example}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="recipe-field">
            分类（逗号分隔，2–8 个）
            <input
              className="recipe-labels-input"
              value={labels}
              placeholder={recipe.placeholders.labels?.example}
              onChange={(event) => setLabels(event.target.value)}
            />
          </label>
          <label className="recipe-field">
            数值（逗号分隔，与分类一一对应）
            <input
              className="recipe-values-input"
              value={values}
              placeholder={recipe.placeholders.values?.example}
              onChange={(event) => setValues(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {recipe.componentId === "media-clip" ? (
        <label className="recipe-field">
          媒体素材
          <select
            className="recipe-asset-select"
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">— 选择已导入素材 —</option>
            {mediaAssets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.origin.kind === "local-upload"
                  ? asset.origin.fileName
                  : asset.assetId}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="recipe-error">{error}</p> : null}
      <button
        type="button"
        className="recipe-apply"
        disabled={busy}
        onClick={apply}
      >
        添加到项目
      </button>
    </div>
  );
}

export function RecipeCatalog({
  busy,
  mediaAssets,
  onApply,
}: RecipeCatalogProps) {
  const [filter, setFilter] = useState("全部");
  const [openId, setOpenId] = useState<string | null>(null);
  const topics = useMemo(() => {
    const set = new Set<string>();
    for (const recipe of SHOT_RECIPES)
      for (const topic of recipe.topics) set.add(topic);
    return ["全部", ...set];
  }, []);
  // 预览只依赖配方默认输入（固定 seed，见 shot-recipes baseSpec），
  // 按配方缓存，避免编辑器任意击键触发整组重渲与 innerHTML 抖动。
  const previewById = useMemo(() => {
    const map = new Map<string, string>();
    for (const recipe of SHOT_RECIPES)
      map.set(recipe.id, recipePreviewSvg(recipe));
    return map;
  }, []);
  const visible = SHOT_RECIPES.filter(
    (recipe) => filter === "全部" || recipe.topics.includes(filter),
  );
  return (
    <section className="recipe-catalog" aria-label="按用途选镜头">
      <div className="recipe-catalog-heading">
        <div>
          <h2>按用途选镜头</h2>
          <p>
            选择镜头配方，替换文字或素材后追加到当前项目；应用后记得点「保存」。
          </p>
        </div>
      </div>
      <div className="recipe-filters" role="tablist">
        {topics.map((topic) => (
          <button
            key={topic}
            type="button"
            className={`recipe-filter${filter === topic ? " is-active" : ""}`}
            onClick={() => setFilter(topic)}
          >
            {topic}
          </button>
        ))}
      </div>
      <div className="recipe-grid">
        {visible.map((recipe) => (
          <article className="recipe-card" key={recipe.id}>
            <div
              className="recipe-preview"
              aria-label={`${recipe.purpose}预览`}
              dangerouslySetInnerHTML={{
                __html: previewById.get(recipe.id) ?? "",
              }}
            />
            <div className="recipe-card-body">
              <h3>{recipe.purpose}</h3>
              <p className="recipe-meta">
                {recipe.componentId} · {recipe.durationMs.min / 1000}–
                {recipe.durationMs.max / 1000} 秒 · 横竖版 · v{recipe.version}
              </p>
              <ul className="recipe-placeholders">
                {Object.values(recipe.placeholders).map((placeholder) => (
                  <li key={placeholder.label}>
                    {placeholder.label}：{placeholder.example}
                  </li>
                ))}
              </ul>
              <small className="recipe-license">{recipe.license}</small>
              <button
                type="button"
                className="recipe-toggle"
                onClick={() =>
                  setOpenId(openId === recipe.id ? null : recipe.id)
                }
              >
                {openId === recipe.id ? "收起输入" : "填写并添加"}
              </button>
              {openId === recipe.id ? (
                <RecipeInputsForm
                  recipe={recipe}
                  mediaAssets={mediaAssets}
                  busy={busy}
                  onApply={onApply}
                />
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
