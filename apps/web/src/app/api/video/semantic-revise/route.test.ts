import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

// N2 单镜修改路由（交接单 2026-10-27）：模型只产一个受限 IR 镜头，服务端
// 用与整片同源的 validateSemanticShot/compileSemanticShot 编译成候选；
// 锁定/审批/冲突由客户端按既有规则把关（服务端无项目状态）。

const CONTEXT = {
  instruction: "把这一镜改成凝结过程，强调水汽遇冷形成云；旁白也同步修改",
  shot: {
    index: 3,
    description: "高空遇冷（要点解说）",
    narrationText: "高空遇冷，水蒸气液化",
    durationMs: 3400,
    componentId: "sketch-note",
  },
  neighbors: {
    prev: { description: "太阳加热（要点解说）", narrationText: "太阳加热，液态水汽化" },
    next: { description: "水滴变重（要点解说）", narrationText: "水滴变重，降落为雨雪" },
  },
  film: { title: "水循环", shotCount: 6, totalMs: 21000 },
};

const VALID_SHOT_IR = JSON.stringify({
  intent: "flow-explainer",
  title: "凝结过程",
  narrationText: "水汽遇冷变成云",
  durationMs: 3000,
  flowSteps: ["水汽上升", "遇冷凝结", "聚成云滴"],
});

const ask = (body: unknown) =>
  new Request("http://localhost:3000/api/video/semantic-revise", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

test("semantic-revise：缺密钥 → 503 不触网", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("must not call provider without key");
  };
  try {
    await withEnv(NO_KEY, async () => {
      const response = await POST(ask(CONTEXT));
      assert.equal(response.status, 503);
      const data = await response.json();
      assert.match(String(data.error), /DASHSCOPE_API_KEY/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise：合法指令+合法单镜 IR → 200 候选（含屏幕文字/时长/影响输入）", async () => {
  const originalFetch = globalThis.fetch;
  const userMessages: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    userMessages.push(body.messages[1]!.content);
    return chatResponse(VALID_SHOT_IR, {
      prompt_tokens: 80,
      completion_tokens: 30,
      total_tokens: 110,
    });
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask(CONTEXT));
      assert.equal(response.status, 200);
      const data = await response.json();
      // 候选内容：编译产物 + 供预览的字段。
      assert.equal(data.shot.plan.spec.componentId, "flow-steps");
      assert.equal(data.shot.narrationText, "水汽遇冷变成云");
      assert.ok(data.shot.plan.spec.durationMs >= 2500);
      assert.match(data.shot.plan.renderHint, /凝结过程/);
      assert.equal(data.shot.durationMs, data.shot.plan.spec.durationMs);
      // 用户消息带上下文：本镜/相邻镜/整片与指令都要进提示。
      assert.match(userMessages[0]!, /高空遇冷/);
      assert.match(userMessages[0]!, /水蒸气液化/);
      assert.match(userMessages[0]!, /水循环/);
      assert.match(userMessages[0]!, /把这一镜改成凝结/);
      // provenance：修改链自己的提示词版本 + 指令快照。
      assert.equal(data.provenance.promptVersion, "r1");
      assert.equal(
        data.provenance.instruction,
        CONTEXT.instruction,
      );
      assert.deepEqual(data.usage, {
        prompt_tokens: 80,
        completion_tokens: 30,
        total_tokens: 110,
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise：IR 非法 → 带因重试一次；仍非法 422 无候选", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const userMessages: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    userMessages.push(body.messages[1]!.content);
    return chatResponse('{"intent":"title","title":"T"}');
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(ask(CONTEXT));
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.match(userMessages[1]!, /未通过校验|narrationText/);
      assert.ok(Array.isArray(data.errors) && data.errors.length > 0);
      assert.equal(data.shot, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise：指令要求真实照片 → needs-assets 422 不调模型", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return chatResponse(VALID_SHOT_IR);
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({ ...CONTEXT, instruction: "这一镜换成真实照片展示云的形成" }),
      );
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.equal(data.kind, "needs-assets");
      assert.equal(calls, 0);
      assert.equal(data.shot, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise：指令空/超长 → 400 不触网", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("invalid input must not reach provider");
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const empty = await POST(ask({ ...CONTEXT, instruction: "   " }));
      assert.equal(empty.status, 400);
      const tooLong = await POST(
        ask({ ...CONTEXT, instruction: "改".repeat(201) }),
      );
      assert.equal(tooLong.status, 400);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
