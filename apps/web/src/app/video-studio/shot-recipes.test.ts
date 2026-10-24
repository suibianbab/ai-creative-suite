import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type MediaAsset,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import {
  applyShotRecipe,
  recipePreviewSvg,
  SHOT_RECIPES,
} from "./shot-recipes";

const emptyProject = (): VideoProject => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  title: "配方项目",
  brief: { sentence: "从配方开始", aspectTargets: ["landscape", "portrait"] },
  shots: [],
  renderRecords: [],
  deliveries: [],
  savedVersion: 1,
});

const exampleAsset: MediaAsset = {
  assetId: "11111111-2222-4333-8444-555555555555",
  createdAt: "2026-10-24T00:00:00.000Z",
  origin: { kind: "local-upload", fileName: "product.mp4" },
  original: {
    sha256: "a".repeat(64),
    bytes: 99759,
    durationMs: 4000,
    width: 1280,
    height: 720,
    fps: 24,
    codec: "h264",
    hasAudio: false,
    storeKey: `${"a".repeat(16)}.mp4`,
  },
};

const META_KEYS = [
  "id",
  "version",
  "purpose",
  "topics",
  "aspects",
  "durationMs",
  "componentId",
  "placeholders",
  "requiresAsset",
  "license",
  "previewFrame",
  "verified",
  "build",
] as const;

test("三条配方元数据完备且为双画幅已验证状态", () => {
  assert.deepEqual(
    SHOT_RECIPES.map((recipe) => recipe.id),
    ["recipe-text-point", "recipe-data-bar", "recipe-product-clip"],
  );
  for (const recipe of SHOT_RECIPES) {
    for (const key of META_KEYS)
      assert.ok(recipe[key] !== undefined, `${recipe.id} 缺 ${key}`);
    assert.ok(recipe.version >= 1);
    assert.deepEqual(recipe.aspects, ["landscape", "portrait"]);
    assert.equal(recipe.verified, true);
    assert.ok(recipe.purpose.length > 0);
    assert.ok(recipe.topics.length > 0);
    assert.ok(recipe.license.length > 0);
    const { min, defaultMs, max } = recipe.durationMs;
    assert.ok(min <= defaultMs && defaultMs <= max && min >= 1000);
    assert.ok(recipe.previewFrame >= 0);
    for (const placeholder of Object.values(recipe.placeholders)) {
      assert.ok(placeholder.label.length > 0);
      assert.ok(placeholder.example.length > 0);
    }
  }
  assert.equal(
    SHOT_RECIPES.find((r) => r.id === "recipe-product-clip")!.requiresAsset,
    true,
  );
  assert.equal(
    SHOT_RECIPES.find((r) => r.id === "recipe-text-point")!.requiresAsset,
    false,
  );
});

test("文字与数据配方默认输入编译为过校验的 SceneSpec", () => {
  for (const id of ["recipe-text-point", "recipe-data-bar"]) {
    const recipe = SHOT_RECIPES.find((r) => r.id === id)!;
    const built = recipe.build({});
    assert.ok("spec" in built, `${id} 默认输入应编译成功`);
    if ("spec" in built) validateSceneSpec(built.spec, defaultRegistry);
  }
});

test("文字配方替换标题副标题并钳制时长", () => {
  const recipe = SHOT_RECIPES.find((r) => r.id === "recipe-text-point")!;
  const built = recipe.build({
    title: "为什么选择我们",
    subtitle: "三十秒讲清楚",
    durationMs: recipe.durationMs.max + 10_000,
  });
  assert.ok("spec" in built);
  if (!("spec" in built)) return;
  const params = built.spec.params as Record<string, string>;
  assert.equal(params.title, "为什么选择我们");
  assert.equal(params.subtitle, "三十秒讲清楚");
  assert.equal(built.spec.durationMs, recipe.durationMs.max);
  const tooShort = recipe.build({ durationMs: 1 });
  assert.ok("spec" in tooShort);
  if ("spec" in tooShort)
    assert.equal(tooShort.spec.durationMs, recipe.durationMs.min);
});

test("数据配方标签值数量 2..8 校验，越界明确报错", () => {
  const recipe = SHOT_RECIPES.find((r) => r.id === "recipe-data-bar")!;
  const ok = recipe.build({
    labels: ["一月", "二月"],
    values: [10, 20],
  });
  assert.ok("spec" in ok);
  if ("spec" in ok)
    assert.deepEqual(
      (ok.spec.params as { bars: Array<{ label: string }> }).bars.map(
        (bar) => bar.label,
      ),
      ["一月", "二月"],
    );
  for (const bad of [
    { labels: ["仅一项"], values: [1] },
    { labels: ["a", "b", "c"], values: [1, 2] },
  ]) {
    const result = recipe.build(bad);
    assert.ok("error" in result && result.error.length > 0);
  }
});

test("商品配方必须先有资产：无 assetId 时明确报错", () => {
  const recipe = SHOT_RECIPES.find((r) => r.id === "recipe-product-clip")!;
  const result = recipe.build({});
  assert.ok("error" in result);
  assert.match("error" in result ? result.error : "", /媒体素材/);
});

test("配方 SVG 预览：三条各有默认标题文本，用户文本经 XML 转义", () => {
  const text = SHOT_RECIPES.find((r) => r.id === "recipe-text-point")!;
  const data = SHOT_RECIPES.find((r) => r.id === "recipe-data-bar")!;
  const product = SHOT_RECIPES.find((r) => r.id === "recipe-product-clip")!;
  const textSvg = recipePreviewSvg(text);
  assert.ok(textSvg.startsWith("<svg"));
  assert.ok(textSvg.includes("一句话开场"));
  assert.ok(recipePreviewSvg(data).includes("数据对比"));
  const productSvg = recipePreviewSvg(product);
  assert.ok(productSvg.startsWith("<svg"));
  assert.ok(productSvg.includes("商品画面占位"));
  const hostile = recipePreviewSvg(text, { title: `<b>&"` });
  assert.ok(!hostile.includes("<b>"), "预览必须转义用户文本");
  assert.ok(hostile.includes("&lt;b&gt;"));
});

test("应用文字配方：空项目追加为首个镜头，过项目校验，带待保存提示", () => {
  const result = applyShotRecipe(emptyProject(), "recipe-text-point", {
    title: "开场提问",
    subtitle: "三十秒讲清楚",
  });
  assert.ok("document" in result);
  if (!("document" in result)) return;
  validateVideoProject(result.document);
  assert.equal(result.document.shots.length, 1);
  const shot = result.document.shots[0]!;
  const version = shot.contentVersions[0]!;
  assert.equal(version.provenance.engineId, "shot-recipe");
  assert.equal(version.provenance.engineVersion, "1");
  assert.ok(version.narrationText.length > 0);
  assert.ok(version.description.includes("配方"));
  assert.match(result.notice, /保存/);
  assert.equal(result.document.brief.applications?.length, 1);
  assert.match(
    result.document.brief.applications?.[0]?.sentence ?? "",
    /recipe-text-point/,
  );
  assert.equal(result.document.brief.applications?.[0]?.appendedShotCount, 1);
});

test("追加不改动既有镜头；商品配方校验资产并构造受控媒体镜头", () => {
  const first = applyShotRecipe(emptyProject(), "recipe-text-point", {});
  assert.ok("document" in first);
  if (!("document" in first)) return;
  const base = first.document;
  const before = structuredClone(base.shots);
  const appended = applyShotRecipe(base, "recipe-data-bar", {
    labels: ["A", "B"],
    values: [3, 9],
  });
  assert.ok("document" in appended);
  if (!("document" in appended)) return;
  assert.equal(appended.document.shots.length, 2);
  assert.deepEqual(appended.document.shots[0], before[0]);

  const missingAsset = applyShotRecipe(base, "recipe-product-clip", {
    assetId: "not-in-list",
  });
  assert.ok("error" in missingAsset && /素材/.test(missingAsset.error));

  const media = applyShotRecipe(
    base,
    "recipe-product-clip",
    { assetId: exampleAsset.assetId, durationMs: 3000 },
    [exampleAsset],
  );
  assert.ok("document" in media);
  if (!("document" in media)) return;
  validateVideoProject(media.document);
  const source = media.document.shots[1]!.contentVersions[0]!.sceneSource;
  assert.equal(source.type, "media-clip");
  if (source.type === "media-clip") {
    assert.equal(source.mediaAssetId, exampleAsset.assetId);
    assert.equal(source.inMs, 0);
    assert.ok(source.outMs <= exampleAsset.original.durationMs);
  }
  assert.deepEqual(media.document.mediaAssets, [exampleAsset]);
});
