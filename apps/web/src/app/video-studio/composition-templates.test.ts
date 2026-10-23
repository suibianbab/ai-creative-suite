import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRegistry,
  type ExplainerParams,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";
import {
  applyCompositionDraft,
  applyCompositionTemplate,
  COMPOSITION_TEMPLATES,
  compositionReviseDraft,
  isCompositionTemplateId,
} from "./composition-templates.js";
import { draftFromWorking } from "./shot-edit.js";

const base: SceneSpec = {
  specVersion: 1,
  componentId: "text-animation",
  componentVersion: 1,
  durationMs: 4000,
  seed: 7,
  background: "#102033",
  params: {
    title: "旧镜头",
    titleColor: "#ffffff",
    subtitleColor: "#ffffff",
    entrance: "fade-up",
    enterMs: 500,
  },
};

test("多元素模板是有界 SceneSpec 预填，可替换题材并再次编辑", () => {
  for (const template of COMPOSITION_TEMPLATES) {
    const applied = applyCompositionTemplate(base, template.templateId);
    assert.ok(applied.spec, applied.error ?? "template failed");
    assert.equal(applied.spec!.componentId, "explainer-composition");
    assert.equal(applied.spec!.background, "#102033");
    assert.equal(applied.spec!.seed, base.seed);
    validateSceneSpec(applied.spec, defaultRegistry);
    const draft = structuredClone(applied.spec!.params as ExplainerParams);
    draft.title = "客厅改造方案";
    draft.annotations[0]!.text = "先确定家具布局";
    if (draft.diagram.kind === "image") {
      const waiting = applyCompositionDraft(applied.spec!, draft);
      assert.match(waiting.error ?? "", /上传图片/);
      continue;
    }
    const revised = applyCompositionDraft(applied.spec!, draft);
    assert.equal(revised.error, null);
    assert.equal(
      (revised.spec!.params as ExplainerParams).title,
      "客厅改造方案",
    );
    assert.equal(
      (applied.spec!.params as ExplainerParams).title,
      template.params.title,
      "模板与第一次应用产物不得被草稿污染",
    );
  }
});

test("多元素模板非法草稿不产生可保存的 spec", () => {
  const applied = applyCompositionTemplate(base, "composition-process-4");
  assert.ok(applied.spec);
  const draft = structuredClone(applied.spec!.params as ExplainerParams);
  draft.annotations[0]!.y = 900;
  const bad = applyCompositionDraft(applied.spec!, draft);
  assert.equal(bad.spec, null);
  assert.match(bad.error!, /annotations/);
});

test("组合模板 ID 识别与背景交接使用同一族判定", () => {
  assert.equal(isCompositionTemplateId("composition-process-4"), true);
  assert.equal(isCompositionTemplateId("composition-future"), true);
  assert.equal(isCompositionTemplateId("chart-line"), false);
  const draft = draftFromWorking(
    { narrationText: "", durationMs: 4000, description: "镜头" },
    { ...base, background: "#ffffff" },
  );
  const composed = { ...base, background: "#102033" };
  assert.equal(
    compositionReviseDraft("composition-process-4", draft, composed, false)
      .background,
    "#102033",
    "未手改背景时，应用组合模板应采用模板底色",
  );
  assert.equal(
    compositionReviseDraft("composition-process-4", draft, composed, true)
      .background,
    "#ffffff",
    "即使输入先改色又改回原值，手改状态仍须优先",
  );
  assert.equal(
    compositionReviseDraft("chart-line", draft, composed, false).background,
    "#ffffff",
    "其它模板族不得交接组合底色",
  );
});
