import { isSameOriginRequest } from "../../same-origin";
import {
  SEMANTIC_COMPILER_VERSION,
  SEMANTIC_PROMPT_VERSION,
  semanticProviderFromEnv,
} from "../../../video-studio/semantic-provider";
import {
  compileSemanticDraft,
  validateSemanticDraft,
} from "../../../video-studio/semantic-storyboard";

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

function totalMsOf(draft: { shots: Array<{ durationMs: number }> }): number {
  return draft.shots.reduce((ms, shot) => ms + shot.durationMs, 0);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return Response.json({ error: "跨站请求已拒绝" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    return Response.json({ error: "请求过长" }, { status: 413 });
  let sentence: unknown;
  try {
    sentence = JSON.parse(await request.text()).sentence;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (
    typeof sentence !== "string" ||
    !sentence.trim() ||
    sentence.length > 240
  )
    return Response.json(
      { error: "请输入不超过 240 字的创意要求" },
      { status: 400 },
  );
  const text = sentence.trim();

  const provider = semanticProviderFromEnv(process.env);
  if (!provider)
    return Response.json(
      { error: "未配置 DASHSCOPE_API_KEY，AI 分镜不可用（旧句式规划不受影响）" },
      { status: 503 },
    );

  // 第一轮：模型直出 IR。
  const first = await provider.plan(text);
  if (!first.ok)
    return Response.json({ error: first.message, kind: first.kind }, { status: 422 });
  let validation = validateSemanticDraft(first.draft);
  let draftSource = first;

  // 时长目标（交接单验收：20-30s 或显式记录偏离）：Σ 偏离 0.8N..1.2N 与
  // IR 非法同等对待，并入同一次带因修正重试。
  const targetMs = durationTargetMs(text);
  const lo = targetMs === null ? 0 : Math.floor(targetMs * 0.8);
  const hi = targetMs === null ? Number.POSITIVE_INFINITY : Math.ceil(targetMs * 1.2);
  const offTarget =
    targetMs !== null && validation.ok && !withinRange(totalMsOf(validation.draft), lo, hi);

  // 第二轮：IR 非法或时长偏离时带原因修正重试，恰好一次。
  if (!validation.ok || offTarget) {
    const reasons = validation.ok ? [] : validation.errors.slice();
    if (offTarget && validation.ok)
      reasons.push(
        `总时长 ${totalMsOf(validation.draft)}ms 偏离要求：句子目标 ${targetMs}ms，Σ durationMs 须落在 ${lo}..${hi}ms`,
      );
    const retry = await provider.plan(text, reasons.join("；"));
    if (!retry.ok)
      return Response.json({ error: retry.message, kind: retry.kind }, { status: 422 });
    validation = validateSemanticDraft(retry.draft);
    draftSource = retry;
  }
  if (!validation.ok)
    return Response.json(
      {
        error: "模型输出未通过校验，请换个说法或改用固定句式规划",
        errors: validation.errors,
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
  const finalTotal = totalMsOf(validation.draft);
  const stillOff =
    targetMs !== null && !withinRange(finalTotal, lo, hi);

  return Response.json({
    storyboard: compiled,
    provenance: {
      provider: draftSource.provider,
      model: draftSource.model,
      promptVersion: SEMANTIC_PROMPT_VERSION,
      compilerVersion: SEMANTIC_COMPILER_VERSION,
      sentence: text,
      topic: validation.draft.topic,
    },
    // token usage 透传给调用方做计费台账（缺省 null：上游未提供）。
    usage: draftSource.usage,
    ...(stillOff
      ? { durationDeviation: { targetMs, actualMs: finalTotal } }
      : {}),
  });
}

function withinRange(value: number, lo: number, hi: number): boolean {
  return value >= lo && value <= hi;
}
