// P2.5-T3：apply 基底提取（spec §1 裁定）——机械共体：找模板→深拷贝→validate 门。
import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import { applySceneTemplate } from "./apply-template";
import { CHART_TEMPLATES } from "./chart-templates";

const BASE: SceneSpec = {
  specVersion: 1,
  componentId: "text-animation",
  componentVersion: 1,
  durationMs: 2000,
  seed: 7,
  background: "#ffffff",
  params: { title: "旧标题" },
};

test("未知模板 → `${label} ${templateId}`（文案由调用方给）", () => {
  const result = applySceneTemplate(CHART_TEMPLATES, BASE, "nope", "未知测试模板");
  assert.equal(result.error, "未知测试模板 nope");
  assert.equal(result.spec, null);
});

test("合法模板 → 换组件且 params 深拷贝（改产物不回流模板库）", () => {
  const result = applySceneTemplate(
    CHART_TEMPLATES,
    BASE,
    "counter-kpi",
    "未知图表模板",
  );
  assert.ok(result.spec);
  assert.equal(result.spec.componentId, "number-counter");
  assert.equal(result.spec.componentVersion, 1);
  assert.equal(result.spec.seed, 7, "seed 沿基底");
  const template = CHART_TEMPLATES.find((t) => t.templateId === "counter-kpi")!;
  const before = JSON.stringify(template.params);
  (result.spec.params as Record<string, unknown>).title = "被我改掉";
  assert.equal(JSON.stringify(template.params), before, "模板参数不得被污染");
});

test("模板 params 非法 → validateSceneSpec 消息透传", () => {
  const bad = [{ templateId: "bad", componentId: "bar-chart", params: {} }];
  const result = applySceneTemplate(bad, BASE, "bad", "未知图表模板");
  assert.ok(result.error);
  assert.notEqual(result.error, "未知图表模板 bad");
});
