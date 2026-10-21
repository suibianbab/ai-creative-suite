import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import { planFromSentence, reseedSpecParams } from "./planner.js";
import {
  attachDescription,
  buildRevisePatch,
  draftDurationMs,
  draftFromWorking,
  type ShotEditDraft,
  speechOverflowMs,
} from "./shot-edit.js";

// —— 分镜编辑器纯逻辑：草稿构造 / 校验 / 语速溢出 ——

function lineSpec() {
  const plan = planFromSentence("做一个10秒的线描动画，标题是水循环");
  if (!plan.ok) throw new Error("planner fixture failed");
  return plan.spec;
}

function textSpec() {
  const plan = planFromSentence("做一个10秒的文字动画，标题是水循环");
  if (!plan.ok) throw new Error("planner fixture failed");
  return plan.spec;
}

// 草稿工厂：以真实 spec 的默认草稿为底，按需覆盖。
function draft(overrides: Partial<ShotEditDraft> = {}): ShotEditDraft {
  const spec = lineSpec();
  const base = draftFromWorking(
    {
      narrationText: "水循环。",
      durationMs: spec.durationMs,
      description: "",
    },
    spec,
  );
  return { ...base, ...overrides };
}

test("draftFromWorking：旁白/时长取 working，画面字段取 spec", () => {
  const spec = textSpec();
  const d = draftFromWorking(
    { narrationText: "水循环。", durationMs: 10000, description: "" },
    spec,
  );
  assert.equal(d.narrationText, "水循环。");
  assert.equal(d.background, spec.background);
  assert.equal(d.durationSeconds, 10);
  assert.equal(d.title, "水循环");
  assert.equal(d.subtitle, "");
  assert.equal(d.templateAdvanced, false);
});

test("draftFromWorking：非文字动画的标题草稿为空（不经标题输入编辑）", () => {
  const spec = lineSpec();
  const d = draftFromWorking(
    { narrationText: "", durationMs: 10000, description: "" },
    spec,
  );
  assert.equal(d.title, "");
});

test("draftDurationMs：秒转毫秒并取整", () => {
  assert.deepEqual(draftDurationMs(draft({ durationSeconds: 2 })), {
    durationMs: 2000,
  });
});

test("draftDurationMs：小于 1ms 拒绝", () => {
  const result = draftDurationMs(draft({ durationSeconds: 0.0004 }));
  assert.ok("error" in result);
  assert.equal(result.error, "时长须在 0.001s–600s 之间");
});

test("draftDurationMs：超过 600s 拒绝", () => {
  const result = draftDurationMs(draft({ durationSeconds: 600.0005 }));
  assert.ok("error" in result);
  assert.equal(result.error, "时长须在 0.001s–600s 之间");
});

test("buildRevisePatch：坏背景色拒绝", () => {
  const { patch, error } = buildRevisePatch(
    draft({ background: "#12gzz5" }),
    lineSpec(),
  );
  assert.equal(patch, null);
  assert.match(error!, /背景色/);
});

test("buildRevisePatch：时长越界拒绝（0s 与 700s）", () => {
  assert.equal(
    buildRevisePatch(draft({ durationSeconds: 0 }), lineSpec()).patch,
    null,
  );
  const tooLong = buildRevisePatch(draft({ durationSeconds: 700 }), lineSpec());
  assert.equal(tooLong.patch, null);
  assert.match(tooLong.error!, /时长/);
});

test("buildRevisePatch：文字动画空标题拒绝", () => {
  const { patch, error } = buildRevisePatch(draft({ title: "  " }), textSpec());
  assert.equal(patch, null);
  assert.match(error!, /标题/);
});

test("buildRevisePatch：合法草稿产出完整 spec patch", () => {
  const spec = textSpec();
  const { patch, error } = buildRevisePatch(
    draft({ background: "#102030", durationSeconds: 3.5, title: "蒸发" }),
    spec,
  );
  assert.equal(error, null);
  const nextSpec = patch!.spec as ReturnType<typeof textSpec>;
  assert.equal(nextSpec.background, "#102030");
  assert.equal(nextSpec.durationMs, 3500);
  assert.equal((nextSpec.params as { title: string }).title, "蒸发");
  assert.equal(patch!.narrationText, draft().narrationText);
  validateSceneSpec(nextSpec, defaultRegistry); // patch 的 spec 仍过注册表校验
});

test("buildRevisePatch：换模板 → seed+1 且 params 来自模板表", () => {
  const spec = lineSpec();
  const { patch, error } = buildRevisePatch(
    draft({ templateAdvanced: true }),
    spec,
  );
  assert.equal(error, null);
  const nextSpec = patch!.spec as ReturnType<typeof lineSpec>;
  assert.equal(nextSpec.seed, spec.seed + 1);
  assert.deepEqual(
    nextSpec.params,
    reseedSpecParams(spec, spec.seed + 1).params,
  );
  assert.notDeepEqual(nextSpec.params, spec.params);
});

test("buildRevisePatch：不换模板 → params/seed 原样", () => {
  const spec = lineSpec();
  const { patch, error } = buildRevisePatch(
    draft({ background: "#abcdef" }),
    spec,
  );
  assert.equal(error, null);
  const nextSpec = patch!.spec as ReturnType<typeof lineSpec>;
  assert.equal(nextSpec.seed, spec.seed);
  assert.deepEqual(nextSpec.params, spec.params);
});

test("buildRevisePatch：超长标题被注册表校验拒绝（不进文档）", () => {
  // 终评 Critical：81 字标题越过草稿校验会把非法 spec 写进仅追加文档，
  // 整片时间线随之降级——注册表校验必须在本模块内把关。
  const { patch, error } = buildRevisePatch(
    draft({ title: "字".repeat(81) }),
    textSpec(),
  );
  assert.equal(patch, null);
  assert.match(error!, /1\.\.80/);
  const subtitleTooLong = buildRevisePatch(
    draft({ title: "水循环", subtitle: "副".repeat(81) }),
    textSpec(),
  );
  assert.equal(subtitleTooLong.patch, null);
  assert.match(subtitleTooLong.error!, /subtitle/);
});

test("buildRevisePatch：80 字标题与空副标题合法（门禁不过严）", () => {
  const { patch, error } = buildRevisePatch(
    draft({ title: "字".repeat(80), subtitle: "" }),
    textSpec(),
  );
  assert.equal(error, null);
  const nextSpec = patch!.spec as ReturnType<typeof textSpec>;
  assert.equal((nextSpec.params as { title: string }).title.length, 80);
  assert.equal("subtitle" in (nextSpec.params as object), false);
});

test("buildRevisePatch：清空副标题后旧副标题不残留", () => {
  // 终评 Important：subtitle 条件展开会让既有副标题永远删不掉。
  const spec = {
    ...textSpec(),
    params: { ...(textSpec().params as object), subtitle: "旧副标题" },
  };
  const d = draftFromWorking(
    { narrationText: "水循环。", durationMs: spec.durationMs, description: "" },
    spec,
  );
  const { patch, error } = buildRevisePatch({ ...d, subtitle: "" }, spec);
  assert.equal(error, null);
  const nextSpec = patch!.spec as typeof spec;
  assert.equal("subtitle" in (nextSpec.params as object), false);
});

test("镜头说明：草稿带出、附着时去空白、空与超长被拒", () => {
  const spec = textSpec();
  const draft = draftFromWorking(
    { narrationText: "旁白", durationMs: 8000, description: "开场说明" },
    spec,
  );
  assert.equal(draft.description, "开场说明");
  assert.deepEqual(
    attachDescription({ narrationText: "旁白" }, "  开场说明  "),
    {
      patch: { narrationText: "旁白", description: "开场说明" },
    },
  );
  const empty = attachDescription({}, "   ");
  assert.ok("error" in empty);
  assert.equal(empty.error, "镜头说明不能为空");
  const tooLong = attachDescription({}, "字".repeat(201));
  assert.ok("error" in tooLong);
  assert.equal(tooLong.error, "镜头说明不能超过 200 字符");
  const atLimit = attachDescription({}, "字".repeat(200));
  assert.ok("patch" in atLimit);
  assert.equal(atLimit.patch.description.length, 200);
});

test("speechOverflowMs：语速估计超时长为正，否则 0", () => {
  // 5 字旁白（无标点）→ 400 + 5*300 = 1900ms；2s 时长容得下，1s 溢出 900
  assert.equal(
    speechOverflowMs(
      draft({ narrationText: "一二三四五", durationSeconds: 2 }),
    ),
    0,
  );
  assert.equal(
    speechOverflowMs(
      draft({ narrationText: "一二三四五", durationSeconds: 1 }),
    ),
    900,
  );
});
