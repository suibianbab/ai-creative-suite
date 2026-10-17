import assert from "node:assert/strict";
import test from "node:test";
import { planPhotoCraftInstruction } from "./instruction";
import {
  analyzeNLInstructionGaps,
  buildNLIntent,
  describeNLGaps,
} from "./instruction-ir";

test("buildNLIntent maps plans to open target kinds with the user's own words", () => {
  const subject = buildNLIntent(
    "把主体换成灰色",
    planPhotoCraftInstruction("把主体换成灰色")!,
    "express",
  );
  assert.equal(subject.operation, "recolor");
  assert.equal(subject.target.kind, "subject");
  assert.equal(subject.target.phrase, "主体");
  assert.deepEqual(subject.params, { color: "gray" });
  assert.deepEqual(subject.protect, []);
  assert.equal(subject.confidence, 1);

  const background = buildNLIntent(
    "背景稍微提亮一些",
    planPhotoCraftInstruction("背景稍微提亮一些")!,
    "express",
  );
  assert.equal(background.target.kind, "background");
  assert.equal(background.target.phrase, "背景");
  assert.deepEqual(background.params, {
    adjustment: "brightness",
    amount: 10,
  });

  const labeled = buildNLIntent(
    "把帽沿改成红色，保留标签",
    planPhotoCraftInstruction("把帽沿改成红色，保留标签")!,
    "express",
  );
  assert.equal(labeled.target.kind, "named");
  assert.equal(labeled.target.phrase, "帽沿");
  assert.deepEqual(labeled.protect, ["标签"]);

  const whole = buildNLIntent(
    "整张图亮度提高25",
    planPhotoCraftInstruction("整张图亮度提高25")!,
    "model",
  );
  assert.equal(whole.target.kind, "whole-image");
  assert.equal(whole.confidence, 0.6);

  const selection = buildNLIntent(
    "把选区改成灰色",
    planPhotoCraftInstruction("把选区改成灰色")!,
    "express",
  );
  assert.equal(selection.target.kind, "selection");
});

test("L2 gap analysis classifies express-lane misses by slot", () => {
  const kinds = (instruction: string) =>
    analyzeNLInstructionGaps(instruction).map((gap) => gap.kind);
  assert.deepEqual(kinds("把杯子换成紫色"), ["param", "target"]);
  assert.equal(
    analyzeNLInstructionGaps("把杯子换成紫色").at(-1)?.phrase,
    "杯子",
  );
  assert.equal(
    analyzeNLInstructionGaps("把模特衣服换成红色").at(-1)?.phrase,
    "模特衣服",
  );
  assert.deepEqual(kinds("把背景换成紫色"), ["param"]);
  assert.match(
    describeNLGaps(analyzeNLInstructionGaps("把背景换成紫色")),
    /黑\/红\/蓝\/绿\/灰/,
  );
  // M2：换色意图本身能识别（缺颜色/缺目标都是参数与目标缺口，走默认+grounding）。
  assert.deepEqual(kinds("帮我换个颜色"), ["param", "target"]);
  assert.deepEqual(kinds("让背景亮起来"), ["param"]);
  assert.deepEqual(kinds("背景提亮80"), ["param"]);
  assert.deepEqual(kinds("把背景的饱和度提高到很高"), ["param"]);
  assert.deepEqual(kinds("把这张照片弄得好看一点"), ["capability"]);
  assert.deepEqual(kinds("去掉路人"), ["capability"]);
  assert.deepEqual(kinds("背景换成红色同时主体提亮"), ["ambiguity"]);
  assert.deepEqual(kinds("把背景裁剪"), ["param"]);
  assert.deepEqual(
    analyzeNLInstructionGaps("给背景添加文字").map((gap) => gap.slot),
    ["text"],
  );
  // The 整张图片的背景 compound is a documented v0 gap: express refuses to
  // guess, so the miss lands in the fallback param bucket for the model lane.
  assert.deepEqual(kinds("整张图片的背景提亮一些"), ["param"]);
  assert.deepEqual(kinds("把照片的背景亮度提高20"), ["param"]);
});

// P1-2（codex 审核 2026-10-16）：没有「把/将/让」引导词的口语目标短语也要
// 抽得出来（主语开头回退），否则目标缺口无法给出候选环引导；属性名词与客套
// 前缀不算目标。
test("L2 gap analysis extracts subject-first target phrases without 把/将/让", () => {
  const phrase = (instruction: string) =>
    analyzeNLInstructionGaps(instruction).at(-1)?.phrase;
  assert.equal(phrase("屋顶提亮一点"), "屋顶");
  assert.equal(phrase("花瓣换成蓝色"), "花瓣");
  assert.equal(phrase("鞋带调成红色"), "鞋带");
  // 属性名词（亮度/对比度…）作主语是参数缺口，不是目标短语。
  assert.equal(phrase("亮度提高15"), undefined);
  // 客套前缀不是目标。
  assert.equal(phrase("帮我提亮一点"), undefined);
});
