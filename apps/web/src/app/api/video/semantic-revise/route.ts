import { isSameOriginRequest } from "../../same-origin";
import {
  SEMANTIC_COMPILER_VERSION,
  SEMANTIC_REVISE_PROMPT_VERSION,
  semanticProviderFromEnv,
  type SemanticTokenUsage,
} from "../../../video-studio/semantic-provider";
import {
  compileSemanticShot,
  requiresRealAssets,
  validateSemanticShot,
  verifySourcedNumbers,
} from "../../../video-studio/semantic-storyboard";

// N2 单镜自然语言修改（交接单 2026-10-27）：客户端送「本镜工作版本摘要 +
// 相邻镜头摘要 + 整片信息 + 用户指令」，模型只产一个受限 IR 镜头，服务端
// 用与整片同源的 validateSemanticShot/compileSemanticShot 编译候选。
// 服务端无项目状态：锁定/审批/版本冲突由客户端按既有规则把关，本路由
// 只做指令校验、素材边界与 IR→候选的确定性管线。失败绝不返回占位候选。

type ReviseContext = {
  instruction?: unknown;
  allowDiagramSubstitute?: unknown;
  shot?: unknown;
  neighbors?: unknown;
  film?: unknown;
};

// 上下文字段是模型提示词的数据面：一律截断后入提示，防注入/防膨胀。
function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // M-6：按码点切片，不劈代理对（emoji 上下文送模型的仍是完整字符）。
  const squeezed = value.replace(/\s+/g, " ");
  return [...squeezed].slice(0, max).join("");
}

function shotSummary(label: string, value: unknown): string {
  const s = value as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return `${label}：无`;
  return `${label}：${clip(s.description, 60)}；旁白「${clip(s.narrationText, 40)}」`;
}

function buildPayload(body: ReviseContext, instruction: string): string {
  const shot = (body.shot ?? {}) as Record<string, unknown>;
  const neighbors = (body.neighbors ?? {}) as Record<string, unknown>;
  const film = (body.film ?? {}) as Record<string, unknown>;
  const index = typeof shot.index === "number" ? shot.index : "?";
  return [
    `整片：《${clip(film.title, 30)}》共 ${typeof film.shotCount === "number" ? film.shotCount : "?"} 镜 / 约 ${typeof film.totalMs === "number" ? Math.round(film.totalMs / 100) / 10 : "?"}s`,
    shotSummary(
      `本镜（第 ${index} 镜，画面 ${clip(shot.componentId, 40)}，时长 ${typeof shot.durationMs === "number" ? shot.durationMs : "?"}ms）`,
      shot,
    ),
    shotSummary("前一镜", neighbors.prev),
    shotSummary("后一镜", neighbors.next),
    `用户修改指令：${instruction}`,
  ].join("\n");
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return Response.json({ error: "请求过长" }, { status: 413 });
  let body: ReviseContext;
  try {
    const raw = await request.text();
    // M-2：content-length 缺失（chunked）时请求体无界——对原文硬顶。
    if (raw.length > 4096) throw new Error("too large");
    const parsed: unknown = JSON.parse(raw);
    // P2-1（Codex 复核 2026-10-27）：null/数组/原始值统一 400，不触模型。
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("not an object");
    body = parsed as ReviseContext;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (
    typeof body.instruction !== "string" ||
    !body.instruction.trim() ||
    body.instruction.length > 200
  )
    return Response.json(
      { error: "请输入不超过 200 字的修改指令" },
      { status: 400 },
    );
  const instruction = body.instruction.trim();

  // 素材边界（同整片口径）：真实素材需求未经授权不得静默降级为图解。
  const substitutedForAssets =
    body.allowDiagramSubstitute === true && requiresRealAssets(instruction);
  if (requiresRealAssets(instruction) && !substitutedForAssets)
    return Response.json(
      {
        kind: "needs-assets",
        error:
          "这条修改需要真实照片/素材，AI 修改只能画图解。请在素材面板人工导入素材，或点「改用图解生成」明示接受图解替代",
      },
      { status: 422 },
    );

  const provider = semanticProviderFromEnv(process.env);
  if (!provider)
    return Response.json(
      { error: "未配置 DASHSCOPE_API_KEY，AI 修改不可用（固定句式重做不受影响）" },
      { status: 503 },
    );

  const payload = buildPayload(body, instruction);
  const first = await provider.revise(payload);
  if (!first.ok)
    return Response.json({ error: first.message, kind: first.kind }, { status: 422 });
  let validation = validateSemanticShot(first.draft, "shot");
  let draftSource = first;
  const usageCalls: Array<NonNullable<SemanticTokenUsage>> = [];
  if (first.usage) usageCalls.push(first.usage);

  // N3 数值防伪造 + IR 非法 → 一次带因修正重试（同整片纪律）。
  // 数据源=指令+影片上下文（payload 里模型可见的全部文字）：影片自身的
  // 数字（如邻镜旁白的心率 80/65）是合法引用对象，不得误拒。
  const sourcedText = `${instruction}
${payload}`;
  const sourcingErrors = validation.ok
    ? verifySourcedNumbers(validation.shot, sourcedText)
    : [];
  if (!validation.ok || sourcingErrors.length > 0) {
    const retry = await provider.revise(
      payload,
      [...(validation.ok ? [] : validation.errors), ...sourcingErrors].join("；"),
    );
    if (!retry.ok)
      return Response.json({ error: retry.message, kind: retry.kind }, { status: 422 });
    validation = validateSemanticShot(retry.draft, "shot");
    draftSource = retry;
    if (retry.usage) usageCalls.push(retry.usage);
  }
  if (!validation.ok)
    return Response.json(
      {
        error: "模型输出未通过校验，请换个说法或改用固定句式重做",
        errors: validation.errors,
      },
      { status: 422 },
    );
  const finalSourcing = verifySourcedNumbers(validation.shot, sourcedText);
  if (finalSourcing.length > 0)
    return Response.json(
      {
        error: "模型输出了指令里没有的数值/日期，已拒绝（不给编造数据出片）",
        errors: finalSourcing,
      },
      { status: 422 },
    );

  // 确定性编译：seed 与整片同式（5000+镜序×7），同镜重生成可复现。
  const shotIndex =
    typeof (body.shot as Record<string, unknown> | undefined)?.index === "number"
      ? ((body.shot as { index: number }).index as number)
      : 0;
  let compiled;
  try {
    compiled = compileSemanticShot(validation.shot, 5000 + shotIndex * 7);
  } catch (error) {
    return Response.json(
      {
        error: "候选编译失败",
        errors: [error instanceof Error ? error.message : String(error)],
      },
      { status: 422 },
    );
  }

  const usage = usageCalls.length
    ? {
        prompt_tokens: usageCalls.reduce((n, u) => n + u.prompt_tokens, 0),
        completion_tokens: usageCalls.reduce((n, u) => n + u.completion_tokens, 0),
        total_tokens: usageCalls.reduce((n, u) => n + u.total_tokens, 0),
      }
    : null;

  return Response.json({
    shot: {
      ...compiled,
      durationMs: compiled.plan.spec.durationMs,
    },
    provenance: {
      provider: draftSource.provider,
      model: draftSource.model,
      promptVersion: SEMANTIC_REVISE_PROMPT_VERSION,
      compilerVersion: SEMANTIC_COMPILER_VERSION,
      instruction,
    },
    usage,
    ...(usage ? { usageCalls } : {}),
    ...(substitutedForAssets ? { substitutedForAssets: true } : {}),
  });
}
