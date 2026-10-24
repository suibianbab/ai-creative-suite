import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import { SHOT_RECIPES } from "./shot-recipes";

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
  assert.equal(built.spec.params.title, "为什么选择我们");
  assert.equal(built.spec.params.subtitle, "三十秒讲清楚");
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
  assert.match(
    "error" in result ? result.error : "",
    /媒体素材/,
  );
});
