// 语义分镜服务端 Provider（交接单第 3 步，2026-10-26）。
// 把用户自然语言交给千问（DashScope OpenAI 兼容模式）解析成受限
// SemanticStoryboardDraft IR；纪律与 photocraft/plan-provider.ts 一致：
// 端点白名单、密钥只经头部、错误文本脱敏 sk- 串、AbortSignal 超时、
// 输出限长。传输类失败（5xx/网络/超时）重试恰好一次；4xx 不重试。
// json_object 而非 json_schema：与 plan-provider 实测结论一致（大 schema
// 强约束让输出劣化），结构完备性交给 validateSemanticDraft 硬校验。

export const SEMANTIC_PROMPT_VERSION = "2";
export const SEMANTIC_COMPILER_VERSION = "1";

// 提示词 = 能力目录 + IR 契约 + 预算公式。模型只能在这个范围内表达；
// 用户句子是数据，不能改变约束。预算公式与 semantic-storyboard.ts 的
// 校验同口径（400+300×旁白字数 ≤ durationMs），模型据此自行分配旁白。
const SYSTEM_PROMPT = `你是 STEM 科普短片分镜编剧。把用户的中文要求编成 3..8 个镜头的分镜 IR，只输出 JSON 对象，不要输出任何其他文字。

IR 顶层：{"topic":"主题（1..40 字）","title":"片名（1..30 字）","shots":[...]}

四种镜头意图（durationMs 一律 2000..6000 的整数）：
1. 开场/收尾：{"intent":"title","title":"镜头标题（1..32 字）","narrationText":"旁白（≤12 字）","durationMs":2500}
2. 要点讲解：{"intent":"text-explainer","title":"标题","narrationText":"旁白（≤12 字）","durationMs":3200,"bullets":["要点一（≤12 字）","要点二","要点三"]}（bullets 1..3 条；durationMs ≥ 2160+500×(条数-1)）
3. 循环图解：{"intent":"cycle-explainer","title":"标题","narrationText":"旁白（≤14 字）","durationMs":5000,"cycleSteps":[{"label":"蒸发","caption":"可选短注≤12字"},{"label":"凝结"},{"label":"降水"},{"label":"汇集"}]}（cycleSteps 3..5 阶段，label 1..6 字；durationMs ≥ 3000+480×(阶段数-1)）
4. 流程图解：{"intent":"flow-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":3000,"flowSteps":["步骤一","步骤二","步骤三"]}（flowSteps 2..4 步，每步 1..6 字；durationMs ≥ 2500+120×(步数-1)）

硬性规则（违反任何一条整个输出会被拒绝）：
- durationMs 必须是 2000..6000 的整数；绝不超过 6000。
- 旁白字数 ≤ (durationMs-400)/300 向下取整。例：3000ms→8 字，4000ms→12 字，5000ms→15 字，6000ms→18 字。宁可短，不可超。
- 每个镜头的 title ≤32 字；bullets 每条 ≤12 字；cycle label ≤6 字、caption ≤12 字；flow 每步 ≤6 字。
- 不输出上述字段以外的任何字段（无坐标、无颜色、无 URL、无代码）。

内容纪律：旁白只陈述画面实际展示的内容；循环/流程的每个阶段都要在 label/caption 或旁白中如实出现；不要虚构当前画不出来的东西（真实照片、复杂机械结构）。
时长纪律：用户要求约 N 秒时，Σ durationMs 必须落在 0.8N..1.2N。先按 N 估镜头数（25 秒 ≈ 6..8 镜 × 2500..5000ms），逐镜定 durationMs，输出前自己求和核对；不足就加镜头，不要把单镜拉到 6000 之上。
典型编排：开场 title → 循环/流程/要点讲解（2..6 镜）→ 收尾 title。`;

export type SemanticPlanFailureKind =
  | "timeout"
  | "http"
  | "network"
  | "invalid-json"
  | "too-large";

export type SemanticTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type SemanticPlanResult =
  | {
      ok: true;
      draft: unknown;
      provider: string;
      model: string;
      /** 上游 usage 原样透传（计费台账证据）；上游未给则为 null。 */
      usage: SemanticTokenUsage | null;
    }
  | {
      ok: false;
      kind: SemanticPlanFailureKind;
      message: string;
      /** 传输类失败（可重试）为 true；内容类失败（4xx/坏 JSON/超限）为 false */
      retryable: boolean;
    };

export interface SemanticPlanProvider {
  readonly name: string;
  readonly model: string;
  /** retryReason：路由层 IR 校验失败后的一次修正重试（把拒绝原因带给模型）。 */
  plan(sentence: string, retryReason?: string): Promise<SemanticPlanResult>;
}

const ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MAX_OUTPUT_CHARS = 16 * 1024;
const TIMEOUT_MS = 60_000;

function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9-]+/g, "[redacted]").slice(0, 240);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

class QwenSemanticProvider implements SemanticPlanProvider {
  readonly name = "qwen-chat";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  // 传输层一次调用；失败分类由 plan() 汇总（含一次重试）。
  private async chatOnce(retryNote: string): Promise<
    | { ok: true; content: string; usage: SemanticTokenUsage | null }
    | {
        ok: false;
        kind: SemanticPlanFailureKind;
        message: string;
        retryable: boolean;
      }
  > {
    let upstream: Response;
    try {
      upstream = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: retryNote },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (isTimeout(error))
        return {
          ok: false,
          kind: "timeout",
          message: "分镜模型请求超时",
          retryable: true,
        };
      return {
        ok: false,
        kind: "network",
        message: "分镜模型网络错误",
        retryable: true,
      };
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return {
        ok: false,
        kind: "http",
        message: `分镜模型返回 HTTP ${upstream.status}。${redact(detail)}`,
        retryable: upstream.status >= 500,
      };
    }
    const data = (await upstream.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      return {
        ok: false,
        kind: "invalid-json",
        message: "分镜模型未返回内容",
        retryable: false,
      };
    const u = data?.usage;
    const usage =
      typeof u?.prompt_tokens === "number" &&
      typeof u?.completion_tokens === "number" &&
      typeof u?.total_tokens === "number"
        ? {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
          }
        : null;
    return { ok: true, content, usage };
  }

  async plan(
    sentence: string,
    retryReason?: string,
  ): Promise<SemanticPlanResult> {
    const userMessage = retryReason
      ? `${sentence}\n\n上一次输出未通过校验，原因：${retryReason}。请修正这些问题，重新输出完整 JSON。`
      : sentence;
    let transportAttempts = 0;
    // 传输类失败重试恰好一次（同一条消息原样重发）；内容类失败直接返回。
    for (;;) {
      const result = await this.chatOnce(userMessage);
      transportAttempts += 1;
      if (result.ok) {
        if (result.content.length > MAX_OUTPUT_CHARS)
          return {
            ok: false,
            kind: "too-large",
            message: "分镜模型输出过长",
            retryable: false,
          };
        try {
          return {
            ok: true,
            draft: JSON.parse(result.content),
            provider: this.name,
            model: this.model,
            usage: result.usage,
          };
        } catch {
          return {
            ok: false,
            kind: "invalid-json",
            message: "分镜模型输出不是合法 JSON",
            retryable: false,
          };
        }
      }
      if (!result.retryable || transportAttempts > 1) return result;
    }
  }
}

export function semanticProviderFromEnv(
  env: NodeJS.ProcessEnv,
): SemanticPlanProvider | null {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  return new QwenSemanticProvider(
    apiKey,
    env.VIDEO_SEMANTIC_MODEL || "qwen-plus",
  );
}
