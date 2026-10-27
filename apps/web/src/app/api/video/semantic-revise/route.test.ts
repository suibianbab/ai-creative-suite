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
    prev: {
      description: "太阳加热（要点解说）",
      narrationText: "太阳加热，液态水汽化",
    },
    next: {
      description: "水滴变重（要点解说）",
      narrationText: "水滴变重，降落为雨雪",
    },
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
      assert.equal(data.provenance.promptVersion, "r5");
      assert.equal(data.provenance.instruction, CONTEXT.instruction);
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

// N5 契约：素材诉求指令 → 模型应产素材位镜头；两轮都无素材位才 422。
const SLOT_SHOT_IR = JSON.stringify({
  intent: "media-slot-explainer",
  title: "云的形成",
  narrationText: "看真实云照片",
  durationMs: 3000,
  slotKind: "云的真实照片",
  purpose: "展示积云形成过程",
});

test("semantic-revise N5：素材指令+素材位候选 → 200（待绑定占位）", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(SLOT_SHOT_IR);
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({ ...CONTEXT, instruction: "这一镜换成真实照片展示云的形成" }),
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.shot.label, "素材位");
      assert.match(data.shot.plan.renderHint, /待绑定/);
      assert.match(data.shot.description, /【素材位】/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise N5：素材指令两轮无素材位 → 422 needs-assets", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const messages: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    messages.push(body.messages[1]!.content);
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
      assert.equal(calls, 2);
      assert.match(messages[1]!, /素材位/);
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

// P2-1（Codex 复核 2026-10-27）：请求体 null/数组/原始值 → 400，不抛 500。
test("semantic-revise：body 为 null/数组/字符串 → 400 不触网", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("malformed body must not reach provider");
  };
  try {
    await withEnv(WITH_KEY, async () => {
      for (const body of ["null", "[]", '"text"', "123"]) {
        const response = await POST(
          new Request("http://localhost:3000/api/video/semantic-revise", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        );
        assert.equal(response.status, 400, `body=${body}`);
        const data = await response.json();
        assert.match(String(data.error), /请求格式无效/);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// P2-2（Codex 复核 2026-10-27）：授权图解替代的候选带 substitutedForAssets，
// 供 UI 标记与 provenance 落档（持久可追溯）。
test("semantic-revise：needs-assets 授权轮响应带 substitutedForAssets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(VALID_SHOT_IR);
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({
          ...CONTEXT,
          instruction: "这一镜换成真实照片展示云的形成",
          allowDiagramSubstitute: true,
        }),
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.substitutedForAssets, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// M-7（独立评审）：revise 路由的数值闸路径——候选编造原话没有的数字，
// 带因重试一次后仍编造 → 422 无候选。
test("semantic-revise：编造数值 → 重试一次后仍 422（数值闸接线）", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const messages: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    messages.push(body.messages[1]!.content);
    // 合法 compare 镜 + 编造数值：beforeValue=88 不在指令里（指令无数字）。
    return chatResponse(
      JSON.stringify({
        intent: "compare-explainer",
        title: "读书与手机",
        narrationText: "读书睡得更快",
        durationMs: 3500,
        metricLabel: "入睡时间",
        beforeLabel: "手机",
        beforeValue: "88分钟",
        beforeNote: "越刷越精神",
        afterLabel: "读书",
        afterValue: "更快",
        afterNote: "放松身心",
        deltaText: "更快入睡",
        deltaPositive: true,
      }),
    );
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({ ...CONTEXT, instruction: "把这一镜改成读书和手机的对比" }),
      );
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.match(messages[1]!, /88/);
      assert.ok(
        (data.errors as string[]).some((e) => /88/.test(e)),
        JSON.stringify(data.errors),
      );
      assert.equal(data.shot, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// I-1 补充（修复验证）：影片上下文里的数字是模型合法数据源——指令没提
// 但本镜/邻镜/片名里有（如心率 80/65），引用它们不得被数值闸误拒。
test("semantic-revise：引用影片上下文数字不被误拒", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    chatResponse(
      JSON.stringify({
        intent: "compare-explainer",
        title: "心率对比",
        narrationText: "心率明显下降",
        durationMs: 3500,
        metricLabel: "静息心率",
        beforeLabel: "久坐",
        beforeValue: "80",
        beforeNote: "缺少运动",
        afterLabel: "慢跑",
        afterValue: "65",
        afterNote: "心脏更高效",
        deltaText: "降到65",
        deltaPositive: true,
      }),
    );
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({
          ...CONTEXT,
          instruction: "把这一镜改成心率对比",
          film: { title: "慢跑与久坐", shotCount: 5, totalMs: 15000 },
          // 上下文里的合法数据源：邻镜旁白带 80/65。
          neighbors: {
            prev: { description: "背景", narrationText: "静息心率从80降到65" },
            next: undefined,
          },
        }),
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.shot.plan.spec.componentId, "compare-split");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic-revise：镜数等编辑器元数据不能作为画面数值来源", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return chatResponse(
      JSON.stringify({
        intent: "compare-explainer",
        title: "读书与手机",
        narrationText: "读书睡得更快",
        durationMs: 3500,
        metricLabel: "入睡时间",
        beforeLabel: "手机",
        beforeValue: "6%",
        beforeNote: "越刷越精神",
        afterLabel: "读书",
        afterValue: "更快",
        afterNote: "放松身心",
        deltaText: "更快入睡",
        deltaPositive: true,
      }),
    );
  };
  try {
    await withEnv(WITH_KEY, async () => {
      const response = await POST(
        ask({
          ...CONTEXT,
          instruction: "把这一镜改成读书和手机的对比",
          film: { title: "睡眠习惯", shotCount: 6, totalMs: 21000 },
        }),
      );
      assert.equal(response.status, 422);
      const data = await response.json();
      assert.equal(calls, 2);
      assert.ok((data.errors as string[]).some((e) => /6/.test(e)));
      assert.equal(data.shot, undefined);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
