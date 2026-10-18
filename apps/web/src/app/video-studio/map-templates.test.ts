import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyMapTemplate,
  buildMapRevisePatch,
  draftMapFromSpec,
  MAP_TEMPLATES,
} from "./map-templates";

const SPEC: SceneSpec = {
  specVersion: 1,
  componentId: "text-animation",
  componentVersion: 1,
  seed: 7,
  background: "#f5f0e6",
  durationMs: 3000,
  params: { title: "原标题", subtitle: "副标题" },
} as unknown as SceneSpec;

test("模板应用：保留 durationMs/background/seed，深拷贝不污染模板库", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6");
  assert.equal(applied.error, null);
  assert.equal(applied.spec!.componentId, "map-grid");
  assert.equal(applied.spec!.seed, 7);
  assert.equal(applied.spec!.background, "#f5f0e6");
  assert.equal(applied.spec!.durationMs, 3000);
  (applied.spec!.params as { regions: Array<{ label: string }> })
    .regions[0]!.label = "污染";
  assert.notEqual(
    (
      MAP_TEMPLATES.find((t) => t.templateId === "grid-china-6")!.params as {
        regions: Array<{ label: string }>;
      }
    ).regions[0]!.label,
    "污染",
  );
});

test("未知 templateId 报错", () => {
  const applied = applyMapTemplate(SPEC, "nope");
  assert.equal(applied.spec, null);
  assert.equal(applied.error, "未知地图模板 nope");
});

test("grid draft round-trip：有值/无值混合", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const draft = draftMapFromSpec(applied);
  assert.equal(draft.title, "六大区分布示意");
  assert.ok(draft.data.includes("华北,0,1"));
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  assert.deepEqual(
    (rebuilt.spec!.params as { regions: unknown }).regions,
    (applied.params as { regions: unknown }).regions,
  );
  assert.equal(
    (rebuilt.spec!.params as { title: string }).title,
    (applied.params as { title: string }).title,
  );
});

test("journey draft round-trip：waypoint 无标签 → 裸坐标行", () => {
  const applied = applyMapTemplate(SPEC, "journey-route").spec!;
  (applied.params as { waypoints: unknown }).waypoints = [{ x: 400, y: 400 }];
  const draft = draftMapFromSpec(applied);
  assert.ok(draft.data.includes("\n400,400") || draft.data.includes("400,400"));
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  assert.deepEqual((rebuilt.spec!.params as { waypoints: unknown }).waypoints, [
    { x: 400, y: 400 },
  ]);
});

test("含逗号标签 round-trip：从右取字段不丢字", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const draft = draftMapFromSpec(applied);
  draft.data = "甲,乙,0,1,30\n丙,1,2\n丁,戊,3,4";
  const rebuilt = buildMapRevisePatch(applied, draft);
  assert.equal(rebuilt.error, null);
  const regions = (rebuilt.spec!.params as { regions: unknown[] }).regions;
  assert.deepEqual(regions[0], { label: "甲,乙", row: 0, col: 1, value: 30 });
  assert.deepEqual(regions[1], { label: "丙", row: 1, col: 2 });
  // 无值 + 标签含逗号：尾三不全数值 → 无值读法（label 吸收逗号）
  assert.deepEqual(regions[2], { label: "丁,戊", row: 3, col: 4 });
});

test("journey 解析：首末行名称必填（行号错误）、裸坐标行为无标签 waypoint", () => {
  const applied = applyMapTemplate(SPEC, "journey-route").spec!;
  const bad = buildMapRevisePatch(applied, {
    title: "t",
    data: "200,400\n上海,660,720",
  });
  assert.equal(bad.spec, null);
  assert.ok(bad.error!.includes("第 1 行"), bad.error);
  const ok = buildMapRevisePatch(applied, {
    title: "t",
    data: "甲,200,400\n500,300\n丙,800,600",
  });
  assert.equal(ok.error, null);
  const params = ok.spec!.params as {
    origin: { label: string };
    waypoints: Array<{ x: number }>;
    destination: { label: string };
  };
  assert.equal(params.origin.label, "甲");
  assert.deepEqual(params.waypoints, [{ x: 500, y: 300 }]);
  assert.equal(params.destination.label, "丙");
});

test("行号错误 + CRLF/空行/trim 容忍", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const bad = buildMapRevisePatch(applied, {
    title: "t",
    data: "甲,0,0\n乙,9,1",
  });
  assert.equal(bad.spec, null);
  assert.ok(bad.error!.includes("第 2 行"), bad.error);
  const ok = buildMapRevisePatch(applied, {
    title: " t ",
    data: "\r\n  甲,0,0,10  \r\n\r\n乙,0,1 \n",
  });
  assert.equal(ok.error, null);
  assert.equal((ok.spec!.params as { title: string }).title, " t ");
  assert.deepEqual((ok.spec!.params as { regions: unknown[] }).regions, [
    { label: "甲", row: 0, col: 0, value: 10 },
    { label: "乙", row: 0, col: 1 },
  ]);
});

test("合并保留颜色/时长字段；非法数值不落 patch", () => {
  const applied = applyMapTemplate(SPEC, "grid-china-6").spec!;
  const ok = buildMapRevisePatch(applied, { title: "新题", data: "甲,0,0" });
  assert.equal(ok.error, null);
  assert.equal(
    (ok.spec!.params as { baseColor: string }).baseColor,
    (applied.params as { baseColor: string }).baseColor,
  );
  assert.equal(
    (ok.spec!.params as { enterMs: number }).enterMs,
    (applied.params as { enterMs: number }).enterMs,
  );
  const badValue = buildMapRevisePatch(applied, {
    title: "t",
    data: "甲,0,0,-5",
  });
  assert.equal(badValue.spec, null);
  assert.ok(badValue.error!.includes("第 1 行"), badValue.error);
});

test("空数据行数不足报错（grid 至少 1 行、journey 至少 2 行）", () => {
  const grid = applyMapTemplate(SPEC, "grid-china-6").spec!;
  assert.equal(
    buildMapRevisePatch(grid, { title: "t", data: "  \n " }).error,
    "地图数据至少需要一行",
  );
  const journey = applyMapTemplate(SPEC, "journey-route").spec!;
  const one = buildMapRevisePatch(journey, { title: "t", data: "甲,200,400" });
  assert.equal(one.error, "行程数据至少需要起终点两行");
});
