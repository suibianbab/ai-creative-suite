// 评测集（通用语言指令方案 M1 起，M4 扩成 ≥200 条金标准集）：每条真实
// 中文修图要求走一遍快车道，记录它应该命中哪条通道。express = 快车道精确
// 解析；sequence = 复合步骤；sequence-reject = 约束表拒绝路径；model = 快
// 车道未命中、但兜底模型计划能通过独立校验；model-reject = 快车道未命中、
// 且任何貌似合理的模型计划都必须被法官否决；gap = 连模型也无法补全，只能
// 按 L2 缺口分拣引导用户改写。新增能力时先在此补用例，再改解析器；M4 附录
// 条目全部经 .tools/photocraft-serve-qa/eval-dump.mjs 跑真实解析器核对。
import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} from "./instruction";
import { cases } from "./instruction-eval-cases";
import { analyzeNLInstructionGaps } from "./instruction-ir";

test("NL eval set routes every real instruction to the expected lane", () => {
  // M4 金标准集（方案 §7）：≥200 条，覆盖 paraphrase / 口语 / 英文 / 模糊 /
  // 越界 / 多步 / 保护清单 / 非商品域目标。
  assert.ok(cases.length >= 200, `评测集应不少于 200 条，当前 ${cases.length}`);
  const lanes: Record<string, number> = {};
  for (const item of cases) {
    lanes[item.kind] = (lanes[item.kind] ?? 0) + 1;
    if (item.kind === "express") {
      assert.deepEqual(
        planPhotoCraftInstruction(item.instruction),
        item.plan,
        item.instruction,
      );
      assert.equal(
        planPhotoCraftSequence(item.instruction),
        null,
        item.instruction,
      );
      continue;
    }
    if (item.kind === "sequence") {
      assert.equal(
        planPhotoCraftSequence(item.instruction)?.length,
        item.count,
        item.instruction,
      );
      continue;
    }
    if (item.kind === "sequence-reject") {
      assert.throws(
        () => planPhotoCraftSequence(item.instruction),
        { message: item.message },
        item.instruction,
      );
      continue;
    }
    if (item.kind === "model") {
      assert.equal(
        planPhotoCraftInstruction(item.instruction),
        null,
        item.instruction,
      );
      const plan = parsePhotoCraftModelPlan(
        reconcilePhotoCraftModelPlan(item.instruction, {
          ...item.plan,
          unsupported: "",
        }),
      );
      validatePhotoCraftInstructionAgainstText(item.instruction, plan);
      continue;
    }
    if (item.kind === "model-reject") {
      assert.equal(
        planPhotoCraftInstruction(item.instruction),
        null,
        item.instruction,
      );
      assert.throws(
        () =>
          validatePhotoCraftInstructionAgainstText(
            item.instruction,
            parsePhotoCraftModelPlan(
              reconcilePhotoCraftModelPlan(item.instruction, {
                ...item.plan,
                unsupported: "",
              }),
            ),
          ),
        item.instruction,
      );
      continue;
    }
    assert.equal(
      planPhotoCraftInstruction(item.instruction),
      null,
      item.instruction,
    );
    const kinds = [
      ...new Set(analyzeNLInstructionGaps(item.instruction).map((g) => g.kind)),
    ];
    assert.deepEqual(kinds, [...new Set(item.kinds)], item.instruction);
  }
  assert.ok((lanes.express ?? 0) >= 90, "express 覆盖不足");
  assert.ok((lanes.sequence ?? 0) >= 12, "sequence 覆盖不足");
  assert.ok((lanes["sequence-reject"] ?? 0) >= 5, "sequence-reject 覆盖不足");
  assert.ok((lanes.model ?? 0) >= 10, "model 兜底覆盖不足");
  assert.ok((lanes["model-reject"] ?? 0) >= 8, "model-reject 覆盖不足");
  assert.ok((lanes.gap ?? 0) >= 40, "gap 覆盖不足");
  // 方案 §7 维度断言：保护清单、英文/混合语言、非商品域目标（智能找目标
  // 环的入口样本）、越界数值/超出色板必须各有足量代表，防止维度退化。
  const protectRows = cases.filter((item) =>
    /保留|保护|不要动|别动|不要变|保持不变/.test(item.instruction),
  ).length;
  assert.ok(protectRows >= 20, `保护清单覆盖不足（${protectRows}）`);
  const englishRows = cases.filter((item) =>
    /[A-Za-z]{3,}/.test(item.instruction),
  ).length;
  assert.ok(englishRows >= 4, `英文/混合语言覆盖不足（${englishRows}）`);
  const openVocabGaps = cases.filter(
    (item) =>
      item.kind === "gap" &&
      item.kinds.includes("target") &&
      !/主体|前景|商品|产品|背景|帽子|帽沿|选区|区域|耳朵/.test(
        item.instruction,
      ),
  ).length;
  assert.ok(
    openVocabGaps >= 8,
    `非商品域目标 gap 覆盖不足（${openVocabGaps}）`,
  );
  const outOfRange = cases.filter(
    (item) => item.kind === "gap" && item.kinds.includes("param"),
  ).length;
  assert.ok(outOfRange >= 10, `越界/缺参 gap 覆盖不足（${outOfRange}）`);
});
