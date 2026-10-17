// 任务②（P1-3 验收 / 通用语言指令方案 §6）：运行时云解析 + judge round-trip
// 接真实模型。此前 live-eval.mjs 的 model 通道只把评测集预置计划直送引擎，
// 「自然语言 → 云模型 → reconcile → 硬校验 → 蕴含核对」从未真跑过；本脚本把
// 评测集 model（13 条：兜底模型计划应能通过独立校验）与 model-reject
// （10 条：任何貌似合理的模型计划都必须被法官否决）逐条送进与生产路由
// （apps/web/src/app/api/photocraft-instruction/route.ts）完全相同的分拣与
// 云链路：sequence → express → 不支持动词/歧义/选色/默认策略/目标缺口闸 →
// cloud.parse → reconcile → parsePhotoCraftModelPlan →
// validatePhotoCraftInstructionAgainstText → describePhotoCraftPlan →
// cloud.judge（蕴含核对，不蕴含降级解释确认）。
// 判定（如实计数，不得为全绿放宽）：
//   model 案：cloud-entailed / cloud-explain-confirm / rules-defaults 通过；
//     cloud-rejected（真实模型输出过不了硬校验）计失败；快车道命中计失败
//     （与评测集「express 未命中」断言矛盾）。
//   model-reject 案：cloud-rejected / cloud-explain-confirm / 各前置闸通过
//     （fail-closed）；cloud-entailed（链路会执行不该执行的编辑）计失败。
// 验收底线：至少 1 条 model 案真实走完 parse+judge；否则整轮失败。
// 用法：node --env-file=.env scripts/photocraft/cloud-roundtrip.mjs [--json]
//   [--case <子串>]（依赖 DASHSCOPE_API_KEY / PHOTOCRAFT_INSTRUCTION_PROVIDER）
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const sourceDir = join(root, "apps/web/src/app/image-studio/photocraft");
const output = join(root, ".tools/photocraft-tests");
await mkdir(output, { recursive: true });
for (const name of [
  "planner-catalog.ts",
  "instruction.ts",
  "instruction-ir.ts",
  "default-strategy.ts",
  "instruction-eval-cases.ts",
  "plan-provider.ts",
]) {
  const text = await readFile(join(sourceDir, name), "utf8");
  const compiled = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: name,
  });
  await writeFile(
    join(output, name.replace(/\.ts$/, ".js")),
    // plan-provider.ts 通过相对路径引用 planner-catalog；编译到同一平铺目录
    // 后改写为同目录 require，行为不变。
    name === "plan-provider.ts"
      ? compiled.outputText.replace(
          /require\("\.\.\/\.\.\/image-studio\/photocraft\/planner-catalog"\)/,
          'require("./planner-catalog.js")',
        )
      : compiled.outputText,
  );
}
const require = createRequire(import.meta.url);
const { cases } = require(join(output, "instruction-eval-cases.js"));
const {
  describePhotoCraftPlan,
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} = require(join(output, "instruction.js"));
const { analyzeNLInstructionGaps } = require(join(output, "instruction-ir.js"));
const { completePlanFromGaps } = require(join(output, "default-strategy.js"));
const { planProviderFromEnv } = require(join(output, "plan-provider.js"));

const provider = planProviderFromEnv(process.env);
if (!provider) {
  console.error(
    "✗ 云解析 Provider 未配置：需要 PHOTOCRAFT_INSTRUCTION_PROVIDER=qwen-chat（或 openai-chat）与对应 API Key",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const caseFilter =
  argv.indexOf("--case") >= 0 ? argv[argv.indexOf("--case") + 1] : null;

// 与生产路由 route.ts 逐闸对齐的分拣；返回终止结果，未命中任何前置闸时
// 返回 { stage: "cloud" } 由调用方走云链路。
function routeGates(text) {
  try {
    const sequence = planPhotoCraftSequence(text);
    if (sequence) return { stage: "rules-sequence" };
  } catch {
    // 序列解析被约束表拒绝时路由直接 422（序列拒绝），继续与路由一致的
    // 后续闸门判断没有意义——真实路由这里就返回了。
    return { stage: "rejected-sequence" };
  }
  if (planPhotoCraftInstruction(text) !== null)
    return { stage: "rules-express" };
  const gaps = analyzeNLInstructionGaps(text);
  if (/(?:去掉|移除|删除|擦除|抠图|重绘|生成|换材质|改变形状)/.test(text))
    return { stage: "rejected-unsupported" };
  if (gaps.some((gap) => gap.kind === "ambiguity"))
    return { stage: "rejected-ambiguity" };
  if (gaps.some((gap) => gap.slot === "color"))
    return { stage: "rejected-color-choice" };
  const completion = completePlanFromGaps(text, gaps);
  if (completion) {
    try {
      const plan = parsePhotoCraftModelPlan({
        ...completion.plan,
        unsupported: "",
      });
      validatePhotoCraftInstructionAgainstText(text, plan);
      return { stage: "rules-defaults" };
    } catch {
      // 补全结果过不了硬校验时路由继续走模型道。
    }
  }
  if (gaps.some((gap) => gap.kind === "target"))
    return { stage: "rejected-target" };
  return { stage: "cloud" };
}

const rows = [];
const failures = [];
let cloudExercised = 0;
for (const item of cases) {
  if (item.kind !== "model" && item.kind !== "model-reject") continue;
  if (caseFilter && !item.instruction.includes(caseFilter)) continue;
  const gate = routeGates(item.instruction);
  const row = {
    kind: item.kind,
    instruction: item.instruction,
    stage: gate.stage,
    outcome: null,
    detail: null,
  };
  if (gate.stage !== "cloud") {
    row.outcome = gate.stage;
    rows.push(row);
    if (item.kind === "model" && gate.stage === "rules-express") {
      failures.push({
        instruction: item.instruction,
        error: "评测集断言快车道未命中，真实解析却命中（路由分拣与评测集矛盾）",
      });
    }
    continue;
  }
  // 云链路（与 route.ts 的 M2 道逐行对齐）。
  try {
    const parsed = await provider.parse(item.instruction);
    const plan = parsePhotoCraftModelPlan(
      reconcilePhotoCraftModelPlan(item.instruction, parsed),
    );
    validatePhotoCraftInstructionAgainstText(item.instruction, plan);
    const description = describePhotoCraftPlan(plan);
    const verdict = await provider.judge(item.instruction, description);
    cloudExercised += 1;
    row.outcome = verdict.entailed ? "cloud-entailed" : "cloud-explain-confirm";
    row.detail = {
      plan,
      description,
      judgeIssues: verdict.issues,
    };
    if (item.kind === "model-reject" && verdict.entailed)
      failures.push({
        instruction: item.instruction,
        error: `链路会执行评测集要求否决的编辑：${description}`,
      });
  } catch (error) {
    cloudExercised += 1;
    row.outcome = "cloud-rejected";
    row.detail = error instanceof Error ? error.message : String(error);
    if (item.kind === "model")
      failures.push({
        instruction: item.instruction,
        error: `云解析未产出可执行计划：${row.detail}`,
      });
  }
  rows.push(row);
  await new Promise((sleep) => setTimeout(sleep, 300));
}

const countBy = (outcome) =>
  rows.filter((row) => row.outcome === outcome).length;
const routedByGates = rows.filter(
  (row) =>
    typeof row.outcome === "string" &&
    (row.outcome.startsWith("rejected-") || row.outcome.startsWith("rules-")),
).length;
const summary = {
  provider: provider.name,
  model: process.env.PHOTOCRAFT_INSTRUCTION_MODEL || "(provider 默认)",
  cases: rows.length,
  cloudExercised,
  cloudEntailed: countBy("cloud-entailed"),
  cloudExplainConfirm: countBy("cloud-explain-confirm"),
  cloudRejected: countBy("cloud-rejected"),
  routedByGates,
};
const report = {
  ...summary,
  // model-reject 的底线语义：云道最终闸（硬校验 + 蕴含核对）没有放行过
  // 任何一条应否决的编辑；model 案至少一条真实走完 parse+judge（P1-3）。
  acceptance: {
    p1_3CloudRoundTrip: cloudExercised > 0,
    modelRejectNeverEntailed: !failures.some((failure) =>
      failure.error.includes("要求否决"),
    ),
  },
  rows,
  failures,
  executedAt: new Date().toISOString(),
};
await mkdir(join(root, ".tools/photocraft-serve-qa"), { recursive: true });
await writeFile(
  join(root, ".tools/photocraft-serve-qa/cloud-roundtrip-report.json"),
  JSON.stringify(report, null, 2),
);
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `云解析 round-trip @ ${provider.name} / ${summary.model}（${rows.length} 条：model ${rows.filter((r) => r.kind === "model").length}、model-reject ${rows.filter((r) => r.kind === "model-reject").length}）`,
  );
  for (const [outcome, count] of Object.entries(
    rows.reduce((acc, row) => {
      acc[row.outcome ?? "unknown"] = (acc[row.outcome ?? "unknown"] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort())
    console.log(`  ${outcome}: ${count}`);
  if (failures.length) {
    console.log("失败清单:");
    for (const failure of failures)
      console.log(`  ✗ ${failure.instruction} — ${failure.error}`);
  }
}
if (failures.length > 0 || cloudExercised === 0) process.exitCode = 1;
