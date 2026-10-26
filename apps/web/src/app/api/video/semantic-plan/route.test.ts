import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

// 语义分镜路由（交接单第 3 步）：Provider 全程注入假 fetch，不触网。
// 失败纪律：不产生占位分镜——错误分类返回，storyboard 字段只在成功时出现。

const ask = (sentence: string) =>
  new Request("http://localhost:3000/api/video/semantic-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentence }),
  });

const VALID_IR = JSON.stringify({
  topic: "水循环",
  title: "水的旅程",
  shots: [
    { intent: "title", title: "水的旅程", narrationText: "一滴水的旅程", durationMs: 3000 },
    {
      intent: "cycle-explainer",
      title: "水循环四阶段",
      narrationText: "水在四个阶段循环",
      durationMs: 5000,
      cycleSteps: ["蒸发", "凝结", "降水", "汇集"],
    },
    { intent: "title", title: "谢谢观看", narrationText: "谢谢观看", durationMs: 2500 },
  ],
});

function chatResponse(content: string, usage?: object) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage ? { usage } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

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

const NO_KEY = { DASHSCOPE_API_KEY: undefined };
const WITH_KEY = { DASHSCOPE_API_KEY: "test-only" };

test("semantic-plan：缺密钥 → 503 且不触网", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("must not call provider without key");
  };
  try {
    await withEnv(NO_KEY, async () => {
      const response = await POST(ask("做一条水循环短片"));
      assert.equal(response.status, 503);
      const data = await response.json();
      assert.match(String(data.error), /DASHSCOPE_API_KEY/);
      assert.equal(data.storyboard, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：合法 IR → 200 返回 storyboard 与 provenance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(VALID_IR);
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条约25秒的水循环科普短片"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.storyboard.ok, true);
      assert.equal(data.storyboard.shots.length, 3);
      assert.equal(data.storyboard.title, "水的旅程");
      assert.equal(data.storyboard.totalMs, 10500);
      assert.equal(data.provenance.provider, "qwen-chat");
      assert.equal(data.provenance.model, "qwen-plus");
      assert.equal(data.provenance.promptVersion, "4");
      assert.equal(data.provenance.compilerVersion, "1");
      assert.equal(
        data.provenance.sentence,
        "做一条约25秒的水循环科普短片",
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：首次 IR 非法 → 带原因重试一次后成功", async () => {
  const originalFetch = globalThis.fetch;
  const userMessages: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    userMessages.push(body.messages[1]!.content);
    // 第一次：旁白超绝对上限（>18 字无论如何延长都读不完）；第二次：合法。
    return chatResponse(
      calls === 1
        ? JSON.stringify({
            ...JSON.parse(VALID_IR),
            shots: [
              { intent: "title", title: "T", narrationText: "这段旁白实在太长了肯定无论如何都装不下啊", durationMs: 2000 },
              ...JSON.parse(VALID_IR).shots.slice(1),
            ],
          })
        : VALID_IR,
    );
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条水循环短片"));
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
      assert.match(userMessages[1]!, /未通过校验/);
      assert.match(userMessages[1]!, /旁白/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：两次 IR 都非法 → 422 且只调两次，无占位分镜", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return chatResponse('{"topic":"x","title":"y","shots":[]}');
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条水循环短片"));
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.match(String(data.error), /未通过校验/);
      assert.ok(Array.isArray(data.errors) && data.errors.length > 0);
      assert.equal(calls, 2);
      assert.equal(data.storyboard, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// P1-2（Codex 复核 2026-10-26）：模型输出资产引用/未知字段 → 带因重试一次，
// 仍非法则 422，错误信息含素材边界指引（不无声转成通用图解）。
test("semantic-plan：资产引用字段 → 重试一次后仍 422 且含素材指引", async () => {
  const originalFetch = globalThis.fetch;
  const userMessages: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    userMessages.push(body.messages[1]!.content);
    const valid = JSON.parse(VALID_IR) as { shots: unknown[] };
    return chatResponse(
      JSON.stringify({
        ...valid,
        shots: [
          { ...(valid.shots[0] as object), assetUrl: "https://e.com/a.png" },
          ...valid.shots.slice(1),
        ],
      }),
    );
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条水循环短片，要真实照片"));
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.match(userMessages[1]!, /assetUrl/);
      assert.ok(
        (data.errors as string[]).some((e) => /素材|照片|人工/.test(e)),
        JSON.stringify(data.errors),
      );
      assert.equal(data.storyboard, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：空句/超长句 → 400 不触网", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("invalid input must not reach provider");
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const empty = await POST(ask("   "));
      assert.equal(empty.status, 400);
      const tooLong = await POST(ask("长".repeat(241)));
      assert.equal(tooLong.status, 400);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：模型坏 JSON → 422 分类错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse("不是JSON");
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条水循环短片"));
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.match(String(data.error), /JSON/);
      assert.equal(data.storyboard, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 时长目标（交接单验收：20-30s 或显式记录偏离）：句子里的「N秒」解析为
// 目标，Σ durationMs 偏离 0.8N..1.2N 先走带因重试；重试后仍偏则透明标注
// durationDeviation（不硬失败——确认卡如实显示总时长，用户自行决定）。
// 手工构造合法 IR（等比缩放会撞每镜上限/旁白预算）：
const SHORT_IR = JSON.stringify({
  topic: "水循环",
  title: "水的旅程",
  shots: [
    { intent: "title", title: "水的旅程", narrationText: "一滴水的旅程", durationMs: 2300 },
    {
      intent: "cycle-explainer",
      title: "水循环四阶段",
      narrationText: "水在四个阶段循环",
      durationMs: 4500,
      cycleSteps: ["蒸发", "凝结", "降水", "汇集"],
    },
    { intent: "title", title: "谢谢观看", narrationText: "谢谢观看", durationMs: 2300 },
    { intent: "title", title: "再看一遍", narrationText: "可以再看一遍", durationMs: 4000 },
  ],
}); // Σ=13100ms < 20000ms（25s×0.8）

const ON_TARGET_IR = JSON.stringify({
  topic: "水循环",
  title: "水的旅程",
  shots: [
    { intent: "title", title: "水的旅程", narrationText: "一滴水的旅程", durationMs: 3000 },
    {
      intent: "cycle-explainer",
      title: "水循环四阶段",
      narrationText: "蒸发凝结降水汇集循环不息",
      durationMs: 5200,
      cycleSteps: ["蒸发", "凝结", "降水", "汇集"],
    },
    {
      intent: "text-explainer",
      title: "为什么重要",
      narrationText: "淡水全靠它补给",
      durationMs: 3700,
      bullets: ["淡水之源", "气候推手", "生生不息"],
    },
    {
      intent: "flow-explainer",
      title: "一杯水的路径",
      narrationText: "从海到云再到海",
      durationMs: 3500,
      flowSteps: ["海洋", "云朵", "河流"],
    },
    { intent: "title", title: "水的旅程", narrationText: "循环永不停", durationMs: 3000 },
    { intent: "title", title: "谢谢观看", narrationText: "谢谢观看", durationMs: 3000 },
    { intent: "title", title: "下集再见", narrationText: "下集再见", durationMs: 3000 },
  ],
}); // Σ=24400ms ∈ [20000, 30000]

test("semantic-plan：Σ时长低于句中目标 → 带因重试；修正后通过且无偏离标注", async () => {
  const originalFetch = globalThis.fetch;
  const userMessages: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    userMessages.push(body.messages[1]!.content);
    // 第一次 Σ13.1s（远低于 25s×0.8）；第二次 Σ24.4s（达标）。
    return chatResponse(calls === 1 ? SHORT_IR : ON_TARGET_IR);
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条约25秒的水循环科普短片"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.match(userMessages[1]!, /总时长/);
      assert.equal(data.durationDeviation, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-plan：重试后仍偏短 → 200 但透明标注 durationDeviation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return chatResponse(SHORT_IR);
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条约25秒的水循环科普短片"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.ok(data.durationDeviation);
      assert.equal(data.durationDeviation.targetMs, 25000);
      assert.equal(data.durationDeviation.actualMs, data.storyboard.totalMs);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// P2-4（Codex 复核 2026-10-26）：发生重试时 usage 必须合计并给分项，
// 不能只报最后一调（计费台账低报）。
test("semantic-plan：重试后 usage 合计两次调用并附分项", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    // 第一次：旁白超绝对上限触发重试；第二次合法。两调 usage 不同。
    return chatResponse(
      calls === 1
        ? JSON.stringify({
            ...JSON.parse(VALID_IR),
            shots: [
              {
                intent: "title",
                title: "T",
                narrationText: "这段旁白实在太长了肯定无论如何都装不下啊",
                durationMs: 6000,
              },
              ...JSON.parse(VALID_IR).shots.slice(1),
            ],
          })
        : VALID_IR,
      calls === 1
        ? { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        : { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
    );
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask("做一条约25秒的水循环科普短片"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.deepEqual(data.usage, {
        prompt_tokens: 140,
        completion_tokens: 70,
        total_tokens: 210,
      });
      assert.deepEqual(data.usageCalls, [
        { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
      ]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
