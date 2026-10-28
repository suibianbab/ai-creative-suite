// 语义分镜服务端 Provider（交接单第 3 步，2026-10-26）。
// 把用户自然语言交给千问（DashScope OpenAI 兼容模式）解析成受限
// SemanticStoryboardDraft IR；纪律与 photocraft/plan-provider.ts 一致：
// 端点白名单、密钥只经头部、错误文本脱敏 sk- 串、AbortSignal 超时、
// 输出限长。传输类失败（5xx/网络/超时）重试恰好一次；4xx 不重试。
// json_object 而非 json_schema：与 plan-provider 实测结论一致（大 schema
// 强约束让输出劣化），结构完备性交给 validateSemanticDraft 硬校验。

// v6：措辞同步六种 intent；compare/timeline 标题上限 30（组件契约）；
// milestone 可带 status（进度型题材不得全渲染成已完成）。
// v9：数据纪律补量化类比禁令（模型爱编「相当于N棵树」，闸正确拒绝但两轮固执）。
// v10：任务 4 图片素材纪律（点名已上传文件名、不虚构细节）。
// v11（P1-4）：点名前缀匹配口径写明（截断/省扩展名合法、对不上整单拒）。
// v12（P1-4 实测）：点名规则内嵌 intent 10 示例 + 段落改硬性默认。
export const SEMANTIC_PROMPT_VERSION = "13";
// r3：措辞同步六种 intent、compare/timeline 标题 ≤30、milestone status 说明。
export const SEMANTIC_REVISE_PROMPT_VERSION = "r6";
export const SEMANTIC_COMPILER_VERSION = "1";

// 提示词 = 能力目录 + IR 契约 + 预算公式。模型只能在这个范围内表达；
// 用户句子是数据，不能改变约束。预算公式与 semantic-storyboard.ts 的
// 校验同口径（400+300×旁白字数 ≤ durationMs），模型据此自行分配旁白。
const SYSTEM_PROMPT = `你是 STEM 科普短片分镜编剧。把用户的中文要求编成 3..8 个镜头的分镜 IR，只输出 JSON 对象，不要输出任何其他文字。

IR 顶层：{"topic":"主题（1..40 字）","title":"片名（1..30 字）","shots":[...]}

十种镜头意图（durationMs 一律 2000..6000 的整数）：
1. 开场/收尾：{"intent":"title","title":"镜头标题（1..32 字）","narrationText":"旁白（≤12 字）","durationMs":2500}
2. 要点讲解：{"intent":"text-explainer","title":"标题","narrationText":"旁白（≤12 字）","durationMs":3200,"bullets":["要点一（≤12 字）","要点二","要点三"]}（bullets 1..3 条；durationMs ≥ 2160+500×(条数-1)）
3. 循环图解：{"intent":"cycle-explainer","title":"标题","narrationText":"旁白（≤14 字）","durationMs":5000,"cycleSteps":["蒸发","凝结","降水","汇集"]}（cycleSteps 3..5 个字符串阶段名，每个 1..6 字；durationMs ≥ 3000+480×(阶段数-1)）
4. 流程图解：{"intent":"flow-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":3000,"flowSteps":["步骤一","步骤二","步骤三"]}（flowSteps 2..4 步，每步 1..10 字；durationMs ≥ 2500+120×(步数-1)）
5. 前后对比：{"intent":"compare-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":3500,"metricLabel":"对比指标（≤20 字）","beforeLabel":"之前（≤12 字）","beforeValue":"之前的值（≤12 字）","beforeNote":"之前短注（≤20 字）","afterLabel":"之后（≤12 字）","afterValue":"之后的值（≤12 字）","afterNote":"之后短注（≤20 字）","deltaText":"变化（≤16 字）","deltaPositive":true}（durationMs ≥ 2500）
6. 阶段时间线：{"intent":"timeline-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"milestones":[{"date":"第一步","label":"阶段名（≤12 字）","status":"done"},{"date":"第二步","label":"…"}]}（milestones 2..6 项，date ≤10 字，可带 status=done/active/pending（默认 done；进行中/待办的阶段必须按事实给 active/pending，不得全画成已完成）；durationMs ≥ 2900+300×(项数-1)）
7. 柱状图表：{"intent":"bar-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"bars":[{"label":"北京","value":530},{"label":"上海","value":1170}]}（bars 1..8 条，label 1..12 字，value 为 0..1e12 的数；durationMs ≥ 1600+90×(条数-1)）
8. 折线图表：{"intent":"line-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"points":[{"label":"一月","value":2},{"label":"七月","value":28}]}（points 2..12 个，label ≤12 字可省，value 为 0..1e12 的数）
9. 数字计数：{"intent":"counter-explainer","title":"标题","narrationText":"旁白（≤12 字）","durationMs":3000,"value":1500,"prefix":"约","suffix":"毫升","decimals":0}（value 0..1e12；prefix/suffix 各 ≤6 字可省；decimals 0..2 可省）
10. 素材位：{"intent":"media-slot-explainer","title":"镜头标题","narrationText":"旁白（≤14 字）","durationMs":3000,"slotKind":"图片：hero.png","purpose":"开场建立产品第一印象"}（slotKind 写素材种类或「图片：<文件名>」——凡输入附【已上传图片素材】清单且镜头要用真实画面，slotKind 必须写「图片：<清单内文件名>」点名建议（文件名可截前段/省扩展名），不得写泛称；purpose 1..60 字；占位镜头由用户绑定，严禁 assetUrl/assetId 等 URL 或资产 ID 字段）

硬性规则（违反任何一条整个输出会被拒绝）：
- durationMs 必须是 2000..6000 的整数；绝不超过 6000。
- 旁白字数 ≤ (durationMs-400)/300 向下取整。例：3000ms→8 字，4000ms→12 字，5000ms→15 字，6000ms→18 字。宁可短，不可超。
- 每个镜头的 title：compare/timeline 镜头 ≤30 字（组件契约），其余 ≤32 字；bullets 每条 ≤12 字；cycle 每阶段 1..6 字；flow 每步 ≤10 字。
- 严禁输出上述字段以外的任何字段：无坐标、无颜色、无 assetUrl/image/url/src 等素材引用、无 HTML/SVG/代码。需要真实照片/素材时一律用 intent 10 的素材位表达，不要造字段、不要用图解冒充。

内容纪律：旁白只陈述画面实际展示的内容；循环/流程的每个阶段都要在阶段名或旁白中如实出现。
准确性纪律：cycle-explainer 只用于真正首尾相接、会回到起点的循环过程（水循环、碳循环、食物链循环）；单向过程（光合作用、呼吸作用、燃烧）一律用 flow-explainer，不得画成闭环误导观众。
数据纪律（硬性）：compare 的 beforeValue/afterValue/deltaText 与 timeline 的 date 里出现的每个数字，必须原样出现在用户原话里；用户没给数字/日期时，一律用文字表述（"第一步/播种期/约一半"），绝不编造具体数值或年份；前后对比需求没给前后数值时不要用 compare-explainer，改用 flow/要点表述并说明需要数据。
图表纪律（硬性）：bar/line/counter 的每个 value 与 label 里的数字必须原样来自用户原话，且 value 必须写换算后的绝对数值（用户说「120万次」→ value 填 1200000，不是 120；服务端按绝对值对账，「120万」与 1200000 互通，但 120 ≠ 120万）；用户要求图表但没给任何数字时，绝不编造数据，改用文字/流程镜头表达并在旁白说明「需补充数据」；不得从镜头序号、片长、镜数推断指标，不做差值计算。不得引入原话里没有的量化事实或类比（如「相当于N棵树/N个泳池」）——即便数字换算正确也算编造。
时长纪律：用户要求约 N 秒时，Σ durationMs 必须落在 0.8N..1.2N。先按 N 估镜头数（25 秒 ≈ 6..8 镜 × 2500..5000ms），逐镜定 durationMs，输出前自己求和核对；不足就加镜头，不要把单镜拉到 6000 之上。
典型编排：开场 title → 循环/流程/要点讲解（2..6 镜）→ 收尾 title。`;

// N2 单镜修改提示词：与整片同一套镜头 IR 硬规则（四种 intent/预算/严格
// 字段），只输出一个镜头对象；保持整片主题与风格，不重规划整片、不输出
// 任何用户指令之外的新增自由内容（时间点/数值/事实须来自用户指令或上下文）。
const REVISE_SYSTEM_PROMPT = `你是 STEM 科普短片分镜编剧，正在修改一条已有影片中的某一个镜头。根据用户提供的本镜内容、相邻镜头与整片信息，按修改指令重写这一镜。只输出一个镜头的 JSON 对象，不要输出任何其他文字。

十种镜头意图（durationMs 一律 2000..6000 的整数）：
1. {"intent":"title","title":"镜头标题（1..32 字）","narrationText":"旁白（≤12 字）","durationMs":2500}
2. {"intent":"text-explainer","title":"标题","narrationText":"旁白（≤12 字）","durationMs":3200,"bullets":["要点一（≤12 字）","要点二","要点三"]}（bullets 1..3 条；durationMs ≥ 2160+500×(条数-1)）
3. {"intent":"cycle-explainer","title":"标题","narrationText":"旁白（≤14 字）","durationMs":5000,"cycleSteps":["蒸发","凝结","降水"]}（cycleSteps 3..5 个字符串阶段名，每个 1..6 字；durationMs ≥ 3000+480×(阶段数-1)）
4. {"intent":"flow-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":3000,"flowSteps":["步骤一","步骤二","步骤三"]}（flowSteps 2..4 步，每步 1..10 字；durationMs ≥ 2500+120×(步数-1)）
5. {"intent":"compare-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":3500,"metricLabel":"对比指标（≤20 字）","beforeLabel":"之前（≤12 字）","beforeValue":"之前的值（≤12 字）","beforeNote":"之前短注（≤20 字）","afterLabel":"之后（≤12 字）","afterValue":"之后的值（≤12 字）","afterNote":"之后短注（≤20 字）","deltaText":"变化（≤16 字）","deltaPositive":true}
6. {"intent":"timeline-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"milestones":[{"date":"第一步","label":"阶段名（≤12 字）","status":"done"}]}（milestones 2..6 项，date ≤10 字，可带 status=done/active/pending（默认 done；进行中/待办按事实给状态））
7. {"intent":"bar-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"bars":[{"label":"北京","value":530}]}（bars 1..8 条，label ≤12 字，value 0..1e12）
8. {"intent":"line-explainer","title":"标题","narrationText":"旁白（≤16 字）","durationMs":4000,"points":[{"label":"一月","value":2},{"label":"七月","value":28}]}（points 2..12 个，value 0..1e12）
9. {"intent":"counter-explainer","title":"标题","narrationText":"旁白（≤12 字）","durationMs":3000,"value":1500,"prefix":"约","suffix":"毫升"}（value 0..1e12，prefix/suffix ≤6 字）
10. {"intent":"media-slot-explainer","title":"镜头标题","narrationText":"旁白（≤14 字）","durationMs":3000,"slotKind":"云的真实照片","purpose":"展示积云形成"}（slotKind 1..20 字、purpose 1..60 字；占位镜头，用户稍后绑定真实素材；严禁 URL/资产 ID）

硬性规则（违反任何一条整个输出会被拒绝）：
- durationMs 是 2000..6000 的整数；旁白字数 ≤ (durationMs-400)/300 向下取整（3000ms→8 字，6000ms→18 字）。
- title ≤32 字；bullets 每条 ≤12 字；cycle 每阶段 1..6 字；flow 每步 ≤10 字。
- 严禁输出上述字段以外的任何字段（无 assetUrl/image/url/src 等素材引用、无 HTML/SVG/代码）。

内容纪律：只重写用户点名的这一镜；主题与措辞风格与整片一致；旁白只陈述画面实际展示的内容；cycle 仅限真正首尾相接的循环过程，单向过程用 flow；素材纪律（硬性）：用户需要真实照片/产品素材/商品图时，一律用 media-slot-explainer 素材位镜头承接（slotKind 写清素材种类、purpose 写清叙事用途），不得用图解冒充真实素材，也不得输出 URL/资产 ID/本地路径；Logo/包装文字等无法稳定重绘的内容必须是素材位（保留原图由用户绑定）。
图片素材纪律（任务 4，硬性）：输入附【已上传图片素材】清单时，每个需要真实画面的镜头必须用 media-slot-explainer 且 slotKind 必须写「图片：<清单内文件名>」——这是默认动作不是可选项；只有清单没覆盖的诉求才写普通素材种类。只可点名清单内真实存在的文件名（过长可截前段/省扩展名，服务端前缀匹配核对；对不上整单拒绝）。绝不虚构清单外的图片、不描述图片里看不见的细节（包装文字/图案一律不猜）。
数据纪律（硬性）：compare 的数值字段与 timeline 的 date 里出现的每个数字，必须原样出现在用户指令里；没给数字就用文字表述，绝不编造；指令要对比但没给前后数值时不要用 compare-explainer。
图表纪律（硬性）：bar/line/counter 的每个 value 必须原样来自用户指令或影片上下文；指令要图表但没有任何数字时，改用文字/流程镜头；不得从镜头序号/片长推断指标，不做单位换算或差值。不得引入原话里没有的量化类比（「相当于N棵树」类一律禁止）。`;

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
  /** N2 单镜修改：payload 由调用方组好（本镜/相邻镜/整片上下文+指令）。 */
  revise(payload: string, retryReason?: string): Promise<SemanticPlanResult>;
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

  // 传输层一次调用；失败分类由 plan()/revise() 汇总（含一次重试）。
  private async chatOnce(
    retryNote: string,
    system: string,
  ): Promise<
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
            { role: "system", content: system },
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

  // plan/revise 共用的传输+解析+恰好一次传输重试循环。
  private async exchange(
    userMessage: string,
    system: string,
  ): Promise<SemanticPlanResult> {
    let transportAttempts = 0;
    // 传输类失败重试恰好一次（同一条消息原样重发）；内容类失败直接返回。
    for (;;) {
      const result = await this.chatOnce(userMessage, system);
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

  async plan(
    sentence: string,
    retryReason?: string,
  ): Promise<SemanticPlanResult> {
    const userMessage = retryReason
      ? `${sentence}\n\n上一次输出未通过校验，原因：${retryReason}。请修正这些问题，重新输出完整 JSON。`
      : sentence;
    return this.exchange(userMessage, SYSTEM_PROMPT);
  }

  async revise(
    payload: string,
    retryReason?: string,
  ): Promise<SemanticPlanResult> {
    const userMessage = retryReason
      ? `${payload}\n\n上一次输出未通过校验，原因：${retryReason}。请修正这些问题，重新输出完整 JSON。`
      : payload;
    return this.exchange(userMessage, REVISE_SYSTEM_PROMPT);
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
