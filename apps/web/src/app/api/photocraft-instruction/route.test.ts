import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

// M2 路由分拣（通用语言指令方案 §5/§6）：快车道 → 默认策略表本地补全 →
// 云解析道 + round-trip 蕴含核对 → 本机道 → 503。云 Provider 全程走
// Provider 抽象，测试注入假的 fetch，不触网、不依赖密钥。

const ask = (instruction: string) =>
  new Request("http://localhost:3000/api/photocraft-instruction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction }),
  });

function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const mutable = process.env as Record<string, string | undefined>;
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = mutable[key];
    if (values[key] === undefined) delete mutable[key];
    else mutable[key] = values[key];
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete mutable[key];
      else mutable[key] = value;
    }
  });
}

test("unrecognized phrasing stays 503 when no model lane is configured", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      PHOTOCRAFT_INSTRUCTION_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
      DASHSCOPE_API_KEY: undefined,
      PHOTOCRAFT_INSTRUCTION_API_KEY: undefined,
    },
    async () => {
      const response = await POST(ask("make the subject brighter"));
      assert.equal(response.status, 503);
      const data = await response.json();
      assert.match(String(data.error), /本机模型服务未启用/);
    },
  );
});

test("param-only gaps complete locally from the default strategy table", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("defaults lane must not call any model");
  };
  try {
    const response = await POST(ask("把主体亮度提高"));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.provider, "rules-defaults");
    assert.equal(data.plan.operation, "adjust");
    assert.equal(data.plan.adjustment, "brightness");
    assert.equal(data.plan.amount, 10);
    assert.equal(data.plan.target, "subject");
    assert.deepEqual(data.defaults, [
      { slot: "amount", value: 10, rule: "未说明幅度→10" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicitly unsupported verbs are rejected before any model lane", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("unsupported verbs must not reach a provider");
  };
  try {
    const response = await POST(ask("把背景里的杂物去掉"));
    assert.equal(response.status, 422);
    const data = await response.json();
    assert.match(String(data.error), /不支持/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud lane parses, hard-validates and applies the round-trip entailment gate", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: string; responseFormat: unknown }> = [];
  try {
    await withEnv(
      {
        NODE_ENV: "production",
        PHOTOCRAFT_INSTRUCTION_PROVIDER: "qwen-chat",
        DASHSCOPE_API_KEY: "test-only",
        PHOTOCRAFT_INSTRUCTION_JUDGE: undefined,
      },
      async () => {
        globalThis.fetch = async (url, options) => {
          assert.equal(
            url,
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
          );
          const body = JSON.parse(String(options?.body));
          calls.push({
            body: body.messages?.[1]?.content ?? "",
            responseFormat: body.response_format,
          });
          const isJudge = String(body.messages?.[0]?.content).includes(
            "蕴含核对器",
          );
          return Response.json(
            isJudge
              ? {
                  choices: [
                    { message: { content: '{"entailed":true,"issues":[]}' } },
                  ],
                }
              : {
                  choices: [
                    {
                      message: {
                        // 任务②实测：云端 json_object 不带 schema，模型精确
                        // 计划会省略 unsupported 信封字段（reconcile 补默认）。
                        content:
                          '{"operation":"adjust","adjustment":"brightness","amount":15,"target":"subject"}',
                      },
                    },
                  ],
                },
          );
        };
        const response = await POST(ask("make the subject brighter"));
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.provider, "qwen-chat");
        // 原话没有任何数字 → 幅度按默认策略表归一（模型自报 15 不作数）。
        assert.equal(data.plan.amount, 10);
        assert.ok(data.intent);
        assert.equal(calls.length, 2, "parse + judge round trip");
        // 解析道与 judge 都以 json_object 调用（json_schema 实测让云端输出
        // 劣化：漏 adjustment/amount、填无关默认值）。
        assert.ok(
          calls.every(
            (call) =>
              (call.responseFormat as { type?: string } | undefined)?.type ===
              "json_object",
          ),
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("round-trip failure downgrades to explainConfirm instead of auto-applying", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withEnv(
      {
        NODE_ENV: "production",
        PHOTOCRAFT_INSTRUCTION_PROVIDER: "openai-chat",
        OPENAI_API_KEY: "test-only",
      },
      async () => {
        globalThis.fetch = async () =>
          Response.json({
            choices: [
              {
                message: {
                  content:
                    '{"operation":"adjust","adjustment":"brightness","amount":10,"target":"subject","protectLabel":false,"unsupported":""}',
                },
              },
            ],
          });
        const response = await POST(ask("make the background darker"));
        assert.equal(response.status, 200);
        const data = await response.json();
        // openai-chat mock 对 judge 也返回 plan 文本 → 判定输出无效 → 安全侧不蕴含。
        assert.ok(data.explainConfirm, "must downgrade to explainConfirm");
        assert.match(String(data.explainConfirm.description), /主体|背景/);
        assert.ok(Array.isArray(data.explainConfirm.issues));
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("target gaps route to grounding guidance instead of guessing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("target gaps must not reach a model lane");
  };
  try {
    const response = await POST(ask("把屋顶提亮一点"));
    assert.equal(response.status, 422);
    const data = await response.json();
    assert.match(String(data.error), /调整对象/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// P1-2（codex 审核 2026-10-16）：没有「把/将/让」引导词的口语说法同样要把
// 目标短语带回来——候选环（M3 开放词汇选区）靠 phrase 去搜部件候选，缺了
// phrase 用户只能收到一句泛泛的「不在可识别名词内」。
test("subject-first target gaps carry the phrase for the candidate ring", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("target gaps must not reach a model lane");
  };
  try {
    const response = await POST(ask("屋顶提亮一点"));
    assert.equal(response.status, 422);
    const data = await response.json();
    const targetGap = (data.gaps ?? []).find(
      (gap: { kind: string }) => gap.kind === "target",
    );
    assert.ok(targetGap, "响应必须带回 target 缺口");
    assert.equal(targetGap.phrase, "屋顶");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 补充B（codex 审核 2026-10-16）：换色的目标颜色是语义必需槽——缺失时不默认
// 灰色、也不进云道让模型猜；超出色板属于能力范围外，同样在模型道之前拦截。
test("recolor color gaps are rejected before any model lane", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("color gaps must not reach a model lane");
  };
  try {
    const missing = await POST(ask("把主体换个颜色"));
    assert.equal(missing.status, 422);
    const missingData = await missing.json();
    assert.match(String(missingData.error), /未说明目标颜色/);
    assert.ok(
      (missingData.gaps ?? []).some(
        (gap: { slot: string }) => gap.slot === "color",
      ),
    );

    const offPalette = await POST(ask("把主体改成紫色"));
    assert.equal(offPalette.status, 422);
    const offPaletteData = await offPalette.json();
    assert.match(String(offPaletteData.error), /换色能力范围/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 补充B 闭环：选色行点「红」后界面以「原话，改成红色」重解析——该拼接句式
// 必须直接解析出所选颜色的计划，不能把用户送回缺口死循环。
test("color-chip rewrite parses straight to the chosen recolor plan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("chip rewrite must not need a model lane");
  };
  try {
    const response = await POST(ask("把主体换个颜色，改成红色"));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.provider, "rules");
    assert.equal(data.plan.operation, "recolor");
    assert.equal(data.plan.color, "red");
    assert.equal(data.plan.target, "subject");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
