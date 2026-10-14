import {
  parsePhotoCraftModelPlan,
  planPhotoCraftInstruction,
  planPhotoCraftSequence,
  reconcilePhotoCraftModelPlan,
  validatePhotoCraftInstructionAgainstText,
} from "../../image-studio/photocraft/instruction";
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

  try {
    const sequence = planPhotoCraftSequence(instruction);
    if (sequence) return Response.json({ steps: sequence, provider: "rules" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "复合编辑计划无效" },
      { status: 422 },
    );
  }
  const direct = planPhotoCraftInstruction(instruction);
  if (direct) return Response.json({ plan: direct, provider: "rules" });
  if (
    process.env.NODE_ENV !== "development" &&
    provider !== "ollama" &&
    provider !== "llama.cpp"
  )
    return Response.json(
      { error: "PhotoCraft 本机模型服务未启用" },
      { status: 503 },
    );
  if (
    /(?:去掉|移除|删除|擦除|抠图|重绘|生成|换材质|改变形状)/.test(instruction)
  )
    return Response.json(
      { error: "这条要求包含当前 PhotoCraft 工作流不支持的操作" },
      { status: 422 },
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
                prompt: `${plannerPrompt}\n用户要求：${instruction}\nJSON：`,
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
                  { role: "user", content: instruction },
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
      reconcilePhotoCraftModelPlan(instruction, JSON.parse(content)),
    );
    validatePhotoCraftInstructionAgainstText(instruction, plan);
    return Response.json({
      plan,
      provider: localCompletion ? "llama.cpp" : "ollama",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "模型不可用";
    return Response.json({ error: reason }, { status: 422 });
  }
}
