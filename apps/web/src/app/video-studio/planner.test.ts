import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import { planFromSentence } from "./planner.js";

test("合法文字动画句 → ok，spec 通过注册表校验", () => {
  const result = planFromSentence(
    "做一个12秒的文字动画，标题是云制作，副标题是Video Studio",
  );
  assert.ok(result.ok);
  assert.equal(result.spec.componentId, "text-animation");
  assert.equal(result.spec.durationMs, 12000);
  assert.equal((result.spec.params as { title: string }).title, "云制作");
  assert.equal(
    (result.spec.params as { subtitle: string }).subtitle,
    "Video Studio",
  );
  assert.equal(result.title, "云制作");
  validateSceneSpec(result.spec, defaultRegistry); // 构造结果必须过兜底校验
});

test("同句同 seed：两次规划结果逐字段一致", () => {
  const a = planFromSentence("做一个6秒的图形动画，标题是发布");
  const b = planFromSentence("做一个6秒的图形动画，标题是发布");
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.spec, b.spec);
});

test("线描与图形句 → ok 且各自落到对应组件", () => {
  const line = planFromSentence("做一个6秒的线描动画，标题是山");
  assert.ok(line.ok);
  assert.equal(line.spec.componentId, "line-drawing");
  validateSceneSpec(line.spec, defaultRegistry);
  const shapes = planFromSentence("做一个6秒的图形动画，标题是发布");
  assert.ok(shapes.ok);
  assert.equal(shapes.spec.componentId, "basic-shapes");
  validateSceneSpec(shapes.spec, defaultRegistry);
});

test("背景色可选：合法 hex 进 spec，非法 hex 拒绝", () => {
  const ok = planFromSentence(
    "做一个12秒的文字动画，标题是云制作，背景是#16203a",
  );
  assert.ok(ok.ok);
  assert.equal(ok.spec.background, "#16203a");
  const bad = planFromSentence(
    "做一个12秒的文字动画，标题是云制作，背景是#zzzzzz",
  );
  assert.ok(!bad.ok);
});

test("缺标题 → fail，guidance 含完整语法示例", () => {
  const result = planFromSentence("做一个8秒的线描动画");
  assert.ok(!result.ok);
  assert.match(
    result.guidance,
    /做一个<秒数>秒的<文字\|线描\|图形>动画，标题是<文本>/,
  );
});

test("类型未知 → fail 且 reason 点名类型", () => {
  const result = planFromSentence("做一个12秒的视频，标题是云");
  assert.ok(!result.ok);
  assert.match(result.reason, /视频/);
});

test("秒数越界（<3 或 >30）→ fail；边界 3 与 30 合法", () => {
  assert.ok(!planFromSentence("做一个2秒的文字动画，标题是a").ok);
  assert.ok(!planFromSentence("做一个31秒的文字动画，标题是a").ok);
  assert.ok(planFromSentence("做一个3秒的文字动画，标题是a").ok);
  assert.ok(planFromSentence("做一个30秒的文字动画，标题是a").ok);
});

test("完全不匹配的句子 → fail，不静默猜", () => {
  const result = planFromSentence("帮我做个片头");
  assert.ok(!result.ok);
  assert.ok(result.guidance.length > 0);
  assert.ok(result.reason.length > 0);
});
