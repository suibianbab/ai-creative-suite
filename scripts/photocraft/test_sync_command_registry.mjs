// M4(d) 命令注册表同步口径钉死测试（node --test）：
// 提取规则（含文件名排除）、缺失即失败、禁用只提示、候选 = 已启用且未使用。

import assert from "node:assert/strict";
import test from "node:test";
import { collectUsedIds, diffRegistry } from "./sync-command-registry.mjs";

const SOURCES = new Map([
  [
    "capability-manifest.mjs",
    `const x = { nativeIds: ["layer.newAdjustmentLayer.levels", "image.crop"] };
     const file = "input.pcraft"; const img = "preview.png";`,
  ],
  [
    "worker.ts",
    `steps.push({ id: "select.rect", params: {} });
     run(["convert", input, "source.png"]);`,
  ],
  ["plain.txt", `const label = "not a command"; const url = "https://x.y";`],
]);

test("collectUsedIds extracts dotted command ids and skips filenames", () => {
  const used = collectUsedIds(SOURCES);
  assert.deepEqual([...used.keys()].sort(), [
    "image.crop",
    "layer.newAdjustmentLayer.levels",
    "select.rect",
  ]);
  assert.deepEqual(used.get("image.crop"), ["capability-manifest.mjs"]);
});

test("diffRegistry fails on missing used ids and lists only enabled unused commands", () => {
  const registry = [
    { id: "layer.newAdjustmentLayer.levels", enabled: true, menu: ["Layer"] },
    { id: "image.crop", enabled: false, menu: ["Image"] },
    { id: "select.rect", enabled: true, menu: ["Select"] },
    { id: "filter.gaussianBlur", enabled: true, menu: ["Filter", "Blur"] },
    { id: "filter.disabledExtra", enabled: false, menu: ["Filter"] },
  ];
  const used = collectUsedIds(SOURCES);
  const { missing, disabled, candidates } = diffRegistry(registry, used);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    disabled.map((item) => item.id),
    ["image.crop"],
  );
  // 候选扩容：未使用的已启用命令，按菜单分组；禁用的不算候选。
  assert.deepEqual(candidates.get("Filter › Blur"), ["filter.gaussianBlur"]);
  assert.ok(!candidates.get("Filter")?.includes("filter.disabledExtra"));

  const broken = diffRegistry(registry.slice(0, 2), used);
  assert.deepEqual(
    broken.missing.map((item) => item.id),
    ["select.rect"],
  );
  assert.deepEqual(broken.missing[0].files, ["worker.ts"]);
});

test("candidate groups and used listing are deterministically ordered", () => {
  const registry = [
    { id: "b.one", enabled: true, menu: ["Zed"] },
    { id: "a.two", enabled: true, menu: ["Alpha"] },
    { id: "c.three", enabled: true, menu: ["Zed"] },
  ];
  const { candidates } = diffRegistry(registry, new Map());
  assert.deepEqual([...candidates.keys()], ["Alpha", "Zed"]);
  assert.deepEqual(candidates.get("Zed"), ["b.one", "c.three"]);
});
