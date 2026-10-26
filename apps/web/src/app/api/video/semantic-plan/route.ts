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

  // 第二轮：IR 非法时带原因修正重试，恰好一次。
  if (!validation.ok) {
    const retry = await provider.plan(text, validation.errors.join("；"));
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
  });
}
