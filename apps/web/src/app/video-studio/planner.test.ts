import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegistry, validateSceneSpec } from "@acs/video-scene";
import {
  isStoryboardSentence,
  planFromSentence,
  planStoryboard,
  speechAwareDurationMs,
  splitShotDurations,
} from "./planner.js";

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

test("内容预告：文字句 renderHint 点名标题进画面", () => {
  const result = planFromSentence(
    "做一个12秒的文字动画，标题是云制造，副标题是Video Studio",
  );
  assert.ok(result.ok);
  assert.match(result.renderHint, /云制造/);
  assert.doesNotMatch(result.renderHint, /不会出现在画面/);
});

test("内容预告：线描句点名按句抽取的模板名与「标题不进画面」", () => {
  const result = planFromSentence("做一个8秒的线描动画，标题是山水发布");
  assert.ok(result.ok);
  assert.match(result.renderHint, /模板「[^」]+」/);
  assert.match(result.renderHint, /标题「山水发布」不会出现在画面/);
  const again = planFromSentence("做一个8秒的线描动画，标题是山水发布");
  assert.ok(again.ok); // 同句同模板，预告稳定
  assert.equal(again.renderHint, result.renderHint);
});

test("内容预告：图形句同样点名模板名与「标题不进画面」", () => {
  const result = planFromSentence("做一个6秒的图形动画，标题是发布");
  assert.ok(result.ok);
  assert.match(result.renderHint, /模板「[^」]+」/);
  assert.match(result.renderHint, /标题「发布」不会出现在画面/);
});

// —— P1 分镜规划器（planStoryboard）——

test("分镜：合法 30s/4 镜头 STEM 句 → 4 镜头、Σ时长=30000、逐 spec 过注册表校验", () => {
  const sb = planStoryboard(
    "做一个30秒的STEM解说视频，主题是勾股定理，分4个镜头",
  );
  assert.ok(sb.ok);
  assert.equal(sb.title, "勾股定理");
  assert.equal(sb.totalMs, 30000);
  assert.equal(sb.shots.length, 4);
  const sum = sb.shots.reduce((acc, s) => acc + s.plan.spec.durationMs, 0);
  assert.equal(sum, 30000);
  for (const s of sb.shots) validateSceneSpec(s.plan.spec, defaultRegistry);
  // 构成：开场文字 → 要点文字 → 图形示意 → 结语文字
  assert.deepEqual(
    sb.shots.map((s) => s.plan.spec.componentId),
    ["text-animation", "text-animation", "basic-shapes", "text-animation"],
  );
  assert.match(sb.shots[0]!.label, /开场/);
  assert.match(sb.shots[3]!.label, /结语/);
});

test("分镜：内容预告如实——开场点名标题、要点点名占位、示意点名模板、结语点名副标题", () => {
  const sb = planStoryboard("做一个30秒的STEM解说视频，主题是水循环");
  assert.ok(sb.ok);
  assert.match(sb.shots[0]!.plan.renderHint, /标题「水循环」/);
  assert.match(sb.shots[1]!.plan.renderHint, /要点 1/);
  assert.match(sb.shots[2]!.plan.renderHint, /模板「[^」]+」/);
  assert.match(sb.shots[3]!.plan.renderHint, /谢谢观看/);
});

// D2 Task1：旁白文本 = 该镜头画面实际展示/表达的事实，不虚构讲解词。
test("分镜：narrationText 如实——开场读标题、要点读标题+要点、示意读主题、结语读谢谢观看", () => {
  const sb = planStoryboard("做一个30秒的STEM解说视频，主题是水循环");
  assert.ok(sb.ok);
  assert.equal(sb.shots[0]!.narrationText, "水循环。");
  assert.equal(sb.shots[1]!.narrationText, "水循环，要点 1。");
  // 示意镜头画面无文字：旁白只读主题这个不争事实
  assert.equal(sb.shots[2]!.narrationText, "水循环。");
  assert.equal(sb.shots[3]!.narrationText, "谢谢观看。");
  for (const shot of sb.shots) {
    assert.ok(shot.narrationText.length > 0, "每镜头旁白非空");
    assert.ok(
      shot.narrationText.length <= 2000,
      "旁白不超 ContentVersion 上限",
    );
  }
});

test("分镜：默认 4 镜头；「分3/8个镜头」生效且交替构成正确", () => {
  const d = planStoryboard("做一个12秒的STEM解说视频，主题是光的折射");
  assert.ok(d.ok);
  assert.equal(d.shots.length, 4);
  const n3 = planStoryboard(
    "做一个12秒的STEM解说视频，主题是光的折射，分3个镜头",
  );
  assert.ok(n3.ok);
  assert.equal(n3.shots.length, 3);
  const n8 = planStoryboard(
    "做一个12秒的STEM解说视频，主题是光的折射，分8个镜头",
  );
  assert.ok(n8.ok);
  assert.equal(n8.shots.length, 8);
  assert.deepEqual(
    n8.shots.map((s) => s.plan.spec.componentId),
    [
      "text-animation",
      "text-animation",
      "basic-shapes",
      "text-animation",
      "basic-shapes",
      "text-animation",
      "basic-shapes",
      "text-animation",
    ],
  );
});

test("分镜：秒数 3..120、镜头数 3..8 越界拒绝且 reason 点名", () => {
  const s2 = planStoryboard("做一个2秒的STEM解说视频，主题是X");
  assert.ok(!s2.ok);
  assert.match(s2.reason, /秒数/);
  assert.ok(!planStoryboard("做一个121秒的STEM解说视频，主题是X").ok);
  const n2 = planStoryboard("做一个12秒的STEM解说视频，主题是X，分2个镜头");
  assert.ok(!n2.ok);
  assert.match(n2.reason, /镜头/);
  assert.ok(!planStoryboard("做一个12秒的STEM解说视频，主题是X，分9个镜头").ok);
});

test("分镜：同句可复现、镜头间 seed 互异；isStoryboardSentence 分流正确", () => {
  const a = planStoryboard("做一个20秒的STEM解说视频，主题是浮力，分5个镜头");
  const b = planStoryboard("做一个20秒的STEM解说视频，主题是浮力，分5个镜头");
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a, b);
  const seeds = new Set(a.shots.map((s) => s.plan.spec.seed));
  assert.equal(seeds.size, a.shots.length);
  assert.ok(isStoryboardSentence("做一个30秒的STEM解说视频，主题是X"));
  assert.ok(!isStoryboardSentence("做一个12秒的文字动画，标题是X"));
});

test("分镜：splitShotDurations 均分且末镜头吸收余数", () => {
  assert.deepEqual(splitShotDurations(30000, 4), [7500, 7500, 7500, 7500]);
  assert.deepEqual(splitShotDurations(10000, 3), [3333, 3333, 3334]);
  assert.equal(
    splitShotDurations(10000, 3).reduce((x, y) => x + y, 0),
    10000,
  );
});

// —— 语速感知时长（spec R4 规划期）：镜头时长 = max(等分, 400ms + 300ms/字) ——
// 用户总时长是目标值，容纳旁白优先；totalMs 如实反映 Σ 实际。

test("speechAwareDurationMs：短旁白取等分，长旁白取语音预估，空白=无声", () => {
  assert.equal(speechAwareDurationMs(2000, "水。"), 2000); // 400+300 < 2000
  assert.equal(
    speechAwareDurationMs(2000, "水循环，要点 1。"),
    400 + [..."水循环，要点 1。"].length * 300,
  );
  assert.equal(speechAwareDurationMs(2000, "   "), 2000);
});

test("分镜：3s/4 镜头水循环 → 语音需求撑大镜头，totalMs=Σ实际(8200)", () => {
  const result = planStoryboard(
    "做一个3秒的STEM解说视频，主题是水循环，分4个镜头",
  );
  assert.ok(result.ok);
  const durations = result.shots.map((shot) => shot.plan.spec.durationMs);
  for (const [i, ms] of durations.entries()) {
    const text = result.shots[i]!.narrationText;
    assert.ok(
      ms >= 400 + [...text].length * 300 - 1,
      `镜头 ${i + 1} 时长 ${ms}ms < 语音需求`,
    );
  }
  assert.equal(
    result.totalMs,
    durations.reduce((a, b) => a + b, 0),
  );
  assert.deepEqual(durations, [1600, 3100, 1600, 1900]);
  assert.ok(result.totalMs > 3000);
});
