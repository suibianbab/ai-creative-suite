import {
  completePlanFromGaps,
  defaultsUsedInPlan,
} from "../../image-studio/photocraft/default-strategy";
import {
  describePhotoCraftPlan,
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} from "../../image-studio/photocraft/instruction";
import {
  analyzeNLInstructionGaps,
  buildNLIntent,
  describeNLGaps,
} from "../../image-studio/photocraft/instruction-ir";
import { planProviderFromEnv } from "../../image-studio/photocraft/plan-provider";
import {
  plannerPrompt,
  plannerSchema,
} from "../../image-studio/photocraft/planner-catalog";

export async function POST(request: Request) {
  const provider = process.env.PHOTOCRAFT_INSTRUCTION_PROVIDER;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    return Response.json({ error: "编辑要求过长" }, { status: 413 });
  let instruction: unknown;
  try {
    const body = await request.text();
    if (body.length > 2048) throw new Error("too long");
    instruction = JSON.parse(body).instruction;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (
    typeof instruction !== "string" ||
    !instruction.trim() ||
    instruction.length > 240
  )
    return Response.json(
      { error: "请输入不超过 240 字的要求" },
      { status: 400 },
    );
  const text = instruction as string;

  try {
    const sequence = planPhotoCraftSequence(text);
    if (sequence)
      return Response.json({
        steps: sequence,
        intents: sequence.map((step) => buildNLIntent(text, step, "express")),
        provider: "rules",
      });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "复合编辑计划无效" },
      { status: 422 },
    );
  }
  const direct = planPhotoCraftInstruction(text);
  if (direct)
    return Response.json({
      plan: direct,
      intent: buildNLIntent(text, direct, "express"),
      defaults: defaultsUsedInPlan(
        text,
        direct as unknown as Record<string, unknown>,
      ),
      provider: "rules",
    });

  // L2 缺口分析 → 通道分拣。显式不支持动词与操作歧义如实拒绝（歧义是唯一
  // 允许追问的情况）；参数缺口（§5）永不阻塞，先走默认策略表本地补全——
  // 零成本、零延迟，不占用模型道；目标缺口交给 grounding 级联（L3a）；
  // 其余未识别表述（含英文）进入云解析道，这正是云道存在的意义。
  const gaps = analyzeNLInstructionGaps(text);
  const gapSummary = describeNLGaps(gaps);
  if (/(?:去掉|移除|删除|擦除|抠图|重绘|生成|换材质|改变形状)/.test(text))
    return Response.json(
      {
        error: "这条要求包含当前 PhotoCraft 工作流不支持的操作",
        gaps,
      },
      { status: 422 },
    );
  if (gaps.some((gap) => gap.kind === "ambiguity"))
    return Response.json({ error: gapSummary, gaps }, { status: 422 });
  // 补充B（codex 审核 2026-10-16）：目标颜色是语义必需槽——没说颜色不默认
  // 灰色、也不交给云道猜；round-trip 蕴含核对只能验证「计划被原话蕴含」，
  // 无法替用户选出想要的颜色。超出色板同理（能力范围外，模型也变不出来）。
  // 界面据此弹选色行（page.tsx colorChoice），点选后原话拼接重解析。
  if (gaps.some((gap) => gap.slot === "color"))
    return Response.json({ error: gapSummary, gaps }, { status: 422 });
  const completion = completePlanFromGaps(text, gaps);
  if (completion) {
    try {
      const plan = parsePhotoCraftModelPlan({
        ...completion.plan,
        unsupported: "",
      });
      validatePhotoCraftInstructionAgainstText(text, plan);
      return Response.json({
        plan,
        intent: buildNLIntent(text, plan, "express"),
        defaults: completion.defaulted,
        provider: "rules-defaults",
      });
    } catch {
      // 补全结果无法通过硬校验时继续走模型道，不在这里报错。
    }
  }
  if (gaps.some((gap) => gap.kind === "target"))
    // 目标缺口交给 grounding 级联（M3 提案-确认环）；解析层如实说明。
    return Response.json({ error: gapSummary, gaps }, { status: 422 });

  // M2 云解析道（Provider 抽象内）：解析 → reconcile 反查 → 硬校验 →
  // round-trip 蕴含核对（§6 双闸之一）；不蕴含则带 explainConfirm 降级为
  // 解释确认，由界面一次点击确认/纠正。
  const cloud = planProviderFromEnv(process.env);
  if (cloud) {
    try {
      const parsed = await cloud.parse(text);
      const plan = parsePhotoCraftModelPlan(
        reconcilePhotoCraftModelPlan(text, parsed),
      );
      validatePhotoCraftInstructionAgainstText(text, plan);
      const description = describePhotoCraftPlan(plan);
      const verdict =
        process.env.PHOTOCRAFT_INSTRUCTION_JUDGE === "off"
          ? { entailed: true, issues: [] as string[] }
          : await cloud.judge(text, description);
      if (!verdict.entailed)
        return Response.json({
          plan,
          explainConfirm: { description, issues: verdict.issues },
          defaults: defaultsUsedInPlan(
            text,
            plan as unknown as Record<string, unknown>,
          ),
          provider: cloud.name,
        });
      return Response.json({
        plan,
        intent: buildNLIntent(text, plan, "model"),
        defaults: defaultsUsedInPlan(
          text,
          plan as unknown as Record<string, unknown>,
        ),
        provider: cloud.name,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "模型不可用";
      return Response.json(
        { error: `${reason}；${gapSummary}`, gaps },
        { status: 422 },
      );
    }
  }

  if (
    process.env.NODE_ENV !== "development" &&
    provider !== "ollama" &&
    provider !== "llama.cpp"
  )
    return Response.json(
      {
        error: `PhotoCraft 本机模型服务未启用；${gapSummary}`,
        gaps,
      },
      { status: 503 },
    );

  try {
    const localCompletion = provider === "llama.cpp";
    const result = await fetch(
      localCompletion
        ? "http://127.0.0.1:11435/completion"
        : "http://127.0.0.1:11434/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          localCompletion
            ? {
                prompt: `${plannerPrompt}\n用户要求：${text}\nJSON：`,
                json_schema: plannerSchema,
                temperature: 0,
                n_predict: 256,
                stream: false,
              }
            : {
                model:
                  process.env.PHOTOCRAFT_INSTRUCTION_OLLAMA_MODEL || "qwen3:4b",
                stream: false,
                think: false,
                format: plannerSchema,
                options: { temperature: 0 },
                messages: [
                  { role: "system", content: plannerPrompt },
                  { role: "user", content: text },
                ],
              },
        ),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!result.ok) {
      const detail = await result.text();
      if (/out.of.memory|failed to allocate|cudaMalloc/i.test(detail))
        throw new Error("本机模型内存不足，请稍后重试或使用已支持的明确句式");
      throw new Error(`本机模型请求失败（HTTP ${result.status}）`);
    }
    const data = await result.json();
    const content = localCompletion ? data?.content : data?.message?.content;
    if (typeof content !== "string" || content.length > 2048)
      throw new Error("invalid output");
    const plan = parsePhotoCraftModelPlan(
      reconcilePhotoCraftModelPlan(text, JSON.parse(content)),
    );
    validatePhotoCraftInstructionAgainstText(text, plan);
    return Response.json({
      plan,
      intent: buildNLIntent(text, plan, "model"),
      defaults: defaultsUsedInPlan(
        text,
        plan as unknown as Record<string, unknown>,
      ),
      provider: localCompletion ? "llama.cpp" : "ollama",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "模型不可用";
    return Response.json(
      { error: `${reason}；${gapSummary}`, gaps },
      { status: 422 },
    );
  }
}
