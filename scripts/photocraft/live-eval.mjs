// M4(e) 评测接真引擎（通用语言指令方案 §10/M4）+ P1-3 整改（codex 审核
// 2026-10-16）：报告按覆盖层级分开计数，只有本脚本真正运行的步骤才进对应
// 分母——R2（codex 第二轮复审）：层级合计由 live-eval-coverage.mjs 按 Map
// 条目汇总并与过滤后评测集逐条对账，不一致即失败退出，分母不硬编码。
//   engine:express[model|sequence]（预置计划 → 引擎执行）：金标准集的预置
//     计划逐条经 dev bridge 打真实 PhotoCraft 引擎（provider 蒙版走 4101，
//     开放词汇候选走 4104）；bridge 内部已跑 capability verify，非 200 即
//     失败。sequence 逐步执行并把上一步的 .pcraft 作为下一步输入。这不是
//     「自然语言端到端」：model 通道未走运行时云解析/judge，express 计划
//     为评测集钉死值。
//   parser:gap / parser:model-reject / parser:sequence-reject：与
//     instruction-eval.test.ts 相同的解析断言在本脚本内实际运行后才计数。
// 未在本脚本运行的项目（云道 round-trip、跨题材真图 grounding、预览/导出
// 逐像素一致性、§7 指标）在 coverage.notRun 里如实列出。
// 用法：node scripts/photocraft/live-eval.mjs [--json] [--case <子串>]

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  coverageMismatches,
  summarizeCoverage,
} from "./live-eval-coverage.mjs";

const root = resolve(import.meta.dirname, "../..");
const sourceDir = join(root, "apps/web/src/app/image-studio/photocraft");
const output = join(root, ".tools/photocraft-tests");
await mkdir(output, { recursive: true });
for (const name of [
  "planner-catalog.ts",
  "instruction.ts",
  "instruction-ir.ts",
  "default-strategy.ts",
  "operation-constraints.ts",
  "instruction-eval-cases.ts",
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
    compiled.outputText,
  );
}
const require = createRequire(import.meta.url);
const { cases } = require(join(output, "instruction-eval-cases.js"));
const {
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} = require(join(output, "instruction.js"));
const { analyzeNLInstructionGaps } = require(join(output, "instruction-ir.js"));
const { defaultStrategies } = require(join(output, "default-strategy.js"));

// 生产链路在解析后按默认策略表补齐缺失槽（§5：数字交给滑杆）；真引擎
// 评测执行钉死计划前走同一张表，避免测的是「无默认值的裸计划」。
const SYMBOLIC_DEFAULTS = new Set(["degree", "gray"]);
function withStrategyDefaults(plan) {
  const entry = defaultStrategies.find(
    (item) => item.operation === plan.operation,
  );
  if (!entry) return plan;
  const merged = { ...plan };
  for (const [slot, value] of Object.entries(entry.defaults))
    if (merged[slot] === undefined && !SYMBOLIC_DEFAULTS.has(value))
      merged[slot] = value;
  return merged;
}

const BASE = process.env.PHOTOCRAFT_BRIDGE_BASE ?? "http://127.0.0.1:4112";
const HAT = await readFile(join(root, "qa/fixtures/photocraft-hat-teal.png"));
const STYLED = await readFile(
  join(root, ".tools/photocraft-tests/probe-text-style-shadow.pcraft"),
);

// 每类操作在真引擎上的执行矩阵：输入素材 + 选区来源 + 采样几何。
function requestFor(plan) {
  const providerTargets = new Set([
    "subject",
    "background",
    "hat",
    "brim",
    "foreground",
  ]);
  const manualRect = plan.target === "selected-area";
  const provider =
    !manualRect &&
    plan.target !== "whole-image" &&
    providerTargets.has(plan.target);
  if (!manualRect && !provider && plan.target !== "whole-image")
    return { error: `target ${plan.target} 无真引擎选区矩阵` };
  const styledOps = new Set(["text-style", "drop-shadow"]);
  // 计划里可能有中文（文案、保护名词）而 HTTP 头只收 latin1：非 ASCII
  // 计划改走 base64 头，bridge 端按 UTF-8 解回（同 x-acs-phrase-b64 约定）。
  const planJson = JSON.stringify(plan);
  const headers = {
    ...(/[^\u0000-ÿ]/.test(planJson)
      ? { "X-Acs-Plan-B64": Buffer.from(planJson, "utf8").toString("base64") }
      : { "X-Acs-Plan": planJson }),
    "X-Acs-Points": "[]",
    "X-Acs-Rect": "null",
    "X-Acs-Outline": "[]",
    "X-Acs-Patches": "[]",
    "X-Acs-Edge-Shift": "0",
    "X-Acs-Edge-Feather": "0",
    "X-Acs-Protect-Rect": "null",
    "X-Acs-Selection-Method": provider ? "provider" : "manual",
    "X-Acs-Heal-Size": "32",
    "X-Acs-Provider-Scope-Feather": "20",
  };
  if (plan.operation === "text" || plan.operation === "heal") {
    // 文字/污点修复按点击点位执行，验证器要求不带矩形选区。
    headers["X-Acs-Points"] = JSON.stringify([[420, 300]]);
  } else if (plan.operation === "crop" || manualRect) {
    headers["X-Acs-Rect"] = JSON.stringify([120, 140, 640, 480]);
    headers["X-Acs-Selection-Method"] = "manual";
  } else if (
    provider &&
    plan.target !== "subject" &&
    plan.target !== "background"
  ) {
    // 非主体级 Provider 目标（帽子/帽沿/前景…）需要作用框与 AI 蒙版求交，
    // 桥接验证器拒绝无几何的 provider 请求（IMG-044 规则）。
    headers["X-Acs-Rect"] = JSON.stringify([120, 140, 640, 480]);
  }
  if (plan.protectLabel) {
    // 与 test_instruction_sequence.mjs 相同的固定标签保护框坐标。
    headers["X-Acs-Protect-Rect"] = JSON.stringify([620, 490, 250, 160]);
  }
  return {
    body: styledOps.has(plan.operation) ? STYLED : HAT,
    contentType: styledOps.has(plan.operation)
      ? "application/x-photocraft"
      : "image/png",
    headers,
  };
}

async function runThroughBridge(request) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${BASE}/v1/instruction`, {
      method: "POST",
      headers: {
        "Content-Type": request.contentType,
        ...request.headers,
      },
      body: request.body,
    });
    if (response.status === 429) {
      await new Promise((sleep) =>
        setTimeout(
          sleep,
          Number(response.headers.get("retry-after") ?? "2") * 1000,
        ),
      );
      continue;
    }
    if (!response.ok)
      return {
        ok: false,
        detail: `${response.status} ${(await response.text()).slice(0, 300)}`,
      };
    const result = await response.json();
    if (!result.sourceUrl) return { ok: false, detail: "无 sourceUrl 返回" };
    return { ok: true, sourceUrl: result.sourceUrl };
  }
  return { ok: false, detail: "bridge 持续繁忙（429）" };
}

async function fetchBytes(url) {
  const response = await fetch(`${BASE}${url}`);
  if (!response.ok) throw new Error(`取回 ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const failures = [];
const lanes = new Map();
const note = (lane, ok) => {
  const entry = lanes.get(lane) ?? { total: 0, pass: 0 };
  entry.total += 1;
  if (ok) entry.pass += 1;
  lanes.set(lane, entry);
};

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const caseFilter =
  argv.indexOf("--case") >= 0 ? argv[argv.indexOf("--case") + 1] : null;

async function executePlan(plan, label) {
  const request = requestFor(plan);
  if (request.error) {
    failures.push({ label, error: request.error });
    return null;
  }
  const result = await runThroughBridge(request);
  if (!result.ok) {
    failures.push({ label, error: result.detail });
    return null;
  }
  return fetchBytes(result.sourceUrl);
}

// P1-3：解析器钉死通道的断言与 instruction-eval.test.ts 逐条相同，但在这里
// 真正运行后才计数——不再「读表即通过」。返回错误消息或 null（null=通过）。
function parserAssertion(kind, item) {
  if (kind === "gap") {
    if (planPhotoCraftInstruction(item.instruction) !== null)
      return "express 通道应未命中";
    const got = [
      ...new Set(analyzeNLInstructionGaps(item.instruction).map((g) => g.kind)),
    ];
    const want = [...new Set(item.kinds)];
    if (JSON.stringify(got) !== JSON.stringify(want))
      return `gap kinds 不符：${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`;
    return null;
  }
  if (kind === "model-reject") {
    if (planPhotoCraftInstruction(item.instruction) !== null)
      return "express 通道应未命中";
    try {
      validatePhotoCraftInstructionAgainstText(
        item.instruction,
        parsePhotoCraftModelPlan(
          reconcilePhotoCraftModelPlan(item.instruction, {
            ...item.plan,
            unsupported: "",
          }),
        ),
      );
    } catch {
      return null;
    }
    return "貌似合理的模型计划应被法官否决，却通过了";
  }
  // sequence-reject
  try {
    planPhotoCraftSequence(item.instruction);
  } catch (error) {
    if (error.message !== item.message)
      return `拒绝理由不符：「${error.message}」≠「${item.message}」`;
    return null;
  }
  return "约束表应拒绝该序列，却解析成功";
}

// executedCases 与主循环共用同一过滤谓词（--case 子串），供结尾的分母对账：
// 每条命中案例必须恰好进一个 lane，层级合计 ≠ 案例数即统计口径出错。
const executedCases = [];
for (const item of cases) {
  if (caseFilter && !item.instruction.includes(caseFilter)) continue;
  executedCases.push(item);
  if (item.kind === "express" || item.kind === "model") {
    // 引擎通道执行的是评测集钉死计划（model 通道不走运行时云解析）。
    const executed = await executePlan(
      withStrategyDefaults(item.plan),
      `${item.kind}｜${item.instruction}`,
    );
    note(`engine:${item.kind}（预置计划）`, Boolean(executed));
    continue;
  }
  if (item.kind === "sequence") {
    const steps = planPhotoCraftSequence(item.instruction);
    if (!Array.isArray(steps) || steps.length < 1) {
      failures.push({
        label: `sequence｜${item.instruction}`,
        error: "序列解析为空",
      });
      note("engine:sequence", false);
      continue;
    }
    let ok = true;
    let carried = null;
    for (const [index, step] of steps.entries()) {
      const request = requestFor(withStrategyDefaults(step));
      if (request.error) {
        failures.push({
          label: `sequence｜${item.instruction}｜第${index + 1}步`,
          error: request.error,
        });
        ok = false;
        break;
      }
      if (carried) {
        request.body = carried;
        request.contentType = "application/x-photocraft";
      }
      const result = await runThroughBridge(request);
      if (!result.ok) {
        failures.push({
          label: `sequence｜${item.instruction}｜第${index + 1}步 ${step.operation}`,
          error: result.detail,
        });
        ok = false;
        break;
      }
      carried = await fetchBytes(result.sourceUrl);
    }
    note("engine:sequence", ok);
    continue;
  }
  // P1-3：gap / model-reject / sequence-reject 是解析器钉死通道，断言实际
  // 运行后才计数；失败案例照实入失败清单，不得为了全绿跳过。
  const error = parserAssertion(item.kind, item);
  note(`parser:${item.kind}`, error === null);
  if (error)
    failures.push({ label: `parser:${item.kind}｜${item.instruction}`, error });
}

// P1-3/R2：报告按覆盖层级分开汇总——只有本脚本真正运行的步骤才进分母；未
// 运行/未测量项显式列出，防止把「预置计划执行」读成「自然语言端到端」。
// 汇总走可单测的 live-eval-coverage.mjs（按 Map 条目求和；旧实现的
// Object.entries(Map) 恒为 []，曾把 coverage 分母归零）。分母与过滤后评测
// 集逐条对账（不硬编码历史数字），对不上计入失败清单并以非零退出。
const summary = summarizeCoverage(lanes); // 自检失败直接抛错：不带病生成报告
const ENGINE_KINDS = new Set(["express", "model", "sequence"]);
const denominators = {
  engine: executedCases.filter((item) => ENGINE_KINDS.has(item.kind)).length,
  parser: executedCases.filter((item) => !ENGINE_KINDS.has(item.kind)).length,
};
for (const mismatch of coverageMismatches(summary, denominators))
  failures.push({ label: "coverage-self-check", error: mismatch });
const report = {
  bridge: BASE,
  lanes: summary.lanes,
  coverage: {
    engineExecuted: `${summary.engineTotal} 条预置计划经 dev bridge 打真实 PhotoCraft 引擎执行`,
    parserPinnedInScript: `${summary.parserTotal} 条解析断言在本脚本内实际运行（与 instruction-eval.test.ts 相同断言）`,
    notRun: [
      "运行时云解析 + judge round-trip：不在本脚本范围，由 scripts/photocraft/cloud-roundtrip.mjs 单独接真实模型覆盖（model 通道在本脚本仍以评测集预置计划直送引擎，不重复计费）",
      "跨题材（房子/花/家具等非商品域）真图 grounding：不在本脚本范围，引擎矩阵固定使用帽子图与文字样式样张；qa/fixtures/photocraft-grounding/ 标注集由 IMG-053 grounding-eval.mjs（live-grounding tier）专项评测",
      "滑杆预览 vs 保存重开 vs 导出文件的逐像素一致性（补充C）：不在本脚本范围，由 IMG-050 preview-consistency.mjs 专项覆盖（亮度矩阵内已实测逐字节一致）",
      "方案 §7 指标（主体级自动率 / 一次确认率 / 越界拦截率）：由 IMG-061 section7-metrics.mjs 从各专项报告装配（含本脚本 212 条），此处不重复测量",
    ],
  },
  failures,
  executedAt: new Date().toISOString(),
};
await writeFile(
  join(root, ".tools/photocraft-serve-qa/live-eval-report.json"),
  JSON.stringify(report, null, 2),
);
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`评测接真引擎 @ ${BASE}`);
  for (const [lane, { total, pass }] of lanes)
    console.log(`  ${lane}: ${pass}/${total}`);
  if (failures.length) {
    console.log("失败清单:");
    for (const failure of failures)
      console.log(`  ✗ ${failure.label} — ${failure.error}`);
  }
}
if (failures.length > 0) process.exitCode = 1;
