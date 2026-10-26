import assert from "node:assert/strict";
import test from "node:test";
import { semanticProviderFromEnv } from "./semantic-provider";

// 语义分镜 Provider（交接单第 3 步）：测试注入假 fetch，不触网、不依赖真密钥。
// 纪律与 photocraft plan-provider 一致：端点白名单、密钥脱敏、超时、输出限长。

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const ENV = { DASHSCOPE_API_KEY: "test-only" } as unknown as NodeJS.ProcessEnv;

test("semantic provider：缺 DASHSCOPE_API_KEY → null", () => {
  assert.equal(semanticProviderFromEnv({} as NodeJS.ProcessEnv), null);
});

test("semantic provider：合法调用返回 IR 原文解析结果与元信息", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: String(init?.body ?? ""),
    });
    return chatResponse('{"topic":"水循环","title":"水的旅程","shots":[]}');
  };
  try {
    const result = await provider.plan("做一条水循环科普短片");
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.deepEqual(result.draft, {
      topic: "水循环",
      title: "水的旅程",
      shots: [],
    });
    assert.equal(result.provider, "qwen-chat");
    assert.equal(result.model, "qwen-plus");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /dashscope\.aliyuncs\.com/);
    const body = JSON.parse(calls[0]!.body) as { response_format?: { type: string } };
    assert.equal(body.response_format?.type, "json_object");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic provider：5xx 自动重试一次后成功", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("boom", { status: 502 });
    return chatResponse('{"ok":1}');
  };
  try {
    const result = await provider.plan("句子");
    assert.ok(result.ok);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic provider：4xx 不重试且错误文本脱敏密钥", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("bad key sk-ABC123XYZ", { status: 401 });
  };
  try {
    const result = await provider.plan("句子");
    assert.ok(!result.ok);
    assert.equal(calls, 1);
    assert.equal(result.kind, "http");
    assert.ok(!result.message.includes("sk-ABC123XYZ"), result.message);
    assert.match(result.message, /\[redacted\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic provider：超时分类且只重试一次", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException("timed out", "TimeoutError");
  };
  try {
    const result = await provider.plan("句子");
    assert.ok(!result.ok);
    assert.equal(calls, 2);
    assert.equal(result.kind, "timeout");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic provider：非 JSON 输出 → invalid-json", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse("这不是JSON");
  try {
    const result = await provider.plan("句子");
    assert.ok(!result.ok);
    assert.equal(result.kind, "invalid-json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic provider：输出超限 → too-large", async () => {
  const provider = semanticProviderFromEnv(ENV);
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse("x".repeat(20 * 1024));
  try {
    const result = await provider.plan("句子");
    assert.ok(!result.ok);
    assert.equal(result.kind, "too-large");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
