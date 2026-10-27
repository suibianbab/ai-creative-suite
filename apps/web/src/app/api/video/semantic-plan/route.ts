import {
  SEMANTIC_COMPILER_VERSION,
  SEMANTIC_PROMPT_VERSION,
  semanticProviderFromEnv,
} from "../../../video-studio/semantic-provider";
import {
  compileSemanticDraft,
  projectedTotalMs,
  requiresRealAssets,
  validateSemanticDraft,
  verifySourcedNumbers,
} from "../../../video-studio/semantic-storyboard";
import { isSameOriginRequest } from "../../same-origin";

// 语义分镜路由（交接单第 3 步，2026-10-26）：用户自然语言 → 千问受限 IR →
// 确定性校验/编译 → StoryboardResult(ok:true)。失败纪律：任何一步失败都
// 返回分类错误，绝不回退旧占位分镜、绝不产出「文件成功生成」的假成功。
// IR 校验失败给模型一次带原因的修正重试（交接单：一次可解释的重试）。

// 句中「N秒」目标解析（「约25秒」「25 秒」都认；无目标/超出 5..120s 返回 null）。
function durationTargetMs(text: string): number | null {
  const match = /(\d{1,3})\s*秒/.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (seconds < 5 || seconds > 120) return null;
  return seconds * 1000;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    return Response.json({ error: "请求过长" }, { status: 413 });
  let body: { sentence?: unknown; allowDiagramSubstitute?: unknown };
  try {
    const parsed: unknown = JSON.parse(await request.text());
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return Response.json({ error: "请求格式无效" }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }
  const sentence = body.sentence;
  if (typeof sentence !== "string" || !sentence.trim() || sentence.length > 240)
    return Response.json(
      { error: "请输入不超过 240 字的创意要求" },
      { status: 400 },
    );
  const text = sentence.trim();

  // P1（Codex 二轮复核 2026-10-27）：真实素材需求的能力边界在规划前判定。
  // 用户句明确要真实照片/素材时，即使模型会顺从提示词改成合法图解 IR，
  // 未经用户明示授权（allowDiagramSubstitute）也不得静默替换——返回
  // needs-assets 与具体下一步；一次模型调用都不发生（零成本边界）。
  const substitutedForAssets =
    body.allowDiagramSubstitute === true && requiresRealAssets(text);
  if (requiresRealAssets(text) && !substitutedForAssets)
    return Response.json(
      {
        kind: "needs-assets",
        error:
          "这条要求需要真实照片/素材，当前 AI 分镜只能画图解（标题/要点/循环/流程）。请在素材面板人工导入素材后从素材链出片，或点「改用图解生成」明示接受图解替代",
      },
      { status: 422 },
    );

  const provider = semanticProviderFromEnv(process.env);
  if (!provider)
    return Response.json(
      {
        error: "未配置 DASHSCOPE_API_KEY，AI 分镜不可用（旧句式规划不受影响）",
      },
      { status: 503 },
    );

  // 第一轮：模型直出 IR。
  const first = await provider.plan(text);
  if (!first.ok)
    return Response.json(
      { error: first.message, kind: first.kind },
      { status: 422 },
    );
  let validation = validateSemanticDraft(first.draft);
  let draftSource = first;
  // P2-4（Codex 复核）：重试的 token 用量必须合计——只报最后一调会低报成本。
  const usageCalls: Array<NonNullable<typeof first.usage>> = [];
  if (first.usage) usageCalls.push(first.usage);

  // 时长目标（交接单验收：20-30s 或显式记录偏离）：Σ 偏离 0.8N..1.2N 与
  // IR 非法同等对待，并入同一次带因修正重试。
  const targetMs = durationTargetMs(text);
  const lo = targetMs === null ? 0 : Math.floor(targetMs * 0.8);
  const hi =
    targetMs === null ? Number.POSITIVE_INFINITY : Math.ceil(targetMs * 1.2);
  const offTarget =
    targetMs !== null &&
    validation.ok &&
    !withinRange(projectedTotalMs(validation.draft), lo, hi);
  // N3 数值/日期防伪造：compare/timeline 镜头的数字必须来自用户原话。
  const sourcingErrors = validation.ok
    ? validation.draft.shots.flatMap((shot) => verifySourcedNumbers(shot, text))
    : [];

  // 第二轮：IR 非法、时长偏离或编造数值时带原因修正重试，恰好一次。
  if (!validation.ok || offTarget || sourcingErrors.length > 0) {
    const reasons = validation.ok ? [] : validation.errors.slice();
    if (offTarget && validation.ok)
      reasons.push(
        `总时长（延长后）${projectedTotalMs(validation.draft)}ms 偏离要求：句子目标 ${targetMs}ms，Σ durationMs 须落在 ${lo}..${hi}ms`,
      );
    reasons.push(...(validation.ok ? sourcingErrors : []));
    const retry = await provider.plan(text, reasons.join("；"));
    if (!retry.ok)
      return Response.json(
        { error: retry.message, kind: retry.kind },
        { status: 422 },
      );
    validation = validateSemanticDraft(retry.draft);
    draftSource = retry;
    if (retry.usage) usageCalls.push(retry.usage);
  }
  if (!validation.ok)
    return Response.json(
      {
        error: "模型输出未通过校验，请换个说法或改用固定句式规划",
        errors: validation.errors,
      },
      { status: 422 },
    );
  // 重试后仍编造数值：拒绝（不猜、不静默改写模型的事实主张）。
  const finalSourcing = validation.draft.shots.flatMap((shot) =>
    verifySourcedNumbers(shot, text),
  );
  if (finalSourcing.length > 0)
    return Response.json(
      {
        error: "模型输出了你原话里没有的数值/日期，已拒绝（不给编造数据出片）",
        errors: finalSourcing,
      },
      { status: 422 },
    );

  const compiled = compileSemanticDraft(validation.draft, text);
  if (!compiled.ok)
    return Response.json(
      { error: "分镜编译失败", errors: compiled.errors },
      { status: 422 },
    );

  // 重试后仍偏离：透明标注（不硬失败——确认卡如实显示总时长，用户决定）。
  const finalTotal = projectedTotalMs(validation.draft);
  const stillOff = targetMs !== null && !withinRange(finalTotal, lo, hi);

  // usage = 逐调合计（分项在 usageCalls）；上游未给任何 usage 时为 null。
  const usage = usageCalls.length
    ? {
        prompt_tokens: usageCalls.reduce((n, u) => n + u.prompt_tokens, 0),
        completion_tokens: usageCalls.reduce(
          (n, u) => n + u.completion_tokens,
          0,
        ),
        total_tokens: usageCalls.reduce((n, u) => n + u.total_tokens, 0),
      }
    : null;

  return Response.json({
    storyboard: compiled,
    provenance: {
      provider: draftSource.provider,
      model: draftSource.model,
      promptVersion: SEMANTIC_PROMPT_VERSION,
      compilerVersion: SEMANTIC_COMPILER_VERSION,
      sentence: text,
      topic: validation.draft.topic,
      ...(substitutedForAssets ? { substitutedForAssets: true } : {}),
    },
    // token usage 合计 + 分项，供计费台账（P2-4）。
    usage,
    ...(usage ? { usageCalls } : {}),
    // 图解替代轮如实标记：确认卡/调用方知道这是用户授权的降级方案。
    ...(substitutedForAssets ? { substitutedForAssets: true } : {}),
    ...(stillOff
      ? { durationDeviation: { targetMs, actualMs: finalTotal } }
      : {}),
  });
}

function withinRange(value: number, lo: number, hi: number): boolean {
  return value >= lo && value <= hi;
}
