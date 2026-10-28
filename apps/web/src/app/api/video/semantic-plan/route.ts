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
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return Response.json({ error: "请求过长" }, { status: 413 });
  let body: {
    sentence?: unknown;
    allowDiagramSubstitute?: unknown;
    imageAssets?: unknown;
  };
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

  // 任务 4：图片账本摘要净化（≤20 张、fileName ≤40 字裁剪）——只把
  // 「有哪些图」给模型做镜头建议参考，绑定永远是用户动作。
  const imageLedger: string[] = [];
  // P1-4：原始（截断后）文件名清单，供点名对账。
  const imageAssetsRaw: Array<{ fileName: string }> = [];
  if (Array.isArray(body.imageAssets)) {
    for (const item of body.imageAssets.slice(0, 20)) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const fileName =
        typeof entry.fileName === "string" ? entry.fileName.slice(0, 40) : "";
      const width = Number(entry.width);
      const height = Number(entry.height);
      if (!fileName) continue;
      imageLedger.push(
        `${fileName}（${
          Number.isInteger(width) && Number.isInteger(height)
            ? `${width}×${height}`
            : "尺寸未知"
        }）`,
      );
      imageAssetsRaw.push({ fileName });
    }
  }

  // N5（2026-10-27）：素材诉求句放行——模型以 media-slot 素材位承接
  // （先规划位、再由用户绑定入库素材）；明示授权图解替代时记录标记。
  const assetDemand = requiresRealAssets(text);
  const substitutedForAssets =
    body.allowDiagramSubstitute === true && assetDemand;

  const provider = semanticProviderFromEnv(process.env);
  if (!provider)
    return Response.json(
      {
        error: "未配置 DASHSCOPE_API_KEY，AI 分镜不可用（旧句式规划不受影响）",
      },
      { status: 503 },
    );

  // 第一轮：模型直出 IR。
  const planPayload =
    imageLedger.length > 0
      ? `${text}

【已上传图片素材（镜头可建议使用，绑定由用户完成）】
${imageLedger.join("、")}`
      : text;
  const first = await provider.plan(planPayload);
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
  // P1-4（Codex 复核 2026-10-28）：「图片：<名>」点名必须对应本次清单。
  // 前缀双向匹配（长文件名可截断/省扩展名），大小写不敏感；对不上即拒，
  // 走带因重试——不虚构「只可用清单内真实文件名」的承诺。
  const ledgerNames = imageAssetsRaw.map((e) => e.fileName);
  function imageNamingErrors(draft: {
    shots: Array<{ intent: string; slotKind?: string }>;
  }): string[] {
    const problems: string[] = [];
    for (const [i, shot] of draft.shots.entries()) {
      if (shot.intent !== "media-slot-explainer") continue;
      const kind = shot.slotKind ?? "";
      if (!kind.startsWith("图片：")) continue;
      const named = kind.slice("图片：".length).trim().toLowerCase();
      const matched = ledgerNames.some((name) => {
        const n = name.toLowerCase();
        return n.startsWith(named) || named.startsWith(n);
      });
      if (!matched)
        problems.push(
          `shots[${i}].slotKind 点名的「${named}」不在已上传图片清单里：只能点名清单内的文件（${ledgerNames.join("、")}），或改写普通素材种类`,
        );
    }
    return problems;
  }

  // N3 数值/日期防伪造：compare/timeline 镜头的数字必须来自用户原话。
  const sourcingErrors = validation.ok
    ? validation.draft.shots.flatMap((shot) => verifySourcedNumbers(shot, text))
    : [];
  // P1-4：图片点名对账（同批进重试）。
  const namingErrors =
    validation.ok && ledgerNames.length > 0
      ? imageNamingErrors(validation.draft)
      : [];

  // N5：素材诉求但首轮无素材位 → 并入带因重试（要求产 media-slot）。
  const missingSlots =
    assetDemand &&
    !substitutedForAssets &&
    validation.ok &&
    !validation.draft.shots.some(
      (shot) => shot.intent === "media-slot-explainer",
    );

  // 第二轮：IR 非法、时长偏离、编造数值或缺素材位时带原因修正重试，恰好一次。
  if (
    !validation.ok ||
    offTarget ||
    sourcingErrors.length > 0 ||
    namingErrors.length > 0 ||
    missingSlots
  ) {
    const reasons = validation.ok ? [] : validation.errors.slice();
    if (offTarget && validation.ok)
      reasons.push(
        `总时长（延长后）${projectedTotalMs(validation.draft)}ms 偏离要求：句子目标 ${targetMs}ms，Σ durationMs 须落在 ${lo}..${hi}ms`,
      );
    if (missingSlots)
      reasons.push(
        "这句明确需要真实照片/素材：请为素材需求输出 media-slot-explainer 素材位镜头（slotKind=素材种类、purpose=叙事用途），不要用图解冒充",
      );
    reasons.push(...(validation.ok ? sourcingErrors : []));
    reasons.push(...(validation.ok ? namingErrors : []));
    const retry = await provider.plan(planPayload, reasons.join("；"));
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
  // N5 终检：素材诉求两轮都没有素材位 → 拒绝（不给图解冒充真实素材出片）。
  if (
    assetDemand &&
    !substitutedForAssets &&
    !validation.draft.shots.some(
      (shot) => shot.intent === "media-slot-explainer",
    )
  )
    return Response.json(
      {
        kind: "needs-assets",
        error:
          "这条要求需要真实照片/素材，但模型未给出素材位。请重试生成（要求素材位），或明示改用图解（生成后在镜头上仍可绑定素材替换）",
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
  // P1-4 终检：重试后点名仍对不上清单 → 拒绝（提示用户换说法或描述用途）。
  if (ledgerNames.length > 0) {
    const finalNaming = imageNamingErrors(validation.draft);
    if (finalNaming.length > 0)
      return Response.json(
        {
          error:
            "模型点名的图片不在已上传清单里（两轮修正未通过），请重试或在句子里明确说明每张图的用途",
          errors: finalNaming,
        },
        { status: 422 },
      );
  }

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

  // N4：图表诉求但句中无数字且成片无图表镜 → 非阻断提示（补数据可用图表）。
  const chartWords = /图表|柱状|折线|计数|数据/.test(text);
  const hasChartShot = validation.draft.shots.some((shot) =>
    ["bar-explainer", "line-explainer", "counter-explainer"].includes(
      shot.intent,
    ),
  );
  const dataHint =
    chartWords && !hasChartShot && !/\d/.test(text)
      ? "这句话没有可用数字：补充具体数值后可用柱状/折线/计数图表镜头"
      : undefined;

  return Response.json({
    storyboard: compiled,
    ...(dataHint ? { dataHint } : {}),
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
