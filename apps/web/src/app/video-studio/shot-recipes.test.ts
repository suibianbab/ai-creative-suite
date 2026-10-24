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

test("终审修复：短素材时长契约（durationMs=outMs−inMs）、稀疏 order、working 版本对账、bible 项目拒媒体配方", () => {
  // F1：2.5s 素材 + 默认 3000ms → 镜头时长必须等于片段长度且可保存。
  const shortAsset: MediaAsset = {
    ...exampleAsset,
    assetId: "22222222-3333-4333-8444-555555555555",
    original: { ...exampleAsset.original, durationMs: 2500 },
  };
  const short = applyShotRecipe(
    emptyProject(),
    "recipe-product-clip",
    { assetId: shortAsset.assetId },
    [shortAsset],
  );
  assert.ok("document" in short);
  if (!("document" in short)) return;
  validateVideoProject(short.document);
  const version = short.document.shots[0]!.contentVersions[0]!;
  assert.equal(version.durationMs, 2500);

  // F7：导入件允许稀疏 order（0,5,9）→ 追加 order 须为 max+1。
  const seeded = applyShotRecipe(emptyProject(), "recipe-text-point", {});
  assert.ok("document" in seeded);
  if (!("document" in seeded)) return;
  const template = seeded.document.shots[0]!;
  const sparse = emptyProject();
  sparse.shots = [0, 5, 9].map((order) => {
    const cloneVersionId = crypto.randomUUID();
    return {
      ...template,
      shotId: crypto.randomUUID(),
      order,
      workingVersionId: cloneVersionId,
      contentVersions: [
        { ...template.contentVersions[0]!, versionId: cloneVersionId },
      ],
      events: template.events.map((event) => ({
        ...event,
        versionId: cloneVersionId,
      })),
    };
  });
  const appendedSparse = applyShotRecipe(sparse, "recipe-data-bar", {
    labels: ["A", "B"],
    values: [1, 2],
  });
  assert.ok("document" in appendedSparse);
  if (!("document" in appendedSparse)) return;
  validateVideoProject(appendedSparse.document);
  assert.equal(appendedSparse.document.shots.at(-1)!.order, 10);

  // F4：totalMs 按 working 版本计——镜头修订变长后，filmTotalMsAfter 对账。
  const evolvedBase = applyShotRecipe(emptyProject(), "recipe-text-point", {});
  assert.ok("document" in evolvedBase);
  if (!("document" in evolvedBase)) return;
  const evolved = evolvedBase.document;
  const shot = evolved.shots[0]!;
  const revisedVersionId = crypto.randomUUID();
  shot.contentVersions.push({
    ...shot.contentVersions[0]!,
    versionId: revisedVersionId,
    durationMs: 4000,
  });
  shot.workingVersionId = revisedVersionId;
  const afterRevision = applyShotRecipe(evolved, "recipe-text-point", {});
  assert.ok("document" in afterRevision);
  if (!("document" in afterRevision)) return;
  assert.equal(
    afterRevision.document.brief.applications!.at(-1)!.filmTotalMsAfter,
    7000,
  );

  // F3：链接 Style Bible 的项目拒绝媒体配方（既有风格契约同口径）。
  const bibleProject = {
    ...emptyProject(),
    styleBibleRef: {
      bibleId: "33333333-3333-4333-8333-333333333333",
      versionId: "44444444-4444-4444-8444-444444444444",
      digest: "b".repeat(64),
    },
  };
  const rejected = applyShotRecipe(
    bibleProject,
    "recipe-product-clip",
    { assetId: exampleAsset.assetId },
    [exampleAsset],
  );
  assert.ok("error" in rejected && /Style Bible/.test(rejected.error));
});

test("终审修复：数值上限与编译产物过组件校验", () => {
  // F2a：超过组件上限（1e12）的数值在 build 层拒绝。
  const recipe = SHOT_RECIPES.find((r) => r.id === "recipe-data-bar")!;
  const tooBig = recipe.build({
    labels: ["A", "B"],
    values: [Number.MAX_SAFE_INTEGER, 1],
  });
  assert.ok("error" in tooBig && /数值/.test(tooBig.error));
  // F2b：applyShotRecipe 对编译产物跑 validateSceneSpec——坏 spec 进不了文档。
  const hostile = applyShotRecipe(emptyProject(), "recipe-data-bar", {
    labels: ["A", "B"],
    values: [1e13, 1],
  });
  assert.ok("error" in hostile);
});

test("终审修复：预览确定性——同配方两次预览逐字节一致", () => {
  const text = SHOT_RECIPES.find((r) => r.id === "recipe-text-point")!;
  assert.equal(recipePreviewSvg(text), recipePreviewSvg(text));
});
